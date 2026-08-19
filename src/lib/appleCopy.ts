/**
 * The one place an Apple failure becomes a sentence.
 *
 * Two screens ask the same question — the Welcome screen when somebody signs back
 * in, and Me when somebody secures the account they already have — and they must
 * not answer it in two voices. Two real consumers of one rule is the threshold
 * this repo extracts at, and the drift it avoids is specific: `taken` is the only
 * reason here a person can actually do something about, so the wording that
 * explains it is the wording most worth having in one copy.
 *
 * `cancelled` is deliberately absent. A dismissed sheet produces no line at all,
 * and giving it a string here would invite somebody to render it — so the type
 * refuses rather than the caller remembering.
 */
import type { AppleResult } from '../sync/session';

/** Every reason except `cancelled`, which has no copy by design. */
type Speakable = Exclude<Extract<AppleResult, { ok: false }>['reason'], 'cancelled'>;

const COPY: Record<Speakable, string> = {
  // The button should not have been tappable, so this is close to unreachable —
  // and still worth a line rather than silence if it ever is.
  unavailable: 'Sign in with Apple isn’t available on this device.',
  // The actionable one. It means two accounts exist and this Apple id belongs to
  // the other; the app cannot merge them, so it says what happened plainly
  // instead of implying a retry would help.
  taken: 'That Apple ID is already on another Rally account. Sign in with it instead.',
  failed: 'Couldn’t reach Apple just now. Try again in a moment.',
};

export function appleTrouble(reason: Speakable): string {
  return COPY[reason];
}
