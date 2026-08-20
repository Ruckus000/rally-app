/**
 * Ask the model about a profile photo before anybody else sees it.
 *
 *   POST {} -> { state: 'none' | 'pending' | 'ready' | 'refused' }
 *
 * Behind `verify_jwt`, like `rate-goal`, and for the stronger version of the
 * same reason: this function holds the service-role key and is the only caller
 * of `mark_avatar_screened`, the one route an image has into `ready`.
 *
 * The client uploads to the private `avatars` bucket, calls `set_avatar` — which
 * can write `pending` and nothing else — and then calls this. Until this answers
 * `ready`, every screen in the app renders initials, including the uploader's
 * own. See `20260819194501_avatars.sql` for why that is not over-caution.
 *
 * ─── the shape of the answer, and what is left out of it ──────────────────
 *
 * The verdict and nothing else. `imageVerdict` also returns a `reason` — the
 * model's own sentence about what it objected to — and that stays here, in the
 * log. Handing it to the client would undo the property `imageVerdict.mjs` was
 * written for: on a false positive it accuses somebody over a photo of their
 * kitchen, and on a true one it is a checklist for getting the next attempt
 * past the guard. The client shows `IMAGE_BLOCKED_COPY`, which does not explain
 * and does not argue.
 *
 * ─── failing closed, and why that means deleting ──────────────────────────
 *
 * Every path that is not a model saying `harmful: false` ends in `refused`: a
 * refusal, a timeout, a 429, a body that did not parse, an object that would
 * not download, a MIME type the bucket should never have accepted. That
 * asymmetry is argued in `imageVerdict.mjs` and this function only obeys it.
 *
 * What this function adds is the deletion, and it is not tidying up. The
 * bucket's select policy is `bucket_id = 'avatars'` for *every* authenticated
 * account — deliberately, since an avatar's audience is everyone — so an object
 * that survives a refusal is readable by anyone who learns its name, and the
 * client that uploaded it already knows the name. Clearing the row would hide
 * the picture from the app while leaving it on the server, addressable, for as
 * long as the bucket exists. The row is the app's view of the image; the object
 * is the image. Both have to go.
 *
 * So the order below is delete first, then mark. Backwards, and a delete that
 * fails leaves a row saying `refused` over bytes that are still there. This
 * way, the worst case is a row still `pending` — which renders initials, and
 * which a repeat call resolves, because a `pending` row whose object has gone
 * fails its download and refuses.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { complete } from '../_shared/llm.ts';
import { IMAGE_SCREENING } from '../_shared/imageScreening.mjs';
import { imageVerdict } from '../_shared/imageVerdict.mjs';

/**
 * Matches `imageScreening.mjs`: one boolean and one short sentence. `reason` is
 * required rather than optional so the model is never deciding whether to
 * include a field — it writes an empty string when the answer is "no".
 */
const SCREEN_SCHEMA = {
  type: 'object',
  properties: { harmful: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['harmful', 'reason'],
} as const;

/**
 * What the bucket accepts, restated here rather than read from it.
 *
 * The bucket's `allowed_mime_types` is the gate; this is the check that the
 * bytes about to be sent to a model are something it was told it can read. A
 * type outside this list means the object is not what the upload claimed, and
 * that is a refusal rather than a guess — all three are types Gemini documents
 * as accepted inputs, so anything else has no correct handling here.
 */
const SCREENABLE = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Screening calls per user per UTC day, sharing `rate-goal`'s counter.
 *
 * One quota serves both functions, so one counter is the honest way to spend
 * it. The cap exists because a client can return itself to `pending` as often
 * as it likes — `set_avatar` is unlimited by design — and each round trip is a
 * megabyte of image through a shared free tier.
 *
 * Over the cap blocks, which is the opposite of what `rate-goal` does with the
 * same signal, and for the same reason everything else here blocks: an
 * unscreened avatar is not a thing to hand out while we sort the quota. At 200
 * a day nobody reaches this by uploading a photo; you reach it by looping.
 */
const DAILY_CAP = 200;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Same read as `rate-goal`, including the explicit token: with no argument
  // `getUser()` looks for a stored session an edge function never has, and
  // every request comes back unauthenticated whatever header it carried.
  //
  // The subject of the screening is the caller, always. There is no profile id
  // in the request body and there must not be one — an argument here would let
  // any signed-in account point this function, holding the only key that can
  // write `ready`, at somebody else's row.
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '');
  const { data: auth } = await db.auth.getUser(token);
  const userId = auth?.user?.id;
  if (!userId) return json({ error: 'not signed in' }, 401);

  const { data: profile, error: readErr } = await db
    .from('profiles')
    .select('avatar_path, avatar_state')
    .eq('id', userId)
    .maybeSingle();

  if (readErr || !profile) {
    console.warn(`screen-image: no profile for ${userId} — ${readErr?.message ?? 'no row'}`);
    return json({ error: 'no profile' }, 404);
  }

  // Nothing is waiting on a verdict, so there is nothing to screen — and a call
  // that pressed on anyway would be worse than wasteful. A second call for an
  // upload already judged would spend another request to reach the same answer;
  // a call arriving after the owner removed the photo would be asking about
  // bytes nobody is proposing to show. `mark_avatar_screened` only moves rows
  // that are `pending`, so it would refuse to republish either way, but the
  // model call is spent before the RPC ever sees it. This is where it is saved.
  if (profile.avatar_state !== 'pending') return json({ state: profile.avatar_state });

  const path: string = profile.avatar_path ?? '';
  if (!path) {
    // `set_avatar` cannot produce this pair — it writes both columns together —
    // so a `pending` row with no path is a state nothing should be able to
    // reach. It resolves as a refusal because there is no image to clear the
    // gate, and there is no object to delete.
    console.warn(`screen-image: ${userId} is pending with no avatar_path`);
    await markScreened(db, userId, 'refused');
    return json({ state: 'refused' });
  }

  if (await overCap(db, userId)) {
    console.warn(`screen-image: ${userId} over the daily cap of ${DAILY_CAP} — refusing unscreened`);
    return json({ state: await refuse(db, userId, path) });
  }

  // Service role, because the bucket is private and the screener has to read
  // the one thing nobody else may: the bytes before anyone has looked at them.
  const { data: blob, error: dlErr } = await db.storage.from('avatars').download(path);
  if (dlErr || !blob) {
    console.warn(`screen-image: download failed for ${userId} — ${dlErr?.message ?? 'no body'}`);
    return json({ state: await refuse(db, userId, path) });
  }

  const mimeType = blob.type;
  if (!SCREENABLE.includes(mimeType)) {
    console.warn(`screen-image: ${userId} uploaded an unscreenable type (${mimeType || 'none'})`);
    return json({ state: await refuse(db, userId, path) });
  }

  const screened = await complete<{ harmful: boolean; reason: string }>({
    system: IMAGE_SCREENING,
    // The prompt is the whole question; the user turn only says which image.
    // An empty string here would be a part with no content, which Gemini
    // rejects, so it carries the one fact the system prompt does not have.
    user: 'This is the profile photo. Answer the question about it.',
    schema: SCREEN_SCHEMA,
    image: { mimeType, base64: toBase64(new Uint8Array(await blob.arrayBuffer())) },
  });

  const { verdict, reason } = imageVerdict(screened);

  if (verdict === 'ok') {
    await markScreened(db, userId, 'ready');
    return json({ state: 'ready' });
  }

  // Nothing was learned about this picture, so nothing is decided about it.
  // The row stays `pending`, which renders initials exactly as a refusal does —
  // the image is no more visible than it would have been — and the object
  // survives, so there is still something to judge when the screener is back.
  // `resumePendingAvatar` asks again on the next launch; this is the state its
  // comment was written for.
  if (verdict === 'unproven') {
    console.warn(`screen-image: screener unreachable for ${userId} — left pending to retry`);
    return json({ state: 'pending' });
  }

  // The model's words, in the log and nowhere else. Empty when the block came
  // from a refusal, where nothing was said about the picture at all — which is
  // worth being able to tell apart when reading these back, so the status is
  // named alongside it.
  console.warn(
    `screen-image: blocked for ${userId} — screening ${screened.status}${reason ? `: ${reason}` : ''}`,
  );
  return json({ state: await refuse(db, userId, path) });
});

/**
 * Block an image: remove the object, then record the refusal.
 *
 * In that order, and best-effort on the first half — a delete that fails is
 * logged loudly and the row is still marked, because a `refused` row over a
 * lingering object is bad and a `pending` row over one is no better. What the
 * order buys is the other failure: if the mark is what fails, the bytes are
 * already gone and the row sits at `pending`, which renders initials.
 */
async function refuse(
  // deno-lint-ignore no-explicit-any
  db: any,
  userId: string,
  path: string,
): Promise<'refused'> {
  const { error } = await db.storage.from('avatars').remove([path]);
  if (error) {
    // Says out loud that a rejected image is still sitting in a bucket every
    // signed-in account can read by name. Nothing else records it.
    console.error(`screen-image: REFUSED IMAGE NOT DELETED for ${userId} — ${error.message}`);
  }
  await markScreened(db, userId, 'refused');
  return 'refused';
}

/**
 * The only route into `ready`, and it is service-role only — `authenticated`
 * is named in that function's REVOKE for exactly this reason. It moves rows
 * that are `pending` and no others, so a duplicate call cannot walk an image
 * back into view after its owner removed it.
 */
async function markScreened(
  // deno-lint-ignore no-explicit-any
  db: any,
  userId: string,
  state: 'ready' | 'refused',
): Promise<void> {
  const { error } = await db.rpc('mark_avatar_screened', { p_profile: userId, p_state: state });
  if (error) console.error(`screen-image: mark_avatar_screened(${state}) failed — ${error.message}`);
}

/** Shared with `rate-goal`: one counter, one quota. */
async function overCap(
  // deno-lint-ignore no-explicit-any
  db: any,
  userId: string,
): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const { data, error } = await db.rpc('bump_llm_usage', { u: userId, d: day });
  if (error) {
    // A broken counter is not a reason to refuse somebody's photo. Let the call
    // through and rely on the free tier's own limit as the backstop — the same
    // call `rate-goal` makes, for the same reason.
    console.warn(`screen-image: usage counter failed — ${error.message}`);
    return false;
  }
  return (data ?? 0) > DAILY_CAP;
}

/**
 * Bytes to base64, in chunks.
 *
 * `String.fromCharCode(...bytes)` on a whole 2 MB object is a spread of two
 * million arguments and a stack overflow, not a slow path — so the chunk size
 * is load-bearing rather than tuning.
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
