/**
 * Leaving an account, in the only order that does not lose anything.
 *
 * 1. Flush the outbox to disk, so the queue as it stands right now is durable
 *    before anything touches the session, and kick a drain so anything queued
 *    is actually in motion.
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
 * Read `flushOutbox` before you trust it to do more than it does: it is a
 * *persistence* flush — it cancels the debounce and writes the queue to
 * AsyncStorage — not a send. Sending is `drain`, owned by the engine, and the
 * only handle the app has on it is `kickSync()`, which returns void and so
 * cannot be awaited. Hence the shape of step 1: persist, start a send, and then
 * check anyway, knowing the check will still see the queue this run.
 *
 * That is deliberate rather than a shortcut. The check fails *closed* — a queue
 * the drain has not finished refuses the sign-out rather than losing it — and
 * the kick is what makes the copy honest, because "give it a moment and try
 * again" is only fair advice if something is actually moving. The cost is one
 * refusal the user has to tap through. The known limitation, recorded rather
 * than papered over: with an awaitable drain on the engine this could resolve
 * on the first tap. That belongs in `src/sync/`, not in a weaker check here.
 */
import { flushOutbox, pending } from '../../sync/outbox';
import { signOutEverywhere } from '../../sync/session';
import { kickSync } from '../../sync/useSyncEngine';

export type SignOutOutcome =
  | { ok: true }
  /** Nothing happened. `unsent` is distinct rows, not queued operations. */
  | { ok: false; unsent: number };

export async function attemptSignOut(): Promise<SignOutOutcome> {
  await flushOutbox();

  // Fire-and-forget by construction — `kick()` returns void, so this cannot be
  // awaited and the check below will still see the queue. That is the point:
  // the refusal is immediate and honest, and the drain it starts is what makes
  // the retry seconds later succeed rather than waiting on the scheduler.
  // Null-safe on a demo account, where no engine is mounted to kick.
  kickSync();

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
    ? 'One thing hasn’t reached the server yet. Give it a moment and try again — it’d be lost otherwise.'
    : `${unsent} things haven’t reached the server yet. Give it a moment and try again — they’d be lost otherwise.`;
}
