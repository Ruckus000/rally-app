/**
 * The mappers are where a client shape meets a schema, so these tests are about
 * the places the two disagree: `done` against `done_at`, `pts` against `points`,
 * and a week number against a Monday date.
 *
 * The `mondayOf` cases are the ones worth reading. `WeekContext.start` is typed
 * `Date` and is persisted, which means that on the second launch of the app it
 * is a string — so every shape it can actually arrive in gets a test, including
 * the one the type system says is impossible.
 */
import type { Task } from '../../data/fixtures';
import { buildWeekContext, FIXTURE_WEEK, type WeekContext } from '../../data/week';
import {
  batchCheers,
  memberStats,
  mondayOf,
  rowToPerson,
  rowToTask,
  taskRowToMoment,
  taskToRow,
} from '../mappers';

const AT = Date.parse('2026-08-13T09:30:00.000Z');

const aTask = (over: Partial<Task> = {}): Task => ({
  id: 'e6b1a0b4-0d4f-4f5f-9a2a-2f2f8b7c1d10',
  day: 3,
  title: 'Read 100 pages',
  cat: 'Mind',
  pts: 30,
  done: false,
  aud: 'private',
  pair: [],
  pairKind: null,
  cmts: [],
  source: 'staked',
  ...over,
});

describe('taskToRow', () => {
  it('carries every column the schema has, and nothing it does not', () => {
    const row = taskToRow(aTask({ done: true }), '2026-08-10', AT);

    expect(row).toEqual({
      id: 'e6b1a0b4-0d4f-4f5f-9a2a-2f2f8b7c1d10',
      week_start: '2026-08-10',
      day: 3,
      title: 'Read 100 pages',
      category: 'Mind',
      points: 30,
      aud: 'private',
      source: 'staked',
      done_at: '2026-08-13T09:30:00.000Z',
      updated_at: '2026-08-13T09:30:00.000Z',
    });
  });

  it('leaves owner_id out — the transport stamps it from the session', () => {
    expect(Object.keys(taskToRow(aTask(), '2026-08-10', AT))).not.toContain('owner_id');
  });

  it('leaves circle_id out, so an upsert cannot null out the server’s circle', () => {
    expect(Object.keys(taskToRow(aTask(), '2026-08-10', AT))).not.toContain('circle_id');
  });

  it('writes done_at only when the task is done', () => {
    expect(taskToRow(aTask({ done: false }), '2026-08-10', AT).done_at).toBeNull();
    expect(taskToRow(aTask({ done: true }), '2026-08-10', AT).done_at).toBe(
      '2026-08-13T09:30:00.000Z',
    );
  });

  it('maps pts to points', () => {
    expect(taskToRow(aTask({ pts: 45 }), '2026-08-10', AT).points).toBe(45);
  });
});

describe('rowToTask', () => {
  it('round-trips every field the schema carries', () => {
    for (const task of [
      aTask(),
      aTask({ done: true, aud: 'everyone', source: 'quicklog', cat: 'Quick log', pts: 20, day: 0 }),
      aTask({ aud: 'friends', cat: 'Fitness', day: 6, pts: 0, title: 'Walk' }),
    ]) {
      expect(rowToTask(taskToRow(task, '2026-08-10', AT))).toEqual(task);
    }
  });

  it('reads done off done_at rather than off a boolean column', () => {
    expect(rowToTask({ ...taskToRow(aTask(), '2026-08-10', AT), done_at: null }).done).toBe(false);
    expect(
      rowToTask({ ...taskToRow(aTask(), '2026-08-10', AT), done_at: '2026-08-11T00:00:00Z' }).done,
    ).toBe(true);
  });

  it('narrows a category, audience and day it has never seen', () => {
    const task = rowToTask({
      id: 'x',
      day: 41,
      title: 'from a newer client',
      category: 'Gardening',
      points: 10,
      aud: 'nobody',
      source: 'something-else',
      done_at: null,
    });

    // Nothing here may reach CATEGORY_POINTS[cat] or DAY_NAMES[day] as-is: an
    // unknown value has to become a known one, not a crash three screens later.
    expect(task.cat).toBe('Quick log');
    expect(task.aud).toBe('friends');
    expect(task.day).toBe(0);
    expect(task.source).toBe('staked');
  });

  it('fills the slices a task row cannot answer for', () => {
    const task = rowToTask(taskToRow(aTask(), '2026-08-10', AT));
    expect(task.pair).toEqual([]);
    expect(task.pairKind).toBeNull();
    expect(task.cmts).toEqual([]);
  });
});

describe('mondayOf', () => {
  it('takes the Monday of a context built this session', () => {
    // FIXTURE_WEEK is anchored on Thursday Aug 13 2026; its Monday is Aug 10.
    expect(mondayOf(FIXTURE_WEEK)).toBe('2026-08-10');
  });

  it('survives the reload: start comes back from JSON as a string', () => {
    const reloaded = JSON.parse(JSON.stringify(FIXTURE_WEEK)) as WeekContext;

    expect(typeof (reloaded as unknown as { start: unknown }).start).toBe('string');
    // The bug this guards: `start.getMonth()` is a TypeError on the second
    // launch of the app, and on the first launch of every test that builds a
    // context by hand it is not.
    expect(() => mondayOf(reloaded)).not.toThrow();
    expect(mondayOf(reloaded)).toBe('2026-08-10');
  });

  it('reads a bare YYYY-MM-DD as a local date, not as UTC midnight', () => {
    const week = { ...FIXTURE_WEEK, start: '2026-08-10' } as unknown as WeekContext;
    // `new Date('2026-08-10')` is UTC midnight, which is Aug 9 anywhere west of
    // Greenwich — the whole week would land under the previous Monday.
    expect(mondayOf(week)).toBe('2026-08-10');
  });

  it('normalises a start that is not a Monday', () => {
    const wonky = { ...FIXTURE_WEEK, start: new Date(2026, 7, 13) } as WeekContext;
    expect(mondayOf(wonky)).toBe('2026-08-10');
  });

  it('pads months and days to two digits', () => {
    expect(mondayOf(buildWeekContext(new Date(2026, 0, 7), 2))).toBe('2026-01-05');
  });

  it('falls back to this week rather than sending NaN', () => {
    const broken = { ...FIXTURE_WEEK, start: 'not a date' } as unknown as WeekContext;
    const now = new Date();
    now.setDate(now.getDate() - ((now.getDay() + 6) % 7));

    expect(mondayOf(broken)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mondayOf(broken)).toBe(mondayOf(buildWeekContext(now, 0)));
  });

  it('survives a context with no start at all', () => {
    expect(mondayOf({} as WeekContext)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('rowToPerson', () => {
  it('derives first name and initials, which profiles has no column for', () => {
    const person = rowToPerson({ id: 'u1', handle: 'maya', name: 'Maya Chen' });
    expect(person).toMatchObject({ id: 'u1', name: 'Maya Chen', first: 'Maya', initials: 'MC' });
  });

  it('falls back to the handle rather than rendering a blank avatar', () => {
    expect(rowToPerson({ id: 'u2', handle: 'anon_9f2', name: '  ' }).name).toBe('anon_9f2');
    expect(rowToPerson({ id: 'u3' }).name).toBe('Someone');
  });

  it('carries the avatar across, both halves together', () => {
    const person = rowToPerson({
      id: 'u4',
      handle: 'maya',
      name: 'Maya Chen',
      avatar_path: 'u4/photo.jpg',
      avatar_state: 'ready',
    });
    expect(person).toMatchObject({ avatarPath: 'u4/photo.jpg', avatarState: 'ready' });
  });

  it('leaves both off a row with no photo, so it compares equal to an older one', () => {
    const person = rowToPerson({ id: 'u5', handle: 'dre', name: 'Dre Okafor', avatar_state: 'none' });
    expect('avatarPath' in person).toBe(false);
    expect('avatarState' in person).toBe(false);
  });

  it('reads a state this build does not know as no photo at all', () => {
    // Forward compatibility that fails safe: an unrecognised word cannot be
    // asserted to mean "screened", and initials are the answer for anything
    // that is not certainly `ready`.
    const person = rowToPerson({ id: 'u6', name: 'Sofia Park', avatar_state: 'quarantined' });
    expect(person.avatarState).toBeUndefined();
  });

  it('drops an absurd path rather than persisting it', () => {
    // Another account writes this column. It lands in `people`, which is
    // written to disk, and a payload that fails validation on restore is
    // discarded whole — a staked week for a string somebody made long.
    const person = rowToPerson({
      id: 'u7',
      name: 'Nana Rosa',
      avatar_path: 'u7/'.padEnd(500, 'a'),
      avatar_state: 'ready',
    });
    expect(person.avatarPath).toBeUndefined();
  });
});

describe('someone else’s task, as the feed renders it', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    owner_id: '22222222-2222-4222-8222-222222222222',
    week_start: '2026-08-10',
    day: 2,
    title: 'Swim 2k',
    category: 'Fitness',
    points: 40,
    aud: 'friends',
    source: 'staked',
    done_at: null,
    created_at: '2026-08-12T09:00:00.000Z',
    ...over,
  });

  const NOW = Date.parse('2026-08-12T15:00:00.000Z');

  it('carries the real task id, which is what makes it cheerable', () => {
    // A fixture id like `f1` fails the uuid gate in `diffActed`, so a cheer on
    // it is silently dropped. This id is why the feed became interactive.
    expect(taskRowToMoment(row(), NOW).id).toBe('aaaaaaaa-0000-4000-8000-000000000001');
  });

  it('is always an ordinary card', () => {
    // Never 'big': that card's stat row is the constant BIG_CARD_STATS, so one
    // would print invented numbers over a real person's week.
    expect(taskRowToMoment(row(), NOW).kind).toBe('normal');
    expect(taskRowToMoment(row({ done_at: '2026-08-12T14:00:00.000Z' }), NOW).kind).toBe('normal');
  });

  it('reports age in the shape the feed sorts on', () => {
    expect(taskRowToMoment(row(), NOW).time).toBe('6h');
    expect(taskRowToMoment(row({ created_at: '2026-08-09T15:00:00.000Z' }), NOW).time).toBe('3d');
    // Closing it is the news; staking it is when there was none yet.
    expect(taskRowToMoment(row({ done_at: '2026-08-12T14:00:00.000Z' }), NOW).time).toBe('1h');
  });

  it('survives a row with no timestamps at all', () => {
    // `parseHours` returns 999 for an unreadable value, which sorts a moment to
    // the bottom rather than throwing on a screen.
    expect(taskRowToMoment(row({ created_at: null, done_at: null }), NOW).time).toBe('0h');
  });
});

describe('a member’s week, counted off the feed', () => {
  const task = (owner: string, done: boolean) => ({
    id: `id-${owner}-${done}`,
    owner_id: owner,
    done_at: done ? '2026-08-12T14:00:00.000Z' : null,
  });

  it('counts done against total, per person', () => {
    const stats = memberStats([task('a', true), task('a', false), task('b', false)]);

    expect(stats.get('a')).toEqual({ done: 1, total: 2, streak: 0, given: 0 });
    expect(stats.get('b')).toEqual({ done: 0, total: 1, streak: 0, given: 0 });
  });

  it('says nothing about someone with no rows', () => {
    // `ranking()` renders a missing week as "No week synced yet". A zeroed one
    // would read as a person who staked nothing, which is a different claim.
    expect(memberStats([]).get('a')).toBeUndefined();
  });
});

describe('several cheers on one task, as one row', () => {
  const cheer = (id: string, who: string, name: string, task = 'task-1') => ({
    id,
    tier: 'circle' as const,
    kind: 'cheer' as const,
    who: who as never,
    name,
    text: 'cheered “Morning walk”',
    time: '1h ago',
    sheetId: task,
  });

  it('leaves a single cheer exactly as it was', () => {
    const [only] = batchCheers([cheer('n1', 'dre', 'Dre Okafor')]);

    expect(only).toMatchObject({ id: 'n1', name: 'Dre Okafor' });
  });

  it('names two', () => {
    const [group] = batchCheers([cheer('n2', 'dre', 'Dre Okafor'), cheer('n1', 'maya', 'Maya Chen')]);

    // First names, which is the shape the design ships.
    expect(group.name).toBe('Dre and Maya');
    expect(group.faces).toEqual(['dre', 'maya']);
  });

  it('names three, the way the design draws it', () => {
    const [group] = batchCheers([
      cheer('n3', 'dre', 'Dre Okafor'),
      cheer('n2', 'maya', 'Maya Chen'),
      cheer('n1', 'nana', 'Nana Rosa'),
    ]);

    expect(group.name).toBe('Dre, Maya and Nana');
  });

  it('counts the rest past three', () => {
    const [group] = batchCheers([
      cheer('n4', 'dre', 'Dre Okafor'),
      cheer('n3', 'maya', 'Maya Chen'),
      cheer('n2', 'nana', 'Nana Rosa'),
      cheer('n1', 'sofia', 'Sofia Park'),
    ]);

    expect(group.name).toBe('Dre, Maya and 2 others');
    // The stack stays three deep however many cheered; the sentence carries it.
    expect(group.faces).toHaveLength(3);
  });

  it('keeps cheers on different tasks apart', () => {
    const feed = batchCheers([
      cheer('n2', 'dre', 'Dre Okafor', 'task-1'),
      cheer('n1', 'maya', 'Maya Chen', 'task-2'),
    ]);

    // Two people cheering two different things is two pieces of news.
    expect(feed).toHaveLength(2);
  });

  it('takes the newest member’s place in the feed', () => {
    const other = { ...cheer('x', 'nana', 'Nana Rosa'), kind: 'due' as const, sheetId: undefined };
    const feed = batchCheers([
      cheer('n2', 'dre', 'Dre Okafor'),
      other,
      cheer('n1', 'maya', 'Maya Chen'),
    ]);

    // The group sits where its newest cheer was, and everything else holds its
    // position — the feed is ordered by when things happened.
    expect(feed.map((n) => n.kind)).toEqual(['cheer', 'due']);
  });

  it('re-lights when a new cheer joins a group you have read', () => {
    const before = batchCheers([cheer('n1', 'dre', 'Dre Okafor'), cheer('n0', 'maya', 'Maya Chen')]);
    const after = batchCheers([
      cheer('n2', 'nana', 'Nana Rosa'),
      cheer('n1', 'dre', 'Dre Okafor'),
      cheer('n0', 'maya', 'Maya Chen'),
    ]);

    // Read state is keyed on the id, so a group keyed only by task would stay
    // read forever once opened, and a fourth cheer would arrive silently.
    expect(after[0].id).not.toBe(before[0].id);
  });
});
