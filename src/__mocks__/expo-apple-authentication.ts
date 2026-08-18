/**
 * expo-apple-authentication, as much of it as this app uses.
 *
 * A recording fake rather than a bag of stubs, for the reason the Supabase and
 * expo-notifications doubles are: the interesting questions are *what was Apple
 * actually sent* and *which way did it fail*, and a stub returning a fixed
 * credential answers neither while leaving every test green.
 *
 * It records `nonce` specifically. `appleAuth.ts` must send Apple the **hashed**
 * nonce and Supabase the **raw** one, and swapping them is a mistake no assertion
 * about the happy path would catch — the flow still completes, it just fails
 * against real Apple. `lastNonce` is what makes that pinnable.
 */

/** Apple's own code for a dismissed sheet, which the real module rejects with. */
export const CANCELLED_CODE = 'ERR_REQUEST_CANCELED';

type Credential = {
  user: string;
  identityToken: string | null;
  authorizationCode: string | null;
  email: string | null;
  fullName: null;
  state: string | null;
  realUserStatus: number;
};

type Outcome =
  | { kind: 'credential'; identityToken: string | null }
  | { kind: 'cancel' }
  | { kind: 'throw'; message: string };

const state = {
  available: true,
  availabilityThrows: false,
  outcome: { kind: 'credential', identityToken: 'apple-identity-token' } as Outcome,
  lastNonce: null as string | null,
  lastScopes: null as unknown[] | null,
  calls: 0,
};

export const fakeApple = {
  reset(): void {
    state.available = true;
    state.availabilityThrows = false;
    state.outcome = { kind: 'credential', identityToken: 'apple-identity-token' };
    state.lastNonce = null;
    state.lastScopes = null;
    state.calls = 0;
  },
  /** Android, or an iOS too old for the provider. */
  unavailable(): void {
    state.available = false;
  },
  /** `isAvailableAsync` itself failing — a build without the native module. */
  availabilityThrows(): void {
    state.availabilityThrows = true;
  },
  /** The user dismissed Apple's sheet. Not an error. */
  cancels(): void {
    state.outcome = { kind: 'cancel' };
  },
  /** Anything else: no network, provider not configured. */
  fails(message = 'apple failed'): void {
    state.outcome = { kind: 'throw', message };
  },
  /** Apple answered, but withheld the one field that matters. */
  withholdsToken(): void {
    state.outcome = { kind: 'credential', identityToken: null };
  },
  /** What Apple was handed. Should be the *hashed* nonce, never the raw one. */
  lastNonce(): string | null {
    return state.lastNonce;
  },
  lastScopes(): unknown[] | null {
    return state.lastScopes;
  },
  calls(): number {
    return state.calls;
  },
};

export async function isAvailableAsync(): Promise<boolean> {
  if (state.availabilityThrows) throw new Error('no native module');
  return state.available;
}

export async function signInAsync(
  options?: { requestedScopes?: unknown[]; nonce?: string },
): Promise<Credential> {
  state.calls += 1;
  state.lastNonce = options?.nonce ?? null;
  state.lastScopes = options?.requestedScopes ?? null;

  const outcome = state.outcome;
  if (outcome.kind === 'cancel') {
    const err = new Error('The user canceled the authorization attempt') as Error & {
      code?: string;
    };
    err.code = CANCELLED_CODE;
    throw err;
  }
  if (outcome.kind === 'throw') throw new Error(outcome.message);

  return {
    user: 'apple-user-id',
    identityToken: outcome.identityToken,
    authorizationCode: 'apple-auth-code',
    email: null,
    fullName: null,
    state: null,
    realUserStatus: 1,
  };
}
