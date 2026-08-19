/**
 * Leaving an account, in the only order that does not lose anything.
 *
 * 1. Flush the outbox to disk, so the queue as it stands right now is durable
 *    before anything touches the session.
 * 2. Look at what is still queued. If anything is, stop — see below.
 * 3. Sign out, which deregisters this device's push token while there is still
 *    a session to do it with.
 *
 * The caller dispatches `SIGN_OUT` only on `{ ok: true }`. That split is
 * deliberate: this module returns an outcome rather than dispatching, so the
 * sequence can be tested without a store, and so the dispatch cannot
 * accidentally happen first — which would change `selfId`, fire the
 * `lastSelfId` effect in `store.tsx`, and clear the outbox before it drained.
 *
 * Step 2 is the one worth defending. `signOutEverywhere` completes locally when
 * it is offline — it has to, or the app is stuck signed in to a session it is
 * refusing to use — and `SIGN_OUT` then wipes local state. So without this check
 * a sign-out on a train takes unsent work off the device forever while the
 * server never hears about it, and signing back in restores everything except
 * the thing the person did last, with nobody told. They are told instead, and
 * asked to reconnect.
 *
 * Read `flushOutbox` before you trust step 1 to do more than it does: it is a
 * *persistence* flush — it cancels the debounce and writes the queue to
 * AsyncStorage — not a send. Sending is `drain`, which needs a `QueueTransport`
 * and is owned by the engine; the only handle the app has on it is
 * `kickSync()`, which is fire-and-forget and cannot be awaited. That is fine
 * here, because the check that follows fails *closed*: a queue the scheduler
 * has not got to yet refuses the sign-out rather than losing it. The cost is a
 * refusal that a five-second wait would have cleared. The fix, if that ever
 * grates, is an awaitable drain on the engine — not a weaker check here.
 */
import { flushOutbox, pending } from '../../sync/outbox';
import { signOutEverywhere } from '../../sync/session';

export type SignOutOutcome =
  | { ok: true }
  /** Nothing happened. `unsent` is distinct rows, not queued operations. */
  | { ok: false; unsent: number };

export async function attemptSignOut(): Promise<SignOutOutcome> {
  await flushOutbox();

  // By key, not by entry: the key is the row and the entry is the attempt.
  const unsent = new Set(pending().map((e) => e.key)).size;
  if (unsent > 0) return { ok: false, unsent };

  await signOutEverywhere();
  return { ok: true };
}

/**
 * "Things" rather than "tasks", because an unsent write can equally be a note, a
 * reaction or a name change — the same word `UnsavedBanner` settled on.
 */
export function unsentLine(unsent: number): string {
  return unsent === 1
    ? 'One thing hasn’t reached the server yet. Reconnect and try again — it’d be lost otherwise.'
    : `${unsent} things haven’t reached the server yet. Reconnect and try again — they’d be lost otherwise.`;
}
