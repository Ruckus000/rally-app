/**
 * The session module on its own, and mostly about one thing: what happens after
 * the server stops accepting a token it once issued.
 *
 * That state has to latch. `ensureSession` runs on every foreground and
 * `getSession()` answers out of AsyncStorage, so without a latch the app would
 * read the same dead token back and call itself `ready` again, once per
 * foreground, forever.
 */
import { fakeSupabase } from '../../__mocks__/@supabase/supabase-js';
import * as supabaseModule from '../../lib/supabase';

const { getSupabase } = supabaseModule;
import {
  __resetSessionForTests,
  startAutoRefresh,
  currentUserId,
  ensureSession,
  reportAuthFailure,
  retrySession,
  signOutEverywhere,
} from '../session';

const realEnv = { ...process.env };

beforeEach(() => {
  // Jest never loads .env, and `hasSupabaseConfig()` gates every path here —
  // without these, everything below would pass by never trying.
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  fakeSupabase.reset();
  __resetSessionForTests();
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env = { ...realEnv };
});

const signedIn = async (): Promise<string> => {
  const state = await ensureSession();
  expect(state.status).toBe('ready');
  return currentUserId() as string;
};

it('leaves `ready` when the server rejects the token, and takes the sync layer with it', async () => {
  await signedIn();

  reportAuthFailure();

  // `currentUserId()` is the whole mechanism: the pull, the outbox drain and the
  // realtime channel all bail on a null id, so this one line is what stops them.
  expect(currentUserId()).toBeNull();
  await expect(ensureSession()).resolves.toEqual({ status: 'expired' });
});

it('latches, so a foreground cannot flip it back to ready off a stored token', async () => {
  await signedIn();
  reportAuthFailure();

  const quiet = fakeSupabase.calls.length;
  // Three foregrounds' worth. The session is still sitting in AsyncStorage and
  // `getSession()` would happily hand it back.
  await ensureSession();
  await ensureSession();
  const last = await ensureSession();

  expect(last).toEqual({ status: 'expired' });
  expect(fakeSupabase.calls.length).toBe(quiet);
});

it('is ignored unless we currently believe we are signed in', async () => {
  // A demo account never signs in, and must never grow a banner.
  reportAuthFailure();
  expect(currentUserId()).toBeNull();
  await expect(ensureSession()).resolves.toEqual({
    status: 'ready',
    userId: expect.any(String),
  });
});

it('retrying clears the latch and can reach ready again', async () => {
  const me = await signedIn();
  reportAuthFailure();

  await expect(retrySession()).resolves.toEqual({ status: 'ready', userId: me });
  expect(currentUserId()).toBe(me);
});

it('a retry that the server refuses again goes straight back to expired', async () => {
  await signedIn();
  reportAuthFailure();

  // The fake has no `refreshSession`, so the rejection has to be injected. This
  // is the path that matters: a refresh token the server has revoked.
  jest.spyOn(supabaseModule, 'getSupabase').mockReturnValue({
    auth: {
      refreshSession: async () => ({ error: { name: 'AuthApiError', status: 400 } }),
    },
  } as unknown as ReturnType<typeof supabaseModule.getSupabase>);

  await expect(retrySession()).resolves.toEqual({ status: 'expired' });
  expect(currentUserId()).toBeNull();
});

it('a retry in a tunnel reports offline rather than condemning the account', async () => {
  await signedIn();
  reportAuthFailure();

  // Latching `expired` here would turn a tunnel into a permanent verdict — the
  // same mistake as the bug this all fixes, pointed the other way.
  jest.spyOn(supabaseModule, 'getSupabase').mockReturnValue({
    auth: {
      refreshSession: async () => {
        throw new TypeError('Network request failed');
      },
    },
  } as unknown as ReturnType<typeof supabaseModule.getSupabase>);

  await expect(retrySession()).resolves.toEqual({ status: 'offline' });
});

it('takes gotrue signing itself out as the rejection, because nothing else will', async () => {
  await signedIn();

  // The failure that actually happens. A revoked refresh token never produces a
  // 401 this code can read: supabase-js falls back to the publishable key, so
  // requests go out as `anon` and PostgREST answers 42501 — the same code an
  // ordinary RLS refusal carries, which drops the entry. Verified against a
  // real PostgREST: HTTP 401, body `{"code":"42501"}`, and postgrest-js does not
  // put the status on the error. gotrue announcing SIGNED_OUT is the only signal
  // that distinguishes "you are nobody now" from "you may not touch that row".
  await getSupabase().auth.signOut();

  expect(currentUserId()).toBeNull();
  await expect(ensureSession()).resolves.toEqual({ status: 'expired' });
});

it('does not condemn the session it is deliberately retiring', async () => {
  await signedIn();

  // `signOut` announces SIGNED_OUT too, and the watcher cannot tell the two
  // apart. Landing on the banner here would make "Start over" unable to start.
  await signOutEverywhere();

  const next = await ensureSession();
  expect(next.status).toBe('ready');
});

/** The real client, with a `refreshSession` the fake does not have. */
const withRefresh = (refreshSession: jest.Mock) => {
  const real = getSupabase() as unknown as { auth: Record<string, unknown> };
  jest.spyOn(supabaseModule, 'getSupabase').mockReturnValue({
    ...real,
    auth: { ...real.auth, refreshSession },
  } as unknown as ReturnType<typeof supabaseModule.getSupabase>);
};

it('does not ask a project that never signed us in to refresh a token', async () => {
  fakeSupabase.setAnonymousDisabled(true);
  const failed = await ensureSession();
  expect(failed).toEqual({ status: 'error', message: expect.stringMatching(/Anonymous sign-in/) });

  // What `refreshSession` answers with no session: not a verdict on a token.
  const refreshSession = jest.fn(async () => ({
    error: { name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' },
  }));
  withRefresh(refreshSession);
  fakeSupabase.setAnonymousDisabled(false);

  const retried = await retrySession();

  // Treating that as a rejection would replace the one message naming the
  // actual misconfiguration with "this device is signed out".
  expect(refreshSession).not.toHaveBeenCalled();
  expect(retried.status).toBe('ready');
});

it('does re-test the token when there was one', async () => {
  await signedIn();
  reportAuthFailure();

  const refreshSession = jest.fn(async () => ({ error: null }));
  withRefresh(refreshSession);

  await retrySession();
  expect(refreshSession).toHaveBeenCalled();
});

it('puts the refresh timer back on the way out of the banner', async () => {
  startAutoRefresh();
  await signedIn();

  reportAuthFailure();
  expect(fakeSupabase.calls.map((c) => c.method)).toContain('auth.stopAutoRefresh');

  const before = fakeSupabase.calls.filter((c) => c.method === 'auth.startAutoRefresh').length;
  await retrySession();

  // The store only starts it on mount and on foreground, and the user is
  // looking at the screen when they tap — so without this the recovered session
  // runs with no proactive refresh, which is how it died the first time.
  const after = fakeSupabase.calls.filter((c) => c.method === 'auth.startAutoRefresh').length;
  expect(after).toBeGreaterThan(before);
});

it('a foreground landing mid sign-out does not resurrect the session', async () => {
  await signedIn();

  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const real = getSupabase() as unknown as { auth: Record<string, unknown> };
  const realSignOut = real.auth.signOut as () => Promise<unknown>;
  jest.spyOn(supabaseModule, 'getSupabase').mockReturnValue({
    ...real,
    auth: {
      ...real.auth,
      signOut: async () => {
        await gate;
        return realSignOut.call(real.auth);
      },
    },
  } as unknown as ReturnType<typeof supabaseModule.getSupabase>);

  const out = signOutEverywhere();
  // The AppState listener fires on every foreground, including this instant.
  // Signing in here would read back the session being destroyed, and the
  // SIGNED_OUT still in flight would then condemn it — so "Start over" would
  // hand the user straight back to the banner it was meant to clear.
  expect((await ensureSession()).status).toBe('off');

  release();
  await out;
  expect(currentUserId()).toBeNull();
  expect((await ensureSession()).status).toBe('ready');
});

it('signing out clears the latch, so the next sign-in is allowed to work', async () => {
  await signedIn();
  reportAuthFailure();

  await signOutEverywhere();

  const next = await ensureSession();
  expect(next.status).toBe('ready');
});
