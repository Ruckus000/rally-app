/**
 * Which nonce goes where, and the three separate ways there is no token.
 *
 * The nonce pair is the dangerous part. Apple must be sent the **hash** and
 * Supabase the **raw** value, and sending the same one to both still completes
 * every local flow — it only fails against real Apple, on a device, which is the
 * one place this cannot be tested cheaply. So it is pinned here, by asserting
 * against what the fake recorded rather than against the happy path.
 *
 * The failure reasons matter for the same reason `verdict.mjs` splits its two: a
 * cancelled sheet must reach the user as silence and everything else as a line of
 * copy, so flattening them would be a visible bug rather than a tidier type.
 */
import { Platform } from 'react-native';
import { requestAppleIdentity } from '../appleAuth';
import { fakeApple } from '../../__mocks__/expo-apple-authentication';

beforeEach(() => {
  fakeApple.reset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('when Apple answers', () => {
  it('returns the token, and the raw nonce beside it', async () => {
    const outcome = await requestAppleIdentity();

    expect(outcome).toEqual({
      ok: true,
      identityToken: 'apple-identity-token',
      rawNonce: expect.any(String),
      // The grant, carried beside the identity token and wanted for a different
      // job: the identity token proves who somebody is and cannot be revoked,
      // this is spent server-side for a refresh token, and a refresh token is
      // the only thing Apple's `/auth/revoke` accepts.
      authorizationCode: 'apple-auth-code',
    });
  });

  it('sends Apple the hashed nonce and keeps the raw one for Supabase', async () => {
    const outcome = await requestAppleIdentity();
    if (!outcome.ok) throw new Error('expected an identity');

    // The mock digest is `${algorithm}:${data}`, so this asserts the raw value
    // went through a hash rather than straight out — and, crucially, that what
    // Apple got is *not* what the caller is handed.
    expect(fakeApple.lastNonce()).toBe(`SHA-256:${outcome.rawNonce}`);
    expect(fakeApple.lastNonce()).not.toBe(outcome.rawNonce);
  });

  it('asks for no scopes at all', async () => {
    await requestAppleIdentity();

    // Requesting a name or an email in order to discard it is the thing this
    // deliberately does not do. A future edit that adds a scope should have to
    // change a test that says so.
    expect(fakeApple.lastScopes()).toEqual([]);
  });
});

describe('when there is no token', () => {
  it('calls a dismissed sheet cancelled, which the UI says nothing about', async () => {
    fakeApple.cancels();

    expect(await requestAppleIdentity()).toEqual({ ok: false, reason: 'cancelled' });
  });

  it('calls anything else failed', async () => {
    fakeApple.fails('no network');

    expect(await requestAppleIdentity()).toEqual({ ok: false, reason: 'failed' });
  });

  it('fails when Apple answers but withholds the identity token', async () => {
    // Documented as nullable. Without this branch the caller would be handed
    // `identityToken: null` and Supabase would reject it a layer later, where
    // the reason is much harder to read.
    fakeApple.withholdsToken();

    expect(await requestAppleIdentity()).toEqual({ ok: false, reason: 'failed' });
  });
});

describe('when the provider is not there', () => {
  it('is unavailable, and never opens a sheet', async () => {
    fakeApple.unavailable();

    expect(await requestAppleIdentity()).toEqual({ ok: false, reason: 'unavailable' });
    expect(fakeApple.calls()).toBe(0);
  });

  it('is unavailable when the availability check itself throws', async () => {
    fakeApple.availabilityThrows();

    expect(await requestAppleIdentity()).toEqual({ ok: false, reason: 'unavailable' });
    expect(fakeApple.calls()).toBe(0);
  });

  it('is unavailable on Android without touching the module', async () => {
    // Android needs Google, which is a different provider — not this one with a
    // branch in it. Asserting `calls()` is what stops the platform guard being
    // deleted in favour of the availability check, which the fake would pass.
    jest.replaceProperty(Platform, 'OS', 'android');

    expect(await requestAppleIdentity()).toEqual({ ok: false, reason: 'unavailable' });
    expect(fakeApple.calls()).toBe(0);
  });
});
