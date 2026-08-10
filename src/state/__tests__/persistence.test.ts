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
import { CURRENT_WEEK } from '../../data/week';
import { baseState as base } from '../../test/baseState';

const KEY = 'rally:state:v1';


const envelope = (data: unknown, over: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 1, week: CURRENT_WEEK.number, data, ...over });

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

  it('a payload from a different week', async () => {
    await AsyncStorage.setItem(KEY, envelope(pick(base), { week: CURRENT_WEEK.number - 1 }));
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
