/**
 * What Apple said, and nothing at all about what to do with it.
 *
 * The native edge, in the shape `push.ts` established: one question asked of one
 * native module, no knowledge of sessions or state, and it never throws. What it
 * deliberately does *not* borrow from `push.ts` is `null` as the only failure,
 * because the ways this fails have to reach the user differently.
 *
 * A **cancelled** sheet is not an error. Somebody opened Apple's dialog, thought
 * better of it, and dismissed it. A line of red under the button would be the app
 * telling them off for changing their mind. Everything else — no network, a
 * provider that was never configured, a token Apple withheld — is a real failure
 * and has to say so, or the button reads as broken.
 *
 * `supabase/functions/_shared/verdict.mjs` draws the same distinction for the
 * same reason, and is worth reading beside this one: collapsing "it did not
 * answer" into a single value is how you end up with the wrong behaviour on one
 * of the two.
 */
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';

export type AppleOutcome =
  | { ok: true; identityToken: string; rawNonce: string }
  /**
   * `cancelled` says nothing to the user. `unavailable` and `failed` are both
   * worth a line, and the caller owns the wording — Apple's own messages are
   * written for a developer reading a console.
   */
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'failed' };

/** What `signInAsync` rejects with when the sheet is dismissed. */
const CANCELLED = 'ERR_REQUEST_CANCELED';

/**
 * Duck-typed rather than `instanceof`, for the same reason `session.ts` checks
 * offline errors that way: matching on a class means importing it, and the
 * import is the thing being avoided.
 */
function isCancellation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as { code?: string }).code === CANCELLED;
}

/**
 * An Apple identity token for this device, and the nonce it was minted against.
 *
 * Both halves are returned because the two consumers need different forms of the
 * same secret, and getting that backwards is the mistake this comment exists to
 * prevent: **Apple is sent the hash, Supabase is sent the raw value.** Apple
 * echoes whatever it is given into the token's `nonce` claim, and Supabase hashes
 * the raw value to compare against that claim — so handing the hash to both would
 * compare a hash against the hash of a hash, and fail every time.
 */
export async function requestAppleIdentity(): Promise<AppleOutcome> {
  // iOS only, and there is nothing to fall back to: Android needs Google, which
  // is a different provider and a different identity, not a different code path.
  if (Platform.OS !== 'ios') return { ok: false, reason: 'unavailable' };

  try {
    if (!(await AppleAuthentication.isAvailableAsync())) {
      return { ok: false, reason: 'unavailable' };
    }
  } catch {
    // An older iOS, or the module missing from a build that predates it. Either
    // way the button cannot work here, which is not the same as it going wrong.
    return { ok: false, reason: 'unavailable' };
  }

  try {
    const rawNonce = randomUUID();
    const hashed = await digestStringAsync(CryptoDigestAlgorithm.SHA256, rawNonce);

    const credential = await AppleAuthentication.signInAsync({
      // No scopes, deliberately. This app has never wanted Apple's name or
      // email: onboarding asks for the name it displays, and Wave C settled
      // that a live account shows its circle rather than a handle. Requesting
      // contact details in order to discard them buys the user nothing and
      // leaves us holding something we would then have to justify.
      requestedScopes: [],
      nonce: hashed,
    });

    // Documented as nullable, and there is nothing to send without it.
    if (!credential.identityToken) return { ok: false, reason: 'failed' };

    return { ok: true, identityToken: credential.identityToken, rawNonce };
  } catch (err) {
    return { ok: false, reason: isCancellation(err) ? 'cancelled' : 'failed' };
  }
}
