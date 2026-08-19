/**
 * Who is offered what, stated as a table rather than discovered by rendering.
 *
 * The load-bearing rule: sign-out is offered only to an account that can be got
 * back. An anonymous account that signs out is gone — nothing else holds that
 * uuid — so rather than ship that behind a warning, the control is absent and
 * "Secure this account" stands in its place.
 */
import { canSecure, signOutEnabled, signOutVisible } from '../guards';
import type { SessionState } from '../../../sync/session';

const READY_SECURED: SessionState = { status: 'ready', userId: 'u1', anonymous: false };
const READY_ANON: SessionState = { status: 'ready', userId: 'u1', anonymous: true };
const OFFLINE: SessionState = { status: 'offline' };
const EXPIRED: SessionState = { status: 'expired' };
const OFF: SessionState = { status: 'off' };

describe('signOutVisible', () => {
  it('is offered to a secured live account', () => {
    expect(signOutVisible('live', READY_SECURED)).toBe(true);
  });

  it('is withheld from an anonymous account, which could not come back', () => {
    expect(signOutVisible('live', READY_ANON)).toBe(false);
  });

  it('is withheld from the demo, which has no account to leave', () => {
    expect(signOutVisible('seeded', OFF)).toBe(false);
    expect(signOutVisible('fresh', OFF)).toBe(false);
    expect(signOutVisible(null, OFF)).toBe(false);
  });

  it('stays on screen when the session is unresolved, rather than blinking out', () => {
    expect(signOutVisible('live', OFFLINE)).toBe(true);
    expect(signOutVisible('live', EXPIRED)).toBe(true);
  });
});

describe('signOutEnabled', () => {
  it('is tappable only once the session says the account is secured', () => {
    expect(signOutEnabled(READY_SECURED)).toBe(true);
  });

  it('is not tappable without a resolved session', () => {
    expect(signOutEnabled(OFFLINE)).toBe(false);
    expect(signOutEnabled(EXPIRED)).toBe(false);
    expect(signOutEnabled(OFF)).toBe(false);
  });

  it('is not tappable for an anonymous account even when resolved', () => {
    expect(signOutEnabled(READY_ANON)).toBe(false);
  });
});

describe('canSecure', () => {
  it('is offered to a live anonymous account on iOS', () => {
    expect(canSecure('live', READY_ANON, 'ios')).toBe(true);
  });

  it('is not offered on Android, where there is no provider to reach', () => {
    expect(canSecure('live', READY_ANON, 'android')).toBe(false);
  });

  it('is not offered to an account that is already secured', () => {
    expect(canSecure('live', READY_SECURED, 'ios')).toBe(false);
  });

  it('is not offered to the demo', () => {
    expect(canSecure('seeded', OFF, 'ios')).toBe(false);
  });
});
