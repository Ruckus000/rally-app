/**
 * Pick a photo, shrink it, put it in the bucket, and hand it to the screener.
 *
 * The whole avatar client sequence lives here, behind two functions that do not
 * throw. Every failure — a refused permission, a cancelled picker, a dead
 * network, a model that said no — comes back as a returned outcome, the same
 * discipline `rateGoal.ts` follows and for a sharper version of the same
 * reason: the caller is a row in Settings that somebody is tapping, and a
 * settings row that can throw mid-tap is worse than one that shows a line of
 * text. The UI in Task 7 renders the outcome; nothing here knows about copy.
 *
 * ─── none of this goes through the outbox ─────────────────────────────────
 *
 * The obvious instinct — this is a write, we have a queue for writes — is
 * wrong here, and expensively so. The outbox is a JSON array in AsyncStorage
 * that has to survive relaunches and identity changes; a queued avatar is a
 * megabyte of base64 sitting in it, re-serialised on every enqueue, still
 * there after the user signs in as somebody else. And an upload is the one
 * write where the person is *watching*: a failure they can see and retry is
 * honest, where a silent queue that drains an hour later against a different
 * account is not. So the bytes go straight up, and the only thing recorded
 * afterwards is a path — through `set_avatar`, which is an RPC and therefore
 * not an outbox op either, since the outbox speaks in table rows.
 *
 * ─── the ordering, which is all about what a crash leaves behind ──────────
 *
 * Upload → `set_avatar(path)` → delete the previous object → screen. Every
 * step is placed so that the failure of the *next* one leaves something
 * recoverable:
 *
 *  - upload fails: nothing was said, nothing to undo.
 *  - `set_avatar` fails: an object nobody references. We delete it here
 *    (see `discard`), because the bucket's select policy is
 *    `bucket_id = 'avatars'` for every authenticated account — an unreferenced
 *    object is not invisible, it is readable by anyone who learns its name.
 *  - the old object is deleted only after the row points at the new one, so a
 *    replace that dies halfway leaves the *old* photo working rather than a
 *    row pointing at bytes that have gone.
 *  - screening fails to answer: we roll the whole thing back to `none`. See
 *    `screen` for why that is safe against a call that actually landed.
 *
 * ─── why the bytes are base64 rather than a Blob ──────────────────────────
 *
 * `fetch(fileUri).then(r => r.blob())` is the tempting one-liner and it
 * uploads zero-byte objects on React Native: the Blob is a handle to native
 * data, and supabase-js's fetch serialises it as an empty body. Asking the
 * manipulator for base64 and decoding it here costs one small function and
 * works on both platforms — and it keeps this module testable without a
 * filesystem.
 */
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { randomUUID } from 'expo-crypto';

import { getSupabase, hasSupabaseConfig } from './supabase';
import { currentUserId } from '../sync/session';

/**
 * The long edge, in pixels, of anything that leaves this device.
 *
 * An avatar renders at 60px at its very largest, so 512 is already generous —
 * it is a retina 2x of a much bigger circle than this app has. What it buys is
 * on the other side of the trade: a modern camera original is 4000px and
 * 8-12 MB, which is slow to upload on a phone network, is over the bucket's
 * 2 MB ceiling, and gets handed byte-for-byte to a model that is going to look
 * at it at a few hundred pixels anyway. The bucket limit is the backstop for a
 * client that skips this; this is the number that makes it never fire.
 */
const MAX_EDGE = 512;

/**
 * JPEG quality. At 512px the difference between this and 1.0 is invisible on a
 * face and roughly a factor of four in bytes.
 */
const QUALITY = 0.8;

const BUCKET = 'avatars';

/**
 * What the caller gets back. Never an exception.
 *
 * `blocked` is its own outcome rather than a flavour of `failed` because it is
 * the one the user can do something about — pick a different photo — and
 * because the server has already deleted the object and written `refused`, so
 * the app must not go on believing there is a photo. The copy for it is
 * `IMAGE_BLOCKED_COPY`; the model's own sentence never leaves the edge
 * function's log and is not available here on purpose.
 *
 * `cancelled` and `no-permission` are separated for the same reason: one is a
 * person changing their mind, which deserves no message at all, and the other
 * needs a pointer at Settings.
 */
export type AvatarOutcome =
  | { ok: true; path: string }
  | { ok: false; reason: 'cancelled' | 'no-permission' | 'blocked' | 'failed' };

/**
 * Pick a photo and take it all the way to screened.
 *
 * `previousPath` is the object the profile points at right now, if any, and
 * exists so that replacing a photo does not orphan the old one. There is no
 * update policy on the bucket by design — a replace is a delete plus an
 * insert, so the new photo gets a new name, a new screening pass, and no
 * cached signed URL keeps resolving to bytes that were swapped underneath it.
 * The caller reads it off the profile; this module holds no state.
 *
 * Resolving with `ok: true` means the screener said `ready`, which is the only
 * state in which bytes ever reach a screen. Anything else — including a
 * screening that could not be reached — leaves the account with no photo.
 */
export async function pickAndUploadAvatar(previousPath?: string | null): Promise<AvatarOutcome> {
  try {
    // Demo builds make zero network calls, and `getSupabase()` throws rather
    // than handing back a client pointed at nothing. Checked before the picker
    // so we never open the photo library for an upload that cannot happen.
    if (!hasSupabaseConfig()) return fail();
    const me = currentUserId();
    if (!me) return fail();

    const picked = await pick();
    if (picked.kind !== 'picked') return { ok: false, reason: picked.kind };

    const jpeg = await downscale(picked.uri, picked.width, picked.height);
    if (!jpeg) return fail();

    // Client-minted, like every other id in this schema. The folder is the
    // owner's uuid because that is what the storage policies and `set_avatar`
    // both check — a path whose first segment is not you is refused twice.
    const path = `${me}/${randomUUID()}.jpg`;

    const db = getSupabase();
    const up = await db.storage.from(BUCKET).upload(path, jpeg, {
      contentType: 'image/jpeg',
      // A retried upload of the same name should overwrite rather than mint a
      // second object. Names are fresh per attempt so this rarely fires, but
      // when it does the alternative is a 409 the user reads as "broken".
      upsert: true,
    });
    if (up.error) return fail();

    // Only now does anything point at it. A failure here leaves an object with
    // no row, which is why `discard` exists.
    const { error: rpcError } = await db.rpc('set_avatar', { p_path: path });
    if (rpcError) {
      await discard(path);
      return fail();
    }

    // The row has moved on, so the old object is unreferenced from this moment
    // and readable by name until it is gone. Best-effort: a delete that fails
    // must not fail the upload that has already succeeded.
    if (previousPath && previousPath !== path) await discard(previousPath);

    return screen(path);
  } catch {
    // Nothing is expected to reach here — the awaited calls above all report
    // errors in their results — but "nothing is expected to throw" is exactly
    // the sentence that was false about `rateGoal` on every real device.
    return fail();
  }
}

/**
 * Take the photo down, object and row together.
 *
 * The delete is not tidiness and the order is not arbitrary. Every signed-in
 * account can read this bucket by name, so clearing only the row hides the
 * picture from the app and leaves it on the server for as long as the bucket
 * exists — the same argument that makes the edge function delete on a refusal.
 *
 * Object first, then row: if the row write is what fails, the bytes are
 * already gone and the profile points at a path whose download 404s, which
 * renders initials and is fixed by the next attempt. Backwards, and a delete
 * that fails leaves a cleared profile over an image that is still there.
 *
 * Returns false when either half failed, so the UI can say the photo is still
 * there rather than showing it gone and having it return on the next pull.
 */
export async function clearAvatar(path: string | null | undefined): Promise<boolean> {
  try {
    if (!hasSupabaseConfig()) return false;
    const db = getSupabase();

    if (path) {
      const { error } = await db.storage.from(BUCKET).remove([path]);
      if (error) return false;
    }

    const { error } = await db.rpc('set_avatar', { p_path: null });
    return !error;
  } catch {
    return false;
  }
}

type Picked =
  | { kind: 'picked'; uri: string; width: number; height: number }
  | { kind: 'cancelled' }
  | { kind: 'no-permission' };

/**
 * The photo library, asking for the least that gets the job done.
 *
 * Images only, one of them, no editor, and `exif: false` so the asset handed
 * to JS carries no metadata even before the re-encode drops it. A refused
 * permission is a returned outcome rather than an exception: on iOS the person
 * has to go to Settings to undo it, which is a sentence to show, not a crash.
 */
async function pick(): Promise<Picked> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { kind: 'no-permission' };

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    allowsEditing: false,
    exif: false,
    // The picker's own compression would be a second lossy pass over an image
    // this module is about to re-encode anyway. Take it whole and shrink once.
    quality: 1,
  });

  const asset = result.canceled ? undefined : result.assets?.[0];
  if (!asset?.uri) return { kind: 'cancelled' };
  return { kind: 'picked', uri: asset.uri, width: asset.width, height: asset.height };
}

/**
 * 512px on the long edge, re-encoded as JPEG, returned as bytes.
 *
 * The re-encode is also how EXIF leaves. Neither platform copies metadata
 * across it — iOS builds the output with `UIImage.jpegData`, which encodes
 * pixels from a `UIImage` that never held an EXIF dictionary, and Android with
 * `Bitmap.compress`, which writes pixels to a stream and has no notion of
 * tags (there is no `ExifInterface` anywhere in the package). That matters
 * more here than for a goal photo: an avatar is visible to every signed-in
 * account, so a GPS tag riding along on it is a home address handed to
 * strangers.
 *
 * The long edge is chosen from the picker's reported dimensions and only ever
 * shrinks. Upscaling a small photo to 512 would spend bytes inventing pixels.
 */
async function downscale(uri: string, width: number, height: number): Promise<Uint8Array | null> {
  const context = ImageManipulator.manipulate(uri);

  const longest = Math.max(width || 0, height || 0);
  if (longest > MAX_EDGE) {
    // One dimension only — the manipulator derives the other from the ratio,
    // so a portrait photo stays a portrait photo.
    context.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }

  const image = await context.renderAsync();
  const saved = await image.saveAsync({
    format: SaveFormat.JPEG,
    compress: QUALITY,
    base64: true,
  });
  if (!saved?.base64) return null;
  return bytesFromBase64(saved.base64);
}

/**
 * Ask the screener, and treat every answer that is not `ready` as no photo.
 *
 * A `refused` verdict has already been acted on server-side: the function
 * deletes the object and writes `refused` before it answers, so there is
 * nothing to clean up and the outcome is simply `blocked`.
 *
 * A call that never answers is the interesting one. The row is `pending`,
 * which renders initials to everyone including its owner, and the object is
 * sitting in a bucket every account can read — so leaving it is a small
 * permanent leak plus a profile stuck in a state nothing on the client ever
 * revisits. Rolling back is safe even if the call actually landed and this
 * device merely lost the reply: `mark_avatar_screened` only moves rows that
 * are still `pending`, so whichever of the two writes lands last, the row ends
 * at `none` and the bytes are gone. The user retries; nothing is stranded.
 */
async function screen(path: string): Promise<AvatarOutcome> {
  const { data, error } = await getSupabase().functions.invoke('screen-image', { body: {} });

  if (!error && isState(data) && data.state === 'ready') return { ok: true, path };
  if (!error && isState(data) && data.state === 'refused') return { ok: false, reason: 'blocked' };

  await clearAvatar(path);
  return fail();
}

/** Trusts nothing off the wire — an unrecognised body is "no answer". */
function isState(data: unknown): data is { state: string } {
  return !!data && typeof data === 'object' && typeof (data as { state?: unknown }).state === 'string';
}

/**
 * Remove an object nobody should be able to reach any more, best effort.
 *
 * Every caller is already on a path where the interesting failure has
 * happened; a delete that also fails changes none of their answers, and the
 * only thing worth doing with it is not making it louder than the first one.
 */
async function discard(path: string): Promise<void> {
  try {
    await getSupabase().storage.from(BUCKET).remove([path]);
  } catch {
    // Already reported as the enclosing failure.
  }
}

function fail(): AvatarOutcome {
  return { ok: false, reason: 'failed' };
}

/**
 * base64 to bytes, written out.
 *
 * React Native has no `Buffer`, and `atob` is a polyfill whose presence has
 * moved between releases — `rateGoal.ts` carries a scar from exactly that kind
 * of assumption (`AbortSignal.timeout` exists in Jest and not on a phone). A
 * dozen lines that are true everywhere beat a global that is true in the test
 * runner. Characters outside the alphabet — padding, stray newlines — are
 * skipped rather than decoded, which is what makes this safe against a
 * platform that wraps its output.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesFromBase64(base64: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of base64) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}
