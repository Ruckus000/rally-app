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
 * Whether the delete-account row appears at all.
 *
 * Every live account, and deliberately **not** `signOutVisible`, which is the
 * distinction worth reading twice. Sign-out is withheld from an anonymous
 * account because it cannot come back — and that is precisely the argument for
 * *offering* this one to it. An account nobody can sign back into is an account
 * whose only way to stop existing is this row; withholding it would leave the
 * people with the least control over their data with none at all.
 *
 * Guideline 5.1.1(v) also wants the control easy to find and offered to
 * everyone, so a rule that hid it from most Android installs would fail review
 * as well as being wrong.
 */
export function deleteVisible(account: AccountMode | null): boolean {
  return account === 'live';
}

/**
 * Whether that row does anything when tapped.
 *
 * Needs a resolved session, because the RPC behind it reads `auth.uid()` and an
 * unresolved session has none to read. Visible-but-disabled rather than absent,
 * for the reason `secureUnavailable` gives at length: a control that comes and
 * goes with connectivity reads as a bug, and this is the row somebody will go
 * looking for when they have decided to leave.
 */
export function deleteEnabled(session: SessionState): boolean {
  return session.status === 'ready';
}

/**
 * Whether to offer Apple linking.
 *
 * `MeScreen`'s own "Secure this account" row calls this directly rather than
 * keeping its own copy of the rule — the Me card and the Settings row offer
 * the same action, so there is exactly one place that decides who gets it.
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

/**
 * Whether to show that row **greyed out**, rather than not at all.
 *
 * `canSecure` needs the `anonymous` claim, and only a resolved session carries
 * one — so on a phone in a tunnel the whole "Getting back in" section used to
 * vanish with no explanation. That is the same absence `signOutVisible` refuses
 * to create, for the same reason: a control that appears and disappears with
 * connectivity reads as a bug, and the person most likely to go looking for
 * this row is the one whose session is not resolving.
 *
 * Shown to a session that may already be secured, and that is on purpose. The
 * device cannot tell without the claim, and `isAnonymous` in `sync/session.ts`
 * already settles which way to guess when it cannot know: an extra row offered
 * to an account that is already safe costs nothing, where hiding it from one
 * that is not leaves somebody believing they are covered.
 *
 * `off` is excluded, and it is the one exclusion worth naming. `off` is not a
 * session that failed to resolve — it is a build with no server behind it at
 * all, where "needs a connection" would be a lie about a connection that is
 * never coming. `accountLine` says that outright, so there is nothing left for
 * a disabled row to add.
 */
export function secureUnavailable(
  account: AccountMode | null,
  session: SessionState,
  platform: typeof Platform.OS,
): boolean {
  if (account !== 'live') return false;
  if (platform !== 'ios') return false;
  return (
    session.status === 'signing-in' ||
    session.status === 'offline' ||
    session.status === 'expired' ||
    session.status === 'error'
  );
}
