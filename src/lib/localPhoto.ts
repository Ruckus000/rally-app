/**
 * Deleting a photo this device made, and nothing else.
 *
 * Split out of `photos.ts` rather than living beside its only other caller,
 * because of what the two files pull in. `photos.ts` imports the picker, the
 * manipulator and the crypto module — everything needed to *acquire* an
 * image — and the sync engine has no business loading any of that just to
 * delete a file whose name it already holds.
 *
 * So this is the half with one import, and it is the half the engine takes.
 */
import * as FileSystem from 'expo-file-system';

/**
 * Best-effort, and deliberately silent.
 *
 * Every caller is cleaning up after something that has already been decided
 * elsewhere: a photo replaced, taken back, or refused by the screener. The
 * row and the storage object are handled by the queue and the server; what is
 * left here is a few hundred KB in the app's own sandbox. A file that is
 * already gone, or was never written, is the expected case rather than an
 * error — and failing loudly about the least important of the three would put
 * a warning in front of somebody for something they cannot act on.
 */
export async function forgetLocalPhotoAt(uri: string | undefined | null): Promise<void> {
  if (!uri) return;
  try {
    await new FileSystem.File(uri).delete();
  } catch {
    // Already gone, never written, or a path this platform will not open.
  }
}
