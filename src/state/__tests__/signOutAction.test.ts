/**
 * What signing out leaves behind, which is nothing — and specifically it leaves
 * `onboardStep` at 'onboarding'.
 *
 * That last one is the whole feature. `OnboardOverlay` already contains a
 * working Apple recovery flow; it has simply been unreachable once onboarding
 * finished. Landing on 'onboarding' is what makes signing back in possible
 * without deleting the app, so it is asserted here rather than left as a
 * property of `initialState` that someone could change without noticing.
 *
 * The wipe is not incidental either. Recovery deliberately refuses to restore
 * history onto a device that already has some, so leaving local weeks behind
 * would mean signing back in restores nothing.
 */
import { reducer } from '../store';
import { baseState } from '../../test/baseState';
import { SELF_DEMO_ID } from '../../data/people';

const signedIn = {
  ...baseState,
  account: 'live' as const,
  selfId: '11111111-1111-4111-8111-111111111111',
  settingsOpen: true,
};

describe('signing out', () => {
  it('lands on onboarding, which is where the Apple button lives', () => {
    expect(reducer(signedIn, { type: 'SIGN_OUT' }).onboardStep).toBe('onboarding');
  });

  it('forgets the account, which is what stops sync', () => {
    const next = reducer(signedIn, { type: 'SIGN_OUT' });
    expect(next.account).toBeNull();
    expect(next.selfId).toBe(SELF_DEMO_ID);
  });

  it('clears the week, so recovery is allowed to restore one', () => {
    const next = reducer(signedIn, { type: 'SIGN_OUT' });
    expect(next.myTasks).toEqual([]);
    expect(next.history).toEqual([]);
    expect(next.moments).toEqual([]);
  });

  it('closes itself on the way out', () => {
    expect(reducer(signedIn, { type: 'SIGN_OUT' }).settingsOpen).toBe(false);
  });

  it('takes its week from the calendar, not from the stale module literal', () => {
    const next = reducer(signedIn, { type: 'SIGN_OUT' });
    expect(next.day).toBe(next.week.today);
  });
});
