/**
 * The Supabase client, built on first use and never before.
 *
 * Nothing here runs at import time. `createClient` starts a gotrue instance and
 * a realtime socket the moment it is called, so constructing one at module
 * scope would put both inside every jest suite that transitively imports this
 * file, and would open a client in `fresh`/`seeded` mode — the two account
 * modes that must make zero network calls, ever. The `require` below is lazy
 * for the same reason: a top-level `import` of supabase-js would load the
 * package even if `getSupabase()` were never called.
 *
 * No `react-native-url-polyfill/auto` import. The Supabase reference docs still
 * show it, but React Native 0.86 polyfills both `URL` and `URLSearchParams`
 * onto global itself (Libraries/Core/setUpXHR.js), and that `URL` is a real
 * implementation — `hostname`, `protocol` and `searchParams` all work, which
 * was the actual gap the polyfill existed to close. The package is not a
 * dependency of this app and adding it would be dead weight. Every `new URL`
 * inside auth-js sits on a browser-only path (`window.location`, OAuth/PKCE,
 * `detectSessionInUrl`) that anonymous sign-in never reaches.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Read once, here, and this is the one thing in this file that does run at
 * import time — deliberately, and it is not the kind of thing the note above
 * rules out. That note is about `createClient`, which opens a gotrue instance
 * and a socket. This opens nothing; it resolves a reference.
 *
 * `URL` is not a plain global under Expo. It is installed as a lazy getter
 * whose first read `require`s the implementation. `projectRef()` goes through
 * that getter, and the calls that matter come from the debounced disk writes in
 * `persistence` and `outbox` — which, in a test, can land after Jest has torn
 * the environment down. A `require` at that moment throws `You are trying to
 * import a file after the Jest environment has been torn down`: an error that
 * printed on every run, green ones included, from four suites, and that no test
 * could ever fail on.
 *
 * Reading it here runs that require while the module system is still alive and
 * leaves `projectRef` holding an ordinary reference to the constructor.
 */
const URLCtor = URL;

const url = () => process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = () => process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

let client: SupabaseClient | null = null;

/** Both env vars present and non-empty. Read live so tests can set them late. */
export function hasSupabaseConfig(): boolean {
  return url().length > 0 && anonKey().length > 0;
}

/**
 * Which Supabase project this build talks to — the first label of the API
 * hostname, which is how supabase-js names its own auth storage key.
 *
 * Anything written to disk against one project describes a world that does not
 * exist in another, so the persisted state and the outbox both stamp this and
 * refuse a payload that disagrees. Deriving it the same way supabase-js does
 * keeps one definition of "which backend is this" rather than two that can
 * drift.
 *
 * Null when there is nothing configured, which is a demo build and every jest
 * suite that does not set the env. Callers treat null as "cannot tell", never
 * as "does not match" — a check that discards on ignorance would empty the disk
 * of every test in the repo.
 */
export function projectRef(): string | null {
  const raw = url();
  if (!raw) return null;
  try {
    return new URLCtor(raw).hostname.split('.')[0] || null;
  } catch {
    return null;
  }
}

/**
 * The one client. Callers are responsible for checking `hasSupabaseConfig()`
 * and the account mode first — this throws rather than handing back a client
 * pointed at nothing.
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;
  if (!hasSupabaseConfig()) {
    throw new Error(
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env.',
    );
  }

  // Deliberately a require, and the one place in the app that uses one. A
  // top-level import would pull gotrue and realtime into every jest suite that
  // transitively touches this module, and would load them on launch in demo
  // mode — which is required to make no network machinery at all.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');

  client = createClient(url(), anonKey(), {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // On native there is no URL fragment to read a session out of, and
      // leaving this on makes gotrue reach for `window.location` on startup.
      detectSessionInUrl: false,
    },
  });
  return client;
}

export function __resetSupabaseForTests(): void {
  client = null;
}
