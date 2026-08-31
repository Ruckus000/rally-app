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

/**
 * State written against one Supabase project describes a world that does not
 * exist in another — its tasks, its circle, its bots, its ids. The payload is
 * byte-identical in shape either way, so nothing else in `load()` can tell, and
 * switching backends used to show the previous one's world until the app was
 * uninstalled.
 *
 * The three ways this answers "not foreign" are the interesting half. Each one
 * is a case where discarding would be worse than the bug it prevents.
 */
describe('state written against another backend', () => {
  const live = { ...pick(base), account: 'live' as const };
  const demo = pick(base); // 'seeded'

  const withProject = (ref: string) => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  };

  afterEach(() => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  });

  it('is discarded when the project differs', async () => {
    withProject('bbbb');
    await AsyncStorage.setItem(KEY, envelope(live, { backend: 'aaaa' }));
    expect(await load()).toBeNull();
  });

  it('is kept when the project matches', async () => {
    withProject('aaaa');
    await AsyncStorage.setItem(KEY, envelope(live, { backend: 'aaaa' }));
    expect(await load()).not.toBeNull();
  });

  it('is kept for a demo account, which is not backend-derived at all', async () => {
    // Demo and seeded modes make zero network calls. Letting a URL change eat a
    // demo week would be a bug introduced entirely by a guard for live sync.
    withProject('bbbb');
    await AsyncStorage.setItem(KEY, envelope(demo, { backend: 'aaaa' }));
    expect(await load()).not.toBeNull();
  });

  it('is kept when it carries no stamp, so an upgrade costs nobody their week', async () => {
    // Every payload already on disk predates this field, and was written
    // against the backend still in use. Discarding those would throw away the
    // staked week, the history and the streak of every existing install.
    withProject('aaaa');
    await AsyncStorage.setItem(KEY, envelope(live));
    expect(await load()).not.toBeNull();
  });

  it('is kept when the build has no project configured', async () => {
    // A demo build, and every suite in this repo that does not set the env.
    // "Cannot tell" must never mean "does not match".
    await AsyncStorage.setItem(KEY, envelope(live, { backend: 'aaaa' }));
    expect(await load()).not.toBeNull();
  });

  it('stamps what it writes, so the next launch can make the comparison', async () => {
    withProject('aaaa');
    save({ ...base, account: 'live' });
    await flush();
    const written = JSON.parse(setItem.mock.calls.at(-1)![1] as string);
    expect(written.backend).toBe('aaaa');
    expect(written.version).toBe(2);
  });
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

describe('which circle the app was left on', () => {
  it('survives a relaunch, while the circles themselves do not', async () => {
    // The asymmetry is the design. `circles` is server-derived and refetched on
    // launch, so persisting it would buy a soundness validator and a staleness
    // question for one pull's worth of latency. `activeCircleId` is a choice,
    // and it is the one thing here the server cannot re-derive — unpersisted,
    // the app opens on a different circle from the one it was left on, every
    // single launch.
    save({
      ...base,
      activeCircleId: 'c-gym',
      circles: [{ id: 'c-gym', name: 'Gym', inviteCode: 'gym-0123456789abcdef' }],
    });
    await flush();

    const restored = await load();
    expect(restored?.activeCircleId).toBe('c-gym');

    // Asserted against what actually reached the disk, not against the restored
    // object: `Persisted` has no `circles` at all, so a check on the way out
    // would be the type system agreeing with itself. `PERSISTED_KEYS` is the
    // thing under test, and this is where it can be caught adding a key.
    const raw = JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}');
    expect('circles' in raw.data).toBe(false);
    expect(raw.data.activeCircleId).toBe('c-gym');
  });

  it('is discarded, payload and all, if it comes back as something absurd', async () => {
    const bad = { ...pick(base), activeCircleId: 'x'.repeat(200) };
    await AsyncStorage.setItem(KEY, envelope(bad));

    expect(await load()).toBeNull();
  });
});

describe('the circle a goal was staked in', () => {
  it('survives a restart, on the task and on the moment', async () => {
    const CIRCLE = '33333333-3333-4333-8333-333333333333';
    const staked = {
      ...base,
      myTasks: [{ ...base.myTasks[0], circleId: CIRCLE }],
      moments: [{ ...base.moments[0], circleId: CIRCLE }],
    };
    save(staked);
    await flush();

    const restored = await load();
    expect(restored?.myTasks[0].circleId).toBe(CIRCLE);
    expect(restored?.moments[0].circleId).toBe(CIRCLE);
  });

  it('is not required, so a payload written before it existed still loads', async () => {
    // No `VERSION` bump for this field, which is only defensible if an older
    // payload is *loadable* rather than merely un-crashing. Asserted, because
    // the alternative — discarding — costs the staked week, the history and
    // the year grid.
    const older = pick(base);
    await AsyncStorage.setItem(KEY, envelope(older));

    const restored = await load();
    expect(restored).not.toBeNull();
    expect('circleId' in restored!.myTasks[0]).toBe(false);
  });

  it('discards the whole payload when it comes back malformed', async () => {
    // Not a nicety: `isSound` is all-or-nothing. This is the behaviour the
    // mappers exist to keep unreachable — they omit a key they could not read
    // rather than carrying something this check would reject, because failing
    // here does not lose the attribution, it loses the week with it.
    const bad = {
      ...pick(base),
      myTasks: [{ ...base.myTasks[0], circleId: 'x'.repeat(200) }],
    };
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

describe('the Global feed', () => {
  const post = {
    id: '77777777-7777-4777-8777-777777777777',
    who: '00000000-0000-4000-8000-0000000000b0',
    kind: 'normal' as const,
    time: '2h',
    day: 1 as const,
    title: 'Walked the whole way',
    pts: 20,
    cheers: 3,
  };

  it('survives a relaunch, because it is the tab you land on', async () => {
    save({ ...base, account: 'live', globalPosts: [post] });
    await flush();

    expect((await load())?.globalPosts).toEqual([post]);
  });

  it('is checked like the feed it is — same shape, same rules', async () => {
    // `momentsAreSound` is reused rather than restated. A `day` outside the
    // week crashes the same `DAY_NAMES` lookup wherever the row is rendered.
    const bad = { ...pick(base), globalPosts: [{ ...post, day: 9 }] };
    await AsyncStorage.setItem(KEY, envelope(bad));
    expect(await load()).toBeNull();
  });

  it('restores a payload written before it was persisted', async () => {
    const old: Record<string, unknown> = { ...pick(base) };
    delete old.globalPosts;
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
