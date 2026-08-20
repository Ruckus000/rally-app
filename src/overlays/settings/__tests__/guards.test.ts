/**
 * Who is offered what, stated as a table rather than discovered by rendering.
 *
 * The load-bearing rule: sign-out is offered only to an account that can be got
 * back. An anonymous account that signs out is gone — nothing else holds that
 * uuid — so rather than ship that behind a warning, the control is absent and
 * "Secure this account" stands in its place.
 */
import { canSecure, secureUnavailable, signOutEnabled, signOutVisible } from '../guards';
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

/**
 * The row that used to just not be there.
 *
 * `canSecure` needs the `anonymous` claim and only a resolved session carries
 * one, so on an offline phone the whole "Getting back in" section vanished with
 * no explanation — the same silent absence `signOutVisible` refuses to create.
 * This is what puts it back, greyed.
 */
describe('secureUnavailable', () => {
  it('holds the row on screen for every session that has not resolved', () => {
    expect(secureUnavailable('live', { status: 'signing-in' }, 'ios')).toBe(true);
    expect(secureUnavailable('live', OFFLINE, 'ios')).toBe(true);
    expect(secureUnavailable('live', EXPIRED, 'ios')).toBe(true);
    expect(secureUnavailable('live', { status: 'error', message: 'x' }, 'ios')).toBe(true);
  });

  it('is false once the session resolves, whichever way it resolves', () => {
    // Resolved means `canSecure` has a real answer, and that answer owns the row.
    expect(secureUnavailable('live', READY_ANON, 'ios')).toBe(false);
    expect(secureUnavailable('live', READY_SECURED, 'ios')).toBe(false);
  });

  it('is false for `off`, which is a missing server rather than a missing answer', () => {
    // "Securing needs a connection" would be a lie about a connection that is
    // never coming. `accountLine` says what is actually going on instead.
    expect(secureUnavailable('live', OFF, 'ios')).toBe(false);
  });

  it('is false on Android and for the demo, where the row could never appear', () => {
    expect(secureUnavailable('live', OFFLINE, 'android')).toBe(false);
    expect(secureUnavailable('seeded', OFFLINE, 'ios')).toBe(false);
    expect(secureUnavailable(null, OFFLINE, 'ios')).toBe(false);
  });

  it('never overlaps with canSecure, so the row has exactly one owner', () => {
    const sessions: SessionState[] = [
      READY_SECURED,
      READY_ANON,
      OFFLINE,
      EXPIRED,
      OFF,
      { status: 'signing-in' },
      { status: 'error', message: 'x' },
    ];
    for (const s of sessions) {
      expect(canSecure('live', s, 'ios') && secureUnavailable('live', s, 'ios')).toBe(false);
    }
  });
});
