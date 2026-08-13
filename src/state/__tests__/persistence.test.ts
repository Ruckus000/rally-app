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

/**
 * The bell is the one server-derived surface where an empty render is read as
 * an answer rather than as a wait — "Nothing needs you", to someone with cheers
 * waiting — so its rows survive the launch that would otherwise show that.
 */
describe('the notification feed', () => {
  const cheer = {
    id: 'cheer:t1:n9',
    tier: 'circle' as const,
    kind: 'cheer' as const,
    who: 'kai',
    name: 'Kai and Rae',
    text: 'cheered “Gym session”',
    time: '0h ago',
    sheetId: 't1',
  };

  it('survives a relaunch, so a cold start is not an empty bell', async () => {
    save({ ...base, account: 'live', notifications: [cheer] });
    await flush();

    const restored = await load();
    expect(restored?.notifications).toEqual([cheer]);
  });

  it('is discarded whole when a row would render a non-string as text', async () => {
    const bad = {
      ...pick(base),
      notifications: [{ ...cheer, text: { title: 'Gym session' } }],
    };
    await AsyncStorage.setItem(KEY, envelope(bad));
    expect(await load()).toBeNull();
  });

  it('is discarded when a row lands in a tier nothing renders', async () => {
    const bad = { ...pick(base), notifications: [{ ...cheer, tier: 'urgent' }] };
    await AsyncStorage.setItem(KEY, envelope(bad));
    expect(await load()).toBeNull();
  });

  it('is discarded when a name is unbounded, as a directory entry is', async () => {
    const bad = { ...pick(base), notifications: [{ ...cheer, name: 'a'.repeat(1000) }] };
    await AsyncStorage.setItem(KEY, envelope(bad));
    expect(await load()).toBeNull();
  });

  it('keeps a long task title, which the server does not bound', async () => {
    // The mirror of the test above, and the reason `text` has no length check:
    // discarding here would take the user's week with it, over someone else's
    // wordy task.
    const long = { ...pick(base), notifications: [{ ...cheer, text: `cheered “${'a'.repeat(2000)}”` }] };
    await AsyncStorage.setItem(KEY, envelope(long));
    expect(await load()).not.toBeNull();
  });

  it('restores a payload written before the feed was persisted', async () => {
    const old: Record<string, unknown> = { ...pick(base) };
    delete old.notifications;
    await AsyncStorage.setItem(KEY, envelope(old));
    expect(await load()).toMatchObject({ account: 'seeded' });
  });
});

describe('a hostile directory', () => {
  it('discards a person whose display name is unbounded', async () => {
    // A name reaches every screen and every accessibility label, so the bound
    // lives at the trust boundary rather than at each of the render sites.
    const bad = {
      ...pick(base),
      people: { x: { id: 'x', name: 'a'.repeat(500), first: 'a', initials: 'A' } },
    };
    await AsyncStorage.setItem(KEY, envelope(bad));
    expect(await load()).toBeNull();
  });

  it('discards a person missing the fields a render dereferences', async () => {
    const bad = { ...pick(base), people: { x: { id: 'x', name: 'X' } } };
    await AsyncStorage.setItem(KEY, envelope(bad));
    expect(await load()).toBeNull();
  });
});
