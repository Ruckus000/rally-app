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
import { mondayOf, rowToPerson, rowToTask, taskToRow } from '../mappers';

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
});
