/**
 * The client shape ↔ the row shape, in one place.
 *
 * Every difference between `Task` and a `tasks` row is a decision, and each one
 * is made here rather than at the call sites: `done` is a boolean the UI toggles
 * but a timestamp the server records, `pts` is `points`, and the week is a
 * Monday date rather than a week number — 33 is ambiguous across years.
 *
 * A row is treated as untrusted input. It arrives from a server that another
 * device wrote to and that will outlive this build of the app, so every field is
 * narrowed back into its union rather than cast into one: a category the client
 * has never heard of must not reach `CATEGORY_POINTS[task.cat]`.
 */
import type { Audience, Category, Task } from '../data/fixtures';
import { personOf, type Person, type PersonId } from '../data/people';
import { dayIndexOf, type DayIndex, type WeekContext } from '../data/week';

const CATEGORIES: readonly Category[] = ['Fitness', 'Work', 'Home', 'Mind', 'Quick log'];
const AUDIENCES: readonly Audience[] = ['friends', 'everyone', 'private'];

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local calendar date, not UTC: `toISOString()` on a local midnight is the day before in Europe. */
const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * `WeekContext.start` is typed `Date`, and after a reload it is a string.
 *
 * It is persisted, so it goes through `JSON.stringify`/`parse`, which turns a
 * Date into its ISO string and never turns it back. `weekIsSound()` does not
 * check it and nothing has called a Date method on it until now, so the type has
 * been quietly lying since persistence shipped. Anything here that touched
 * `.getMonth()` directly would work in every test that builds a fresh context
 * and crash on the second launch of the real app.
 */
const asDate = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== 'string') return null;

  // A bare 'YYYY-MM-DD' parses as UTC midnight, which reads back as the previous
  // day west of Greenwich. Build it from the components instead, in local time,
  // which is the frame every other week calculation in the app uses.
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (bare) return new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]));

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The Monday of the week, as `week_start` wants it.
 *
 * Normalised rather than trusted: a context built by hand — or one whose `start`
 * came back as a string — must still produce the Monday the server indexes on,
 * or the same week lands under two keys.
 *
 * An unparseable start falls back to this week's Monday. A task has to go
 * somewhere, and dropping the write or sending `NaN-NaN-NaN` (a permanent 22007
 * the outbox would retire the entry over) both lose the user's tap; the current
 * week is the least-wrong home for it and is visible in the UI immediately.
 */
export function mondayOf(week: WeekContext): string {
  const start = asDate((week as { start?: unknown } | null | undefined)?.start) ?? new Date();
  const monday = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  monday.setDate(monday.getDate() - dayIndexOf(monday));
  return ymd(monday);
}

/**
 * `at` is the device clock for this mutation, and becomes `updated_at` — the
 * field last-write-wins compares. The server clamps it to at most now()+5min, so
 * a device with a wrong clock can be a little ahead but cannot win forever.
 *
 * Two omissions are deliberate. `owner_id` is stamped by the transport from the
 * session, never carried in a payload. `circle_id` is left out entirely so that
 * an upsert of an existing row does not null out a circle the server assigned.
 */
export function taskToRow(task: Task, weekStart: string, at: number): Record<string, unknown> {
  const stamp = new Date(at).toISOString();
  return {
    id: task.id,
    week_start: weekStart,
    day: task.day,
    title: task.title,
    category: task.cat,
    points: task.pts,
    aud: task.aud,
    source: task.source,
    // The timestamp *is* the boolean: `done_at` non-null means done, and keeping
    // the completion moment costs nothing the client has to maintain.
    done_at: task.done ? stamp : null,
    updated_at: stamp,
  };
}

export function rowToTask(row: Record<string, unknown>): Task {
  const day = Number(row.day);
  const points = Number(row.points);
  const category = str(row.category) as Category;
  const aud = str(row.aud) as Audience;

  return {
    id: str(row.id),
    day: (Number.isInteger(day) && day >= 0 && day <= 6 ? day : 0) as DayIndex,
    title: str(row.title),
    cat: CATEGORIES.includes(category) ? category : 'Quick log',
    pts: Number.isFinite(points) ? points : 0,
    done: row.done_at !== null && row.done_at !== undefined,
    aud: AUDIENCES.includes(aud) ? aud : 'friends',
    // The pair and comment tables are their own pulls; a task row cannot answer
    // for them, and inventing empties here is what keeps the render total.
    pair: [],
    pairKind: null,
    cmts: [],
    source: row.source === 'quicklog' ? 'quicklog' : 'staked',
  };
}

/**
 * A `profiles` row is only ever an id and a name, so everything the UI needs
 * beyond that — first name, initials, tint — is derived by `personOf`. The
 * handle stands in for a blank name rather than rendering an empty avatar.
 */
export function rowToPerson(row: Record<string, unknown>): Person {
  const id = str(row.id) as PersonId;
  const name = str(row.name).trim();
  const handle = str(row.handle).trim();
  return personOf(id, name || handle || 'Someone');
}
