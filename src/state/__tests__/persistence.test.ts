/**
 * What comes back off disk is untrusted input: it can be truncated, or written
 * by an older build. These tests pin the two things that matter — that we only
 * write what should survive, and that anything suspect is discarded whole
 * rather than half-restored into a crash.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { __resetForTests, flush, load, pick, save } from '../persistence';
import { reducer, State } from '../store';
import { MY_TASKS } from '../../data/fixtures';
import { baseState as base } from '../../test/baseState';
import { weekAfter } from '../../data/week';

const KEY = 'rally:state:v1';


const envelope = (data: unknown, over: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 2, data, ...over });

/**
 * The async-storage jest mock already makes these jest.fn()s, and `jest.spyOn`
 * on an existing mock hands back the same one — call history and all. So read
 * it directly and clear it explicitly rather than trusting a fresh spy.
 */
const setItem = AsyncStorage.setItem as jest.Mock;

beforeEach(async () => {
  __resetForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('what gets written', () => {
  it('keeps the durable slices', () => {
    const p = pick({ ...base, tab: 'me', scope: 'personal' });
    expect(p.tab).toBe('me');
    expect(p.scope).toBe('personal');
    expect(p.account).toBe('seeded');
    expect(p.myTasks).toHaveLength(MY_TASKS.length);
  });

  it('drops overlay and draft state, which must never be restored', () => {
    const busy: State = {
      ...base,
      planOpen: true,
      notifOpen: true,
      wrapOpen: true,
      sheet: { type: 'person', id: 'maya' },
      composerOpen: true,
      draft: 'half typed',
      note: 'half written',
      editingId: 'm2',
      toast: 'Cheer taken back',
    };
    expect(Object.keys(pick(busy))).not.toEqual(
      expect.arrayContaining([
        'planOpen', 'notifOpen', 'wrapOpen', 'sheet',
        'composerOpen', 'draft', 'note', 'editingId', 'toast',
      ]),
    );
  });

  it('round-trips through storage', async () => {
    save({ ...base, tab: 'circle' });
    await flush();
    expect(await load()).toMatchObject({ tab: 'circle', account: 'seeded' });
  });
});

describe('what gets discarded', () => {
  it('a payload from an older version', async () => {
    await AsyncStorage.setItem(KEY, envelope(pick(base), { version: 0 }));
    expect(await load()).toBeNull();
  });

  it('a task with a malformed history entry', async () => {
    const bad = { ...pick(base), history: [{ n: 'last week', label: 'Week 32' }] };
    await AsyncStorage.setItem(KEY, envelope(bad));
    expect(await load()).toBeNull();
  });

  it('a week object that would break a day lookup', async () => {
    const bad = { ...pick(base), week: { ...base.week, today: 11 } };
    await AsyncStorage.setItem(KEY, envelope(bad));
    expect(await load()).toBeNull();
  });

  it('malformed JSON rather than throwing on boot', async () => {
    await AsyncStorage.setItem(KEY, '{"version":1,"data":{"myTa');
    await expect(load()).resolves.toBeNull();
  });

  it('a task with a day outside the week — it would crash DAY_NAMES lookup', async () => {
    const bad = { ...pick(base), myTasks: [{ ...MY_TASKS[0], day: 9 }] };
    await AsyncStorage.setItem(KEY, envelope(bad));
    expect(await load()).toBeNull();
  });

  it('a task with an unknown category', async () => {
    const bad = { ...pick(base), myTasks: [{ ...MY_TASKS[0], cat: 'Vibes' }] };
    await AsyncStorage.setItem(KEY, envelope(bad));
    expect(await load()).toBeNull();
  });

  it('an unrecognised account mode', async () => {
    const bad = { ...pick(base), account: 'premium' };
    await AsyncStorage.setItem(KEY, envelope(bad));
    expect(await load()).toBeNull();
  });

  it('nothing stored at all', async () => {
    expect(await load()).toBeNull();
  });
});

describe('payloads the directory has to keep working with', () => {
  it('one written before people existed, which hydrate backfills', async () => {
    const old: Record<string, unknown> = { ...pick(base) };
    delete old.people;
    delete old.selfId;
    await AsyncStorage.setItem(KEY, envelope(old));

    const restored = await load();
    expect(restored).not.toBeNull();
    expect(restored?.myTasks).toHaveLength(base.myTasks.length);
  });

  it('a live account, rather than discarding it on every launch', async () => {
    await AsyncStorage.setItem(KEY, envelope({ ...pick(base), account: 'live' }));
    expect(await load()).toMatchObject({ account: 'live' });
  });
});

// This behaviour is deliberately inverted from what it used to be. Discarding
// on a week change was right only while the week could never move; now that it
// can, discarding would throw away the week's work instead of rolling it over.
describe('a stale week is kept, not discarded', () => {
  it('loads a payload written in an earlier week', async () => {
    const lastWeek = { ...pick(base), week: { ...base.week, number: base.week.number - 1 } };
    await AsyncStorage.setItem(KEY, envelope(lastWeek));

    const restored = await load();
    expect(restored).not.toBeNull();
    expect(restored?.week.number).toBe(base.week.number - 1);
    expect(restored?.myTasks).toHaveLength(base.myTasks.length);
  });

  it('and the store turns that into a prompt rather than a rewrite', () => {
    const stale = { ...base, week: { ...base.week, number: base.week.number - 1 } };
    const s = reducer(stale, { type: 'ROLLOVER_DETECTED', to: base.week });
    expect(s.pendingRollover?.to.number).toBe(base.week.number);
    // Nothing has moved yet.
    expect(s.myTasks).toEqual(stale.myTasks);
    expect(s.history).toEqual(stale.history);
  });
});

describe('an unanswered rollover prompt', () => {
  it('survives a restart rather than being lost', async () => {
    const prompted = reducer(base, { type: 'ROLLOVER_DETECTED', to: weekAfter(base.week) });
    save(prompted);
    await flush();

    const restored = await load();
    expect(restored?.pendingRollover?.to.number).toBe(weekAfter(base.week).number);
  });

  it('is discarded if it came back malformed', async () => {
    const bad = { ...pick(base), pendingRollover: { to: { number: 34 } } };
    await AsyncStorage.setItem(KEY, envelope(bad));
    expect(await load()).toBeNull();
  });
});

describe('failure handling', () => {
  it('does not throw when the disk rejects the write', async () => {
    setItem.mockRejectedValueOnce(new Error('disk full'));
    save({ ...base, tab: 'me' });
    await expect(flush()).resolves.toBeUndefined();
  });

  it('retries on the next change rather than believing the failed write', async () => {
    setItem.mockRejectedValueOnce(new Error('disk full'));
    save({ ...base, tab: 'me' });
    await flush();

    setItem.mockClear();
    save({ ...base, tab: 'me' });
    await flush();
    expect(setItem).toHaveBeenCalled();
  });
});

describe('write economy', () => {
  it('skips the write when no durable field changed', async () => {
    save(base);
    await flush();

    setItem.mockClear();
    // Typing in the composer changes `draft`, which is not persisted.
    save(reducer(base, { type: 'SET_DRAFT', value: 'a' }));
    await flush();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('writes when a durable field does change', async () => {
    save(base);
    await flush();

    setItem.mockClear();
    save(reducer(base, { type: 'TOGGLE_TASK', id: 'm2' }));
    await flush();
    expect(setItem).toHaveBeenCalled();
  });
});
