/**
 * Leaving a circle, in the only order that does not lose a goal.
 *
 * 1. Flush the outbox to disk and kick a drain, exactly as `attemptSignOut`
 *    does and for the same reason: persist first, start a send, then check
 *    anyway knowing the check still sees this run's queue.
 * 2. If anything is unsent, stop.
 * 3. Delete the membership row, and only then let the caller dispatch.
 *
 * Step 2 is not caution, and it is sharper here than it is for signing out.
 * `tasks_insert` carries `circle_id is null or private.is_circle_member(...)`,
 * and Postgres applies an INSERT policy's `WITH CHECK` only to rows taking the
 * insert path of `ON CONFLICT DO UPDATE`. So a queued upsert for a goal the
 * server already has is safe — that is exactly what `tasks_update`'s
 * deliberately absent circle clause protects. A goal staked **offline and not
 * yet sent** is not: it takes the insert path, and the moment you leave the
 * room it is tagged to, that insert is a permanent 42501. `classify` calls that
 * non-retryable, the outbox retires it, and the stake lands in `unsaved`
 * without ever reaching anybody.
 *
 * The refusal cannot be narrowed to the entries actually at risk, because the
 * device cannot know which of its queued upserts the server will treat as
 * inserts. So it refuses on any unsent work, and the copy is written to be true
 * of the ones at risk without over-claiming about the rest.
 *
 * It is server-first, like `deleteAccount` and unlike `signOut`: a row taken out
 * of the list that is still on the server strands the user, and the next pull
 * would put the circle back with no explanation.
 *
 * One departure from `signOut`, which kicks unconditionally: the kick fires only
 * in the refusal branch. `kickSync` also starts a *pull*, and a pull begun
 * before the delete can answer after it, carrying a `circles` list that still
 * holds the circle just left — resurrecting it until the next tick. Sign-out has
 * no such window because the device is wiped either way. The caller kicks again
 * after a successful leave, where a pull can only see the new truth.
 */
import { flushOutbox, pending } from '../../sync/outbox';
import { leaveCircle } from '../../sync/transport';
import { kickSync } from '../../sync/useSyncEngine';

export type LeaveOutcome =
  | { ok: true }
  /** Nothing happened. `unsent` is distinct rows, not queued operations. */
  | { ok: false; reason: 'unsent'; unsent: number }
  /** Nothing happened, on the device or the server. */
  | { ok: false; reason: 'failed' };

export async function attemptLeaveCircle(circleId: string, userId: string): Promise<LeaveOutcome> {
  await flushOutbox();

  const unsent = new Set(pending().map((e) => e.key)).size;
  if (unsent > 0) {
    kickSync();
    return { ok: false, reason: 'unsent', unsent };
  }

  try {
    await leaveCircle(circleId, userId);
  } catch {
    return { ok: false, reason: 'failed' };
  }
  return { ok: true };
}

/**
 * The same "things" as `unsentLine`, with the specific loss named. A goal
 * staked in the room you are leaving is the one that would actually go.
 */
export function leaveUnsentLine(unsent: number): string {
  const count = unsent === 1 ? 'One thing hasn’t' : `${unsent} things haven’t`;
  return `${count} reached the server yet. Give it a moment and try again — anything you staked in here would be lost.`;
}
