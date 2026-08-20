/**
 * Picking a photo, and getting it somewhere it will survive.
 *
 * Three things happen between the tap and the queue, and each is here for a
 * reason the next one depends on.
 *
 * **Downscale first.** A modern phone camera produces something like 4000px
 * and several megabytes. The card that draws it is under 400pt wide, so the
 * pixels past ~1600 are paid for by the user's data plan and thrown away by
 * the renderer. The bucket's own limit is 5 MB; this keeps a normal photo two
 * orders of magnitude inside it.
 *
 * **Then copy it somewhere durable.** The picker hands back a URI in the
 * app's *cache* directory, which iOS may reclaim whenever it likes — and the
 * upload queue holds a path, not bytes, precisely so nothing base64 ends up
 * in AsyncStorage. A file that vanishes between picking and uploading is a
 * dead-lettered photo the user watched attach, so it moves to the document
 * directory, which is backed up and not reclaimed.
 *
 * **Only then tell anyone.** The reducer gets the local file and the queue
 * gets the job, in that order, so the photo is on screen before the network
 * is involved at all.
 */
import * as FileSystem from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { randomUUID } from 'expo-crypto';
import type { TaskMedia } from '../data/fixtures';

/** The longest edge we keep. A 402pt card at 3x is 1206px; 1600 has room. */
const MAX_EDGE = 1600;
/** Enough for a photograph, small enough to send on a phone connection. */
const QUALITY = 0.8;

export type PickOutcome =
  | { ok: true; media: TaskMedia }
  /** The user changed their mind. Says nothing, shows nothing. */
  | { ok: false; reason: 'cancelled' }
  /** Permission refused, or the picker//filesystem failed. Worth one line. */
  | { ok: false; reason: 'denied' | 'failed' };

/**
 * Ask for a photo, and hand back something ready to attach.
 *
 * `ownerId` and `taskId` are needed here rather than later because the
 * storage path is `<owner>/<task>/<media>.jpg` — the two policies read the
 * owner and the task straight out of the object's name, so the name has to be
 * right at the moment the file is written.
 */
export async function pickTaskPhoto(ownerId: string, taskId: string): Promise<PickOutcome> {
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return { ok: false, reason: 'denied' };

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      // The system crop, which is free and familiar. Anything more is an
      // editor, and this build is not one.
      allowsEditing: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return { ok: false, reason: 'cancelled' };

    const asset = picked.assets[0];
    const longest = Math.max(asset.width ?? 0, asset.height ?? 0);
    const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;

    const context = ImageManipulator.manipulate(asset.uri);
    if (scale < 1) {
      context.resize({
        width: Math.round((asset.width ?? MAX_EDGE) * scale),
        height: Math.round((asset.height ?? MAX_EDGE) * scale),
      });
    }
    const rendered = await context.renderAsync();
    const shrunk = await rendered.saveAsync({
      compress: QUALITY,
      format: SaveFormat.JPEG,
    });

    const id = randomUUID();
    const durable = `${FileSystem.Paths.document.uri}task-media/${id}.jpg`;
    await new FileSystem.Directory(`${FileSystem.Paths.document.uri}task-media`).create({
      intermediates: true,
      idempotent: true,
    });
    await new FileSystem.File(shrunk.uri).move(new FileSystem.File(durable));

    return {
      ok: true,
      media: {
        id,
        localUri: durable,
        path: `${ownerId}/${taskId}/${id}.jpg`,
        w: shrunk.width,
        h: shrunk.height,
      },
    };
  } catch {
    // Permission revoked mid-flight, a corrupt image, a full disk. One line
    // on the screen that asked is the whole remedy — there is nothing here
    // the user can act on beyond trying again.
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Forget the local copy of a photo that has been taken back.
 *
 * Best-effort on purpose: the row and the object are removed by the queue and
 * the server, and a file left behind costs a few hundred KB in this app's own
 * sandbox. Failing loudly here would be a warning about the least important
 * of the three.
 */
export async function forgetLocalPhoto(media: TaskMedia | undefined): Promise<void> {
  if (!media?.localUri) return;
  try {
    await new FileSystem.File(media.localUri).delete();
  } catch {
    // Already gone, or never written. Either way there is nothing to do.
  }
}
