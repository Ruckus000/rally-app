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
  startAutoRefresh,
  currentUserId,
  ensureSession,
  linkApple,
  reportAuthFailure,
  retrySession,
  signInWithApple,
  signOutEverywhere,
} from '../session';
import { fakeApple } from '../../__mocks__/expo-apple-authentication';

const { getSupabase } = supabaseModule;

const realEnv = { ...process.env };

beforeEach(() => {
  // Jest never loads .env, and `hasSupabaseConfig()` gates every path here —
  // without these, everything below would pass by never trying.
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  fakeSupabase.reset();
  fakeApple.reset();
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
    // A fresh sign-in is anonymous, which is the fact the "Secure this account"
    // row keys off. Asserted rather than ignored: the whole of Wave D depends on
    // this being true here and false after a link.
    anonymous: true,
  });
});

it('retrying clears the latch and can reach ready again', async () => {
  const me = await signedIn();
  reportAuthFailure();

  await expect(retrySession()).resolves.toEqual({ status: 'ready', userId: me, anonymous: true });
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

/**
 * Wave D: the two Apple paths, which differ in exactly one way that matters.
 *
 * `linkApple` must leave `selfId` alone — every task and membership is owned by
 * that uuid, so a link that changed it would strand all of it. `signInWithApple`
 * must change it, because the device's throwaway id is the thing being abandoned.
 * Those two facts are the whole reason there are two functions, so both are
 * asserted on the id itself rather than on a status.
 */
describe('attaching an Apple identity', () => {
  it('keeps the same account, and stops calling it anonymous', async () => {
    const me = await signedIn();

    await expect(linkApple()).resolves.toEqual({ ok: true });

    expect(currentUserId()).toBe(me);
    expect(await ensureSession()).toEqual({ status: 'ready', userId: me, anonymous: false });
  });

  it('sends gotrue the raw nonce, not the one Apple was given', async () => {
    await signedIn();
    await linkApple();

    const call = fakeSupabase.calls.find((c) => c.method === 'auth.linkIdentity');
    const body = call?.body as { token?: string; nonce?: string } | undefined;

    // The mock digest is `${algorithm}:${data}`, so a hashed nonce arriving here
    // would carry that prefix. This is the assertion that stops the two being
    // swapped — a swap that works locally and fails against real Apple.
    expect(body?.nonce).not.toMatch(/^SHA-256:/);
    expect(body?.token).toBe('apple-identity-token');
  });

  it('hands the one-time grant to link-apple, so the account can be revoked later', async () => {
    // The identity token proves who somebody is and cannot be revoked. This
    // separate code is the only route to a refresh token, which is the only
    // thing Apple's `/auth/revoke` accepts — so a flow that quietly stopped
    // sending it would leave every Apple account unrevokable at deletion, and
    // nothing else anywhere would fail.
    await signedIn();

    await linkApple();

    const call = fakeSupabase.calls.find((c) => c.method === 'functions.invoke');
    expect(call?.table).toBe('link-apple');
    expect(call?.body).toEqual({ code: 'apple-auth-code' });
  });

  it('does not fail the link when that call cannot be made', async () => {
    // Best-effort by design, like `unregister_device`. Linking has already
    // succeeded by this point — the account is recoverable, which is what the
    // person asked for — and a missed revocation a fortnight from now is not
    // worth telling them their sign-in failed.
    const me = await signedIn();
    const invoke = jest
      .spyOn(getSupabase().functions, 'invoke')
      .mockRejectedValue(new Error('offline'));

    await expect(linkApple()).resolves.toEqual({ ok: true });

    expect(invoke).toHaveBeenCalled();
    // The link itself still landed: same account, no longer anonymous.
    expect(await ensureSession()).toEqual({ status: 'ready', userId: me, anonymous: false });
  });

  it('says nothing when the sheet is dismissed', async () => {
    await signedIn();
    fakeApple.cancels();

    await expect(linkApple()).resolves.toEqual({ ok: false, reason: 'cancelled' });
    // Still recoverable-not, and still the same account.
    expect((await ensureSession()).status).toBe('ready');
  });

  it('reports a taken identity as its own reason, because the user can act on it', async () => {
    const me = await signedIn();
    fakeSupabase.identityOwnedBy('apple-identity-token', 'somebody-else');

    await expect(linkApple()).resolves.toEqual({ ok: false, reason: 'taken' });
    expect(currentUserId()).toBe(me);
  });

  it('fails, rather than half-succeeding, on a project without manual linking', async () => {
    await signedIn();
    fakeSupabase.disableManualLinking();

    await expect(linkApple()).resolves.toEqual({ ok: false, reason: 'failed' });
    // The account must not be reported as secured when nothing was attached.
    expect((await ensureSession()) as { anonymous?: boolean }).toMatchObject({ anonymous: true });
  });
});

describe('signing back in with Apple', () => {
  it('returns the account the identity was linked to, not a new one', async () => {
    const original = await signedIn();
    await linkApple();

    // A different device: no session, no stored id, nothing local at all.
    await signOutEverywhere();
    __resetSessionForTests();

    await expect(signInWithApple()).resolves.toEqual({ ok: true });
    expect(currentUserId()).toBe(original);
  });

  it('gets an expired account back, and keeps it back across a foreground', async () => {
    const original = await signedIn();
    await linkApple();
    reportAuthFailure();
    expect(currentUserId()).toBeNull();

    await expect(signInWithApple()).resolves.toEqual({ ok: true });

    // The same account, not a replacement for it — recovering into a fresh id
    // would be the failure that looks most like success.
    expect(currentUserId()).toBe(original);
    // And it survives the next foreground rather than dropping back to the
    // banner. This is what makes the recovery worth anything.
    await expect(ensureSession()).resolves.toMatchObject({
      status: 'ready',
      userId: original,
      anonymous: false,
    });
  });

  it('is unavailable rather than failed when there is no provider', async () => {
    fakeApple.unavailable();

    await expect(signInWithApple()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});
