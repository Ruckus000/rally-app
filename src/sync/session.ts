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

async function resolveSession(): Promise<SessionState> {
  const supabase = getSupabase();

  try {
    // Reads AsyncStorage, not the network — this is the path that works on a
    // plane, and the reason sign-in is not attempted on every launch.
    const { data, error } = await supabase.auth.getSession();
    if (!error && data.session) return set({ status: 'ready', userId: data.session.user.id });

    const signIn = await supabase.auth.signInAnonymously();
    if (signIn.error) throw signIn.error;
    if (!signIn.data.session) return set({ status: 'error', message: 'Sign-in returned no session.' });

    return set({ status: 'ready', userId: signIn.data.session.user.id });
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
  if (state.status === 'ready') return state;
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

export async function signOutEverywhere(): Promise<void> {
  stopAutoRefresh();
  if (hasSupabaseConfig()) {
    await forgetThisDevice();
    try {
      await getSupabase().auth.signOut({ scope: 'global' });
    } catch {
      // A sign-out that never reached the server still has to clear locally,
      // or the app is stuck signed in to a session it is refusing to use.
    }
  }
  fatal = null;
  set(OFF);
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
  listeners.clear();
}
