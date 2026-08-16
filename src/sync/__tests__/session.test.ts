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
import {
  __resetSessionForTests,
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

it('signing out clears the latch, so the next sign-in is allowed to work', async () => {
  await signedIn();
  reportAuthFailure();

  await signOutEverywhere();

  const next = await ensureSession();
  expect(next.status).toBe('ready');
});
