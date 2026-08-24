/**
 * Asking to be deleted, and taking it back.
 *
 * Sibling of `signOut.ts`, and the differences between the two are the whole
 * of this file.
 *
 * **The server goes first, and nothing local moves until it answers.** A
 * sign-out that fails offline still has to complete on the device, because the
 * alternative is an app stuck signed in to a session it refuses to use. The
 * opposite is true here: a schedule that never reached the server, followed by
 * a local wipe, would drop somebody at the Welcome screen believing their
 * account was being deleted while it went on existing. So the order is
 * strictly RPC, then queues, then session — and a failure at the first step
 * leaves the phone exactly as it was.
 *
 * **Unsent work does not refuse it.** `attemptSignOut` fails closed on a
 * non-empty outbox, because sign-out leaves the data on the server and losing
 * the last thing you wrote would be a silent theft. Deletion is asking for all
 * of it to go, so refusing on the grounds that some of it has not arrived yet
 * would be asking somebody to wait for a write in order to destroy it. The
 * queues are cleared instead — and they have to be, or a drain that outlives
 * the wipe writes rows back at an account that is being deleted. The server
 * would refuse them (`42501`, by policy), so this is tidiness rather than
 * safety, but a dead-letter list full of refusals is a support ticket.
 *
 * **The session survives.** `endSessionLocally` is `signOutEverywhere` minus
 * `auth.signOut`, and that omission is the way back — see its own comment.
 */
import { clearOutbox } from '../../sync/outbox';
import { clearMedia } from '../../sync/media';
import { endSessionLocally } from '../../sync/session';
import { cancelAccountDeletion, scheduleAccountDeletion } from '../../sync/transport';

export type ScheduleOutcome =
  /** `at` is the server's timestamp, which is what the way back counts from. */
  | { ok: true; at: string }
  /** Nothing happened, on the device or the server. */
  | { ok: false };

export async function attemptScheduleDeletion(): Promise<ScheduleOutcome> {
  let at: string;
  try {
    at = await scheduleAccountDeletion();
  } catch {
    // Deliberately no detail. Every failure here is the same failure from the
    // user's side — it did not happen, try again — and the alternatives are a
    // PostgREST code or a network message, neither of which is theirs to read.
    return { ok: false };
  }

  // Only now. Everything below this line is unconditional and cannot fail in a
  // way worth reporting: the account is already scheduled, and a phone that
  // kept its queue would only discover that the server refuses its writes.
  await clearOutbox();
  await clearMedia();
  await endSessionLocally();
  return { ok: true, at };
}

/**
 * Stay after all.
 *
 * Spends the session `endSessionLocally` left on disk. Returns false rather
 * than throwing, because the only caller draws one line under a button.
 *
 * Safe to call when nothing is scheduled — the RPC is a no-op then — so any
 * path that means "I am staying" can call it without asking first.
 */
export async function attemptCancelDeletion(): Promise<boolean> {
  try {
    await cancelAccountDeletion();
    return true;
  } catch {
    return false;
  }
}

/**
 * The date the account goes, from the timestamp the server handed back.
 *
 * Fourteen days, matching the migration. The constant is duplicated rather
 * than fetched, and that is a considered trade: the server's copy is the one
 * that decides, this one only decides what a sentence says, and a round trip
 * to render a date on a screen the user is already looking at would be worse
 * than a number in two places. If they disagree the server wins and the copy
 * is wrong by a day — which is why the screen says "on or after".
 */
export const GRACE_DAYS = 14;

export function deletionDate(at: string): Date {
  const start = new Date(at);
  return new Date(start.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
}

/** "3 September" — no year, because it is always inside a fortnight. */
export function deletionDateLine(at: string): string {
  return deletionDate(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}
