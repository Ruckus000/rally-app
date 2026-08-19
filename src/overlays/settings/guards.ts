/**
 * Which account controls a given account is offered.
 *
 * Pure, and separate from the overlay that renders them, because these are the
 * rules that decide whether somebody is shown an irreversible action. A rule
 * that can only be exercised by mounting a screen is a rule that gets tested
 * shallowly, and this is not the place for that.
 *
 * `Platform` is passed in rather than read here for the same reason: the
 * Android case is a real branch with a real consequence, and it should be
 * assertable without a native module.
 */
import type { Platform } from 'react-native';
import type { AccountMode } from '../../data/seed';
import type { SessionState } from '../../sync/session';

/**
 * Whether the sign-out row appears at all.
 *
 * Withheld from an anonymous account, which is the whole safety property here:
 * nothing but that session holds the uuid, so signing out would strand
 * everything the account owns on the server with no way back to it. The row is
 * absent rather than present-and-warned — "Secure this account" occupies the
 * same place and is the action that makes leaving safe.
 *
 * Deliberately still visible when the session is unresolved. `anonymous` is a
 * JWT claim, so an offline device cannot tell secured from anonymous; hiding
 * the row would make it appear and vanish with connectivity, which reads as a
 * bug. It renders disabled instead — see `signOutEnabled`.
 */
export function signOutVisible(account: AccountMode | null, session: SessionState): boolean {
  if (account !== 'live') return false;
  return !(session.status === 'ready' && session.anonymous);
}

/**
 * Whether that row does anything when tapped.
 *
 * Note what is *not* here: the outbox. Gating this on an empty queue would grey
 * the button out for work that the flush is about to send, so the queue is
 * checked after the flush instead, in `attemptSignOut`.
 */
export function signOutEnabled(session: SessionState): boolean {
  return session.status === 'ready' && !session.anonymous;
}

/**
 * Whether to offer Apple linking.
 *
 * `MeScreen` computes this same predicate inline today, against the same
 * `state.session` and `Platform.OS`, rather than calling this function — so
 * there are two copies of one rule and nothing stops them drifting apart.
 * That's real duplication, not a mirrored guarantee: it exists because this
 * function didn't, until now. Task 6 folds `MeScreen` onto this one and
 * retires the inline copy; until then, a change here needs the same change
 * there.
 */
export function canSecure(
  account: AccountMode | null,
  session: SessionState,
  platform: typeof Platform.OS,
): boolean {
  if (account !== 'live') return false;
  if (platform !== 'ios') return false;
  return session.status === 'ready' && session.anonymous;
}
