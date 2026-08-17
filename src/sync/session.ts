/**
 * The anonymous session, and the only place that decides whether this install
 * talks to a server at all.
 *
 * Everything here resolves. Nothing rejects. Sign-in sits nowhere near the path
 * between a tap and a render, so its failure modes are states the UI can show,
 * not exceptions someone has to catch — losing the network is the normal case,
 * not an error.
 */
import { getSupabase, hasSupabaseConfig } from '../lib/supabase';
import { getPushToken } from '../lib/push';

export type SessionState =
  | { status: 'off' } // demo mode or no config — never touches the network
  | { status: 'signing-in' }
  | { status: 'ready'; userId: string }
  | { status: 'offline' } // tried, no network; retries
  | { status: 'expired' } // the server rejected this token and a refresh did not help
  | { status: 'error'; message: string };

const OFF: SessionState = { status: 'off' };

let state: SessionState = OFF;
let inFlight: Promise<SessionState> | null = null;
let refreshing = false;
/**
 * A misconfigured project is not worth re-asking. `anonymous_provider_disabled`
 * will answer the same way forever, and ensureSession is called from an AppState
 * listener that fires on every foreground — retrying would be a tight loop
 * against a 422.
 */
let fatal: string | null = null;
/**
 * Latched for the same reason `fatal` is, and it matters more here. `ensureSession`
 * runs on every foreground, and `getSession()` answers out of AsyncStorage — so a
 * token the server has stopped accepting is still a token it hands back, and every
 * foreground would flip `expired` → `ready` and straight back on the next request.
 * A banner that blinks is worse than no banner.
 *
 * Cleared only by something the user did: `retrySession` or `signOutEverywhere`.
 */
let expired = false;

const listeners = new Set<(s: SessionState) => void>();

function set(next: SessionState): SessionState {
  state = next;
  for (const fn of listeners) fn(next);
  return next;
}

/**
 * gotrue wraps a failed `fetch` as AuthRetryableFetchError with status 0, so a
 * dead network is distinguishable from a server that answered. Duck-typed
 * rather than `instanceof` — importing the error class would pull supabase-js
 * in at module scope, which is exactly what the lazy client avoids.
 */
function isOffline(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; status?: number; message?: string };
  if (e.name === 'AuthRetryableFetchError') return true;
  if (e.status === 0) return true;
  return /network request failed|failed to fetch/i.test(e.message ?? '');
}

function describe(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const e = err as { code?: string; message?: string };
  if (e.code === 'anonymous_provider_disabled') {
    return 'Anonymous sign-in is disabled on this Supabase project. Enable it under Authentication → Sign In / Providers → Anonymous sign-ins.';
  }
  return e.message ?? 'Sign-in failed.';
}

/** Non-retryable: the server answered, and it will answer the same way again. */
function isFatal(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string };
  return e.code === 'anonymous_provider_disabled';
}

/**
 * True only while `signOutEverywhere` is in flight.
 *
 * gotrue announces SIGNED_OUT for a sign-out we asked for exactly as it does for
 * one the server imposed, and `watchAuth` cannot tell them apart. `set(OFF)`
 * alone does not close the gap: `signOut` is awaited, and a foreground landing
 * inside that await calls `ensureSession`, reads the not-yet-cleared session
 * back to `ready`, and is then condemned by the SIGNED_OUT that follows — so
 * "Start over" would hand the user straight back to the banner.
 */
let signingOut = false;

let watching = false;

/**
 * gotrue's own verdict, and the only warning we get for the failure that
 * actually happens.
 *
 * A revoked or expired refresh token does not produce a 401 anywhere this code
 * can see. supabase-js falls back to the publishable key when it cannot produce
 * a session (`_getAccessToken`: `data.session?.access_token ?? this.supabaseKey`),
 * so every request afterwards goes out as `anon` and PostgREST answers 42501 —
 * "permission denied for table tasks" — which is indistinguishable from an
 * ordinary RLS refusal and gets the entry dropped. The HTTP status *is* 401, but
 * postgrest-js puts that on the response rather than on the error object, so it
 * never reaches the classifier.
 *
 * gotrue knows, though: it clears the session and announces SIGNED_OUT. That is
 * this subscription's whole job.
 */
function watchAuth(): void {
  if (watching) return;
  watching = true;
  getSupabase().auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' && !session && !signingOut) reportAuthFailure();
  });
}

/**
 * Every road to `ready` goes through here, because every one of them has to put
 * the refresh timer back.
 *
 * `reportAuthFailure` stops it — refreshing a rejected token is a timer burning
 * for nothing — and the store only ever starts it on mount and on foreground.
 * Neither of those happens when the user taps their way out of the banner while
 * looking at the screen, so recovery would otherwise return to a session that
 * never proactively refreshes, which is the state that produced the banner.
 */
function ready(userId: string): SessionState {
  startAutoRefresh();
  return set({ status: 'ready', userId });
}

async function resolveSession(): Promise<SessionState> {
  const supabase = getSupabase();
  watchAuth();

  try {
    // Reads AsyncStorage, not the network — this is the path that works on a
    // plane, and the reason sign-in is not attempted on every launch.
    const { data, error } = await supabase.auth.getSession();
    if (!error && data.session) return ready(data.session.user.id);

    const signIn = await supabase.auth.signInAnonymously();
    if (signIn.error) throw signIn.error;
    if (!signIn.data.session) return set({ status: 'error', message: 'Sign-in returned no session.' });

    return ready(signIn.data.session.user.id);
  } catch (err) {
    if (isOffline(err)) return set({ status: 'offline' });
    const message = describe(err);
    if (isFatal(err)) fatal = message;
    return set({ status: 'error', message });
  }
}

/**
 * Idempotent and safe to call on every foreground. Concurrent callers share one
 * attempt so a foreground during a cold start does not sign in twice.
 */
export async function ensureSession(): Promise<SessionState> {
  if (!hasSupabaseConfig()) return set(OFF);
  // A foreground can land inside `signOutEverywhere`'s await. Signing in there
  // would race the sign-out it is standing next to, and read back the session it
  // is in the middle of destroying.
  if (signingOut) return state;
  if (state.status === 'ready') return state;
  if (expired) return set({ status: 'expired' });
  if (fatal) return set({ status: 'error', message: fatal });
  if (inFlight) return inFlight;

  set({ status: 'signing-in' });
  inFlight = resolveSession().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Stop this phone receiving the departing account's notifications.
 *
 * Before `signOut`, and awaited, because `unregister_device` deletes the row
 * matching `auth.uid()` — a session this has to still have. Deliberately not
 * queued through the outbox either, and that is the subtler half: the queue
 * stamps identity at *send* time, so a deregistration still waiting on signal
 * when somebody else signs in on this phone would delete **their** brand-new
 * registration instead of the one it was written for.
 *
 * Best-effort. A sign-out that cannot reach the network still has to complete
 * locally, and the row it leaves behind is repaired by the next person to
 * register on this device — `register_device` moves the row rather than adding
 * one, which is why the token is the primary key.
 */
async function forgetThisDevice(): Promise<void> {
  try {
    const token = await getPushToken();
    if (!token) return;
    await getSupabase().rpc('unregister_device', { p_token: token.token });
  } catch {
    // Offline, or no permission and so no token to forget. Neither is a
    // reason to keep somebody signed in.
  }
}

/**
 * The sync layer found out the hard way: a request came back 401 and the refresh
 * the transport already tried did not fix it.
 *
 * This is the only way out of `ready`, and moving out of it is what stops the
 * whole sync layer — `currentUserId()` answers null for every other status, and
 * the pull, the outbox drain and the realtime channel all bail on a null id. So
 * one report quiesces everything without a single new flag to poll.
 *
 * Ignored unless we currently believe we are signed in: reports can only come
 * from a live account mid-request, and a demo account must never grow a banner.
 */
export function reportAuthFailure(): void {
  if (state.status !== 'ready') return;
  expired = true;
  // Refreshing a token the server has rejected is a timer burning for nothing.
  stopAutoRefresh();
  set({ status: 'expired' });
}

/**
 * Whether the refresh token is still worth anything, asked over the wire.
 *
 * `resolveSession` alone cannot answer this: `getSession()` reads AsyncStorage,
 * so it would hand back the same dead token and report `ready` — the retry would
 * look like it worked right up until the next request failed.
 */
async function refreshed(): Promise<'ok' | 'offline' | 'rejected'> {
  const auth = getSupabase().auth as { refreshSession?: () => Promise<{ error: unknown }> };
  // Not every client can refresh — the unit double has no `refreshSession` — and
  // one that cannot should fall through to `resolveSession` rather than latch.
  if (typeof auth.refreshSession !== 'function') return 'ok';
  try {
    const { error } = await auth.refreshSession();
    if (!error) return 'ok';
    return isOffline(error) ? 'offline' : 'rejected';
  } catch (err) {
    return isOffline(err) ? 'offline' : 'rejected';
  }
}

/**
 * "Try again" on the banner. Clears the latch and re-tests the token for real.
 *
 * A retry tapped on a plane must not latch `expired` again — that would turn a
 * tunnel into a permanent verdict on the account, which is the same mistake as
 * the bug this all fixes, just pointed the other way.
 */
export async function retrySession(): Promise<SessionState> {
  if (!hasSupabaseConfig()) return set(OFF);
  if (inFlight) return inFlight;

  /**
   * Only a session that once existed is worth re-testing. An `error` never got
   * one — a project with anonymous sign-ins disabled is the case that reaches
   * the banner — so `refreshSession` would answer `AuthSessionMissingError`,
   * which is not a verdict on any token. Latching `expired` on it would trade
   * the one message naming the actual misconfiguration for "this device is
   * signed out", and offer a "Start over" that cannot mint an identity either.
   */
  const hadSession = state.status === 'expired';

  expired = false;
  fatal = null;
  set({ status: 'signing-in' });

  inFlight = (async (): Promise<SessionState> => {
    if (!hadSession) return resolveSession();
    const outcome = await refreshed();
    if (outcome === 'ok') return resolveSession();
    if (outcome === 'offline') return set({ status: 'offline' });
    expired = true;
    return set({ status: 'expired' });
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export async function signOutEverywhere(): Promise<void> {
  stopAutoRefresh();
  fatal = null;
  expired = false;
  signingOut = true;
  // Before the call, not after, so the sync layer stops immediately rather than
  // for the length of a round trip it does not need to wait on.
  set(OFF);
  try {
    if (hasSupabaseConfig()) {
      await forgetThisDevice();
      try {
        await getSupabase().auth.signOut({ scope: 'global' });
      } catch {
        // A sign-out that never reached the server still has to clear locally,
        // or the app is stuck signed in to a session it is refusing to use.
      }
    }
  } finally {
    signingOut = false;
  }
}

export function currentUserId(): string | null {
  return state.status === 'ready' ? state.userId : null;
}

export function onSessionChange(fn: (s: SessionState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Not optional on React Native. supabase-js only refreshes while it is told the
 * app is in front: leave it running in the background and it burns a timer for
 * nothing, leave it stopped and the access token quietly expires so the first
 * write after a foreground 401s. The store drives both from its AppState
 * listener.
 */
export function startAutoRefresh(): void {
  if (refreshing || !hasSupabaseConfig()) return;
  refreshing = true;
  // Both of these are async, and a refresh that fails offline is not news —
  // swallowing keeps it off the unhandled-rejection path.
  void getSupabase().auth.startAutoRefresh().catch(() => {});
}

export function stopAutoRefresh(): void {
  if (!refreshing) return;
  refreshing = false;
  void getSupabase().auth.stopAutoRefresh().catch(() => {});
}

export function __resetSessionForTests(): void {
  state = OFF;
  inFlight = null;
  refreshing = false;
  fatal = null;
  expired = false;
  watching = false;
  signingOut = false;
  listeners.clear();
}
