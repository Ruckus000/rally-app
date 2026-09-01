/**
 * Who is offered what, stated as a table rather than discovered by rendering.
 *
 * The load-bearing rule: sign-out is offered only to an account that can be got
 * back. An anonymous account that signs out is gone — nothing else holds that
 * uuid — so rather than ship that behind a warning, the control is absent and
 * "Secure this account" stands in its place.
 */
import {
  canSecure,
  circlesVisible,
  deleteEnabled,
  deleteVisible,
  leaveCircleEnabled,
  secureUnavailable,
  signOutEnabled,
  signOutVisible,
} from '../guards';
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

/**
 * The inverse of the rule above, and the reason it is written out here rather
 * than shared with it.
 *
 * Sign-out is withheld from an anonymous account because it cannot come back.
 * That is exactly why deletion is *offered* to one: an account nobody can sign
 * back into is an account whose only way to stop existing is this row. Reusing
 * `signOutVisible` would have hidden it from every Android install, which is
 * every Android account, which is the population with the least control over
 * their data to begin with.
 */
describe('deleteVisible', () => {
  it('is offered to a secured live account', () => {
    expect(deleteVisible('live')).toBe(true);
  });

  it('is offered to an anonymous one too, unlike sign-out', () => {
    // The pair, asserted together, because the whole rule is the difference.
    expect(signOutVisible('live', READY_ANON)).toBe(false);
    expect(deleteVisible('live')).toBe(true);
  });

  it('is withheld from the demo modes, which have no account to delete', () => {
    expect(deleteVisible('seeded')).toBe(false);
    expect(deleteVisible('fresh')).toBe(false);
    expect(deleteVisible(null)).toBe(false);
  });
});

describe('deleteEnabled', () => {
  it('is tappable once the session resolves, secured or not', () => {
    expect(deleteEnabled(READY_SECURED)).toBe(true);
    expect(deleteEnabled(READY_ANON)).toBe(true);
  });

  it('is not tappable without a session for the RPC to act as', () => {
    expect(deleteEnabled(OFFLINE)).toBe(false);
    expect(deleteEnabled(EXPIRED)).toBe(false);
    expect(deleteEnabled(OFF)).toBe(false);
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

/**
 * The circles section, and the cold-start window that decides its shape.
 */
describe('circlesVisible', () => {
  it('is for live accounts with a circle to leave', () => {
    expect(circlesVisible('live', 1)).toBe(true);
    expect(circlesVisible('live', 3)).toBe(true);
  });

  it('hides rather than empty-states when there are none', () => {
    // `state.circles` is server-derived and deliberately not persisted, so on
    // every cold start it is empty for everybody until the first pull. An
    // empty-state line here would tell somebody in three circles that they are
    // in none, once per launch. `Blocked` has no such window, which is why it
    // renders its own empty line and this does not.
    expect(circlesVisible('live', 0)).toBe(false);
  });

  it('is not for the demo worlds', () => {
    expect(circlesVisible('seeded', 2)).toBe(false);
    expect(circlesVisible('fresh', 2)).toBe(false);
    expect(circlesVisible(null, 2)).toBe(false);
  });
});

describe('leaveCircleEnabled', () => {
  it('needs a resolved session, because the delete is immediate', () => {
    expect(leaveCircleEnabled({ status: 'ready', userId: 'u', anonymous: false })).toBe(true);
    expect(leaveCircleEnabled({ status: 'off' })).toBe(false);
    expect(leaveCircleEnabled({ status: 'offline' })).toBe(false);
  });

  it('lets an anonymous account leave', () => {
    // Unlike signing out, which is withheld from an account nobody can sign
    // back into. Walking out of a room loses nothing that cannot be rejoined
    // with the code.
    expect(leaveCircleEnabled({ status: 'ready', userId: 'u', anonymous: true })).toBe(true);
  });
});
