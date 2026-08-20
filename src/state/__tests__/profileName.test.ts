/**
 * The name you type in onboarding, and the three ways it used to be lost.
 *
 * All three ended at the same string — the app calling you "Someone" — but only
 * one of them involved the network, which is why they are tested apart:
 *
 *   1. the reducer stored the literal 'You' and discarded what you typed;
 *   2. a session resolving *after* onboarding stranded the entry under the
 *      demo sentinel, so the lookup for your real id missed;
 *   3. nothing pushed `profiles.name`, so the next pull merged the signup
 *      trigger's default back over it.
 *
 * The third is guarded by `dirtyProfile()`, and a guard that cannot be observed
 * failing is not a guard — so the merge cases below come in pairs: one with the
 * write still queued, one with an empty queue that must merge.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reducer, State } from '../store';
import { indexPeople, NAME_MAX, personOf, SELF_DEMO_ID } from '../../data/people';
import { __resetOutboxForTests, enqueue } from '../../sync/outbox';
import { PROFILE_KEY } from '../../sync/engine';
import { flush, load, save, __resetForTests as __resetPersistenceForTests } from '../persistence';
import { freshState } from '../../test/baseState';

const onboard = (state: State, name: string) =>
  reducer(state, { type: 'FINISH_ONBOARD', name, stakes: [], aud: 'friends' });

const live = (): State => reducer(freshState, { type: 'SET_ACCOUNT', mode: 'live' });
const SESSION_ID = '7c1f4a2e-0000-4000-8000-000000000001';
const ready = (state: State, userId = SESSION_ID) =>
  reducer(state, { type: 'SESSION', session: { status: 'ready', userId, anonymous: true } });

beforeEach(() => __resetOutboxForTests());

describe('the name survives onboarding', () => {
  it('keeps what you typed on a live account, because your circle reads it', () => {
    const s = onboard(ready(live()), 'Maya Chen');

    // Not 'You': this exact string is pushed to `profiles.name`, which is what
    // everyone else sees beside your week.
    expect(s.people[s.selfId]?.name).toBe('Maya Chen');
    expect(s.people[s.selfId]?.initials).toBe('MC');
  });

  it('still says "You" on a demo account, which is the fixture convention', () => {
    const s = onboard(reducer(freshState, { type: 'SET_ACCOUNT', mode: 'fresh' }), 'Maya Chen');

    expect(s.people[s.selfId]?.name).toBe('You');
    expect(s.people[s.selfId]?.initials).toBe('MC');
  });
});

describe('the session arriving late', () => {
  /**
   * The order that used to break, and the one a cold start on a slow network
   * actually produces: onboarding finishes before the anonymous sign-in does.
   */
  it('carries the name onto the real id when the session lands after onboarding', () => {
    const named = onboard(live(), 'Maya Chen');
    // Filed under the sentinel, because that is all `selfId` can be yet.
    expect(named.people[SELF_DEMO_ID]?.name).toBe('Maya Chen');

    const s = ready(named);

    expect(s.selfId).toBe(SESSION_ID);
    expect(s.people[SESSION_ID]?.name).toBe('Maya Chen');
    // Left behind, the stale entry would be a second you in every member list.
    expect(s.people[SELF_DEMO_ID]).toBeUndefined();
  });

  it('works in the other order too, when the session is already there', () => {
    const s = onboard(ready(live()), 'Maya Chen');

    expect(s.people[SESSION_ID]?.name).toBe('Maya Chen');
  });

  it('never carries a name between two real accounts', () => {
    const first = onboard(ready(live()), 'Maya Chen');
    const second = ready(first, '7c1f4a2e-0000-4000-8000-000000000002');

    // Signing in as someone else must not hand them Maya's name.
    expect(second.people[second.selfId]).toBeUndefined();
  });
});

describe('renaming yourself later', () => {
  it('keeps everything about you that a name does not decide', () => {
    const named = onboard(ready(live()), 'Maya Chen');
    const withExtras = {
      ...named,
      people: indexPeople([
        { ...named.people[SESSION_ID]!, tintIndex: 1, trend: 'up' as const },
      ]),
    };

    const s = reducer(withExtras, { type: 'RENAME_SELF', name: 'Maya C.' });

    expect(s.people[SESSION_ID]).toMatchObject({
      name: 'Maya C.',
      first: 'Maya',
      initials: 'MC',
      // Rebuilding the record from the name alone would drop these silently.
      tintIndex: 1,
      trend: 'up',
    });
  });

  it('ignores an empty name rather than blanking a profile the server holds', () => {
    const named = onboard(ready(live()), 'Maya Chen');

    // `profiles_name_length` refuses '' anyway; returning state unchanged means
    // nothing is queued to be refused.
    expect(reducer(named, { type: 'RENAME_SELF', name: '   ' })).toBe(named);
  });

  it('bounds a long one, so the push cannot be dead-lettered', () => {
    const named = onboard(ready(live()), 'Maya Chen');

    const s = reducer(named, { type: 'RENAME_SELF', name: 'A'.repeat(200) });

    expect(s.people[SESSION_ID]?.name).toHaveLength(NAME_MAX);
  });
});

describe('a name long enough to wipe the device', () => {
  /**
   * Before names were user-chosen this could not happen: every one of them was
   * the trigger's 'Someone'. Now that a circle member picks their own, an
   * unbounded one is a live denial of service — `peopleAreSound` rejects the
   * payload holding it, and rejection discards *everything*, so the victim
   * relaunches to an empty week with no error and nothing to blame.
   */
  it('never gets far enough to be persisted', async () => {
    __resetPersistenceForTests();
    await AsyncStorage.clear();

    const attacker = personOf('7c1f4a2e-0000-4000-8000-00000000000a', 'A'.repeat(200));
    save({ ...freshState, people: indexPeople([attacker]) });
    await flush();

    // The load is the assertion: null here means the whole payload was thrown
    // away, which is exactly the outcome the bound exists to prevent.
    expect(await load()).not.toBeNull();
    expect(attacker.name).toHaveLength(NAME_MAX);
  });

  it('leaves an ordinary name completely alone', async () => {
    // The control: a bound that clamped everything would pass the test above
    // while quietly truncating every real name in the app.
    expect(personOf('7c1f4a2e-0000-4000-8000-00000000000b', 'Maya Chen').name).toBe('Maya Chen');
  });
});

describe('a pull that races the push', () => {
  const server = personOf(SESSION_ID, 'Someone');

  it('does not let the trigger default overwrite a name still in the queue', () => {
    const named = onboard(ready(live()), 'Maya Chen');
    enqueue('profile.update', PROFILE_KEY, { name: 'Maya Chen' });

    const s = reducer(named, { type: 'SERVER_MERGE', merge: { people: [server] } });

    expect(s.people[SESSION_ID]?.name).toBe('Maya Chen');
  });

  it('DOES merge it once the queue is empty — the control', () => {
    // Without this, the assertion above would pass just as happily if
    // `SERVER_MERGE` had stopped merging people altogether.
    const named = onboard(ready(live()), 'Maya Chen');

    const s = reducer(named, { type: 'SERVER_MERGE', merge: { people: [server] } });

    expect(s.people[SESSION_ID]?.name).toBe('Someone');
  });

  it('still merges everyone else while your own name is queued', () => {
    const named = onboard(ready(live()), 'Maya Chen');
    enqueue('profile.update', PROFILE_KEY, { name: 'Maya Chen' });
    const dre = personOf('7c1f4a2e-0000-4000-8000-0000000000de', 'Dre Okafor');

    const s = reducer(named, { type: 'SERVER_MERGE', merge: { people: [server, dre] } });

    expect(s.people[SESSION_ID]?.name).toBe('Maya Chen');
    expect(s.people[dre.id]?.name).toBe('Dre Okafor');
  });
});
