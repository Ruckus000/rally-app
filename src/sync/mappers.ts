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
import type {
  Audience,
  Category,
  HistoryWeek,
  Moment,
  Notification,
  NotifTier,
  Task,
  TaskMedia,
} from '../data/fixtures';
import type { PulledMedia } from './transport';
import { NOTIF_TIERS, weekSummary } from '../data/fixtures';
import {
  avatarPathOf,
  avatarStateOf,
  personOf,
  type MemberStats,
  type Person,
  type PersonId,
} from '../data/people';
import {
  buildWeekContext,
  dayIndexOf,
  isoWeekNumber,
  type DayIndex,
  type WeekContext,
} from '../data/week';

const NOTIF_TIER_VALUES: readonly string[] = NOTIF_TIERS.map((t) => t.key);

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
    // Omitted rather than set to undefined when the row names no circle, for
    // the reason `media` gives below: `tasksAreSound` is all-or-nothing, and a
    // key it cannot read costs the whole persisted payload rather than the one
    // field. A key that is absent is never read.
    ...(typeof row.circle_id === 'string' ? { circleId: row.circle_id } : null),
  };
}

/**
 * A `profiles` row is only ever an id and a name, so everything the UI needs
 * beyond that — first name, initials, tint — is derived by `personOf`. The
 * handle stands in for a blank name rather than rendering an empty avatar.
 */
/**
 * A `week_rollups` row, back into the week the Ledger and the year grid draw.
 *
 * The table carries five numbers and a date; `HistoryWeek` carries those plus a
 * number, a label, a summary line and three lists. Every one of the extras is
 * rebuilt here rather than stored, and each for its own reason:
 *
 *  - `n` and `label` come from `buildWeekContext`, which already turns a Monday
 *    into "Week 33". Storing them would be a second copy of the calendar.
 *  - `sub` and `quiet` come from `weekSummary`, the same function
 *    `COMMIT_ROLLOVER` uses, so a restored week describes itself exactly as it
 *    did before the reinstall.
 *  - `did` stays **empty**, and that is the one real loss. The titles are on the
 *    server already, in `tasks`, so putting them in `week_rollups` too would
 *    duplicate them — and the engine only pulls the current week, so reading
 *    them back is a wider change than this. `helpedBy` and `helped` are empty
 *    for a stronger reason: they are empty on a live rollover too, so a restored
 *    week matches a locally-closed one exactly.
 */
export function rowToHistoryWeek(rollup: {
  weekStart: string;
  points: number;
  done: number;
  total: number;
}): HistoryWeek {
  const start = asDate(rollup.weekStart) ?? new Date();
  const week = buildWeekContext(start, isoWeekNumber(start));

  return {
    n: week.number,
    label: week.label,
    points: rollup.points,
    done: rollup.done,
    total: rollup.total,
    ...weekSummary(rollup.done, rollup.total),
    did: [],
    helpedBy: [],
    helped: [],
  };
}

/**
 * A `profiles` row as the directory holds it.
 *
 * The two avatar fields are narrowed rather than copied: `avatar_state` is
 * another client's column and a value this build does not know becomes `none`,
 * which renders initials — the one answer that is safe for a word we cannot
 * read. `avatar_path` is bounded here for the reason `NAME_MAX` bounds the
 * name: this row is persisted, and a payload that fails validation on restore
 * takes the whole device's state with it.
 */
export function rowToPerson(row: Record<string, unknown>): Person {
  const id = str(row.id) as PersonId;
  const name = str(row.name).trim();
  const handle = str(row.handle).trim();
  const avatarPath = avatarPathOf(row.avatar_path);
  const avatarState = avatarStateOf(row.avatar_state);
  return personOf(id, name || handle || 'Someone', {
    // Only carried when there is something to carry, so a person with no photo
    // compares equal to the same person from a build that had no such column.
    ...(avatarPath && avatarState !== 'none' ? { avatarPath } : {}),
    ...(avatarState === 'none' ? {} : { avatarState }),
  });
}

/**
 * The longest object name kept. `<uuid>/<uuid>/<uuid>.jpg` is 114 characters
 * and the column is constrained to exactly that shape, so this is a bound on
 * a row that is already bounded — carried for the same reason
 * `AVATAR_PATH_MAX` is, since this one is persisted too.
 */
export const MEDIA_PATH_MAX = 160;

/**
 * A `task_media` row as a card can draw it, or nothing.
 *
 * Dropped rather than defaulted, which is the opposite of `rowToPerson`'s
 * choice and right for the opposite reason. An unreadable `avatar_state` still
 * has to render *something*, and initials are that something. A photo is
 * optional: there is no fallback picture, and the honest answer to a row this
 * build cannot read is a goal with no photo on it.
 *
 * `w` and `h` must be positive, not merely finite. They reach an `aspectRatio`,
 * and a zero height is an infinite one — which is a card that takes the screen
 * rather than a photo that looks wrong.
 *
 * `url` is deliberately absent here. The row carries an object name; the URL is
 * signed later, per pull, by `lib/mediaUrl.ts`, and a signed URL has no
 * business being minted inside a mapper.
 */
export function rowToPulledMedia(row: Record<string, unknown>): PulledMedia[] {
  const id = str(row.id);
  const taskId = str(row.task_id);
  const path = str(row.path);
  const w = Number(row.width);
  const h = Number(row.height);

  if (!id || !taskId) return [];
  if (!path || path.length > MEDIA_PATH_MAX) return [];
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return [];

  return [{ taskId, media: { id, path, w, h } }];
}

/**
 * How long ago, in the shape the feed sorts and renders: `"6h"`, `"2d"`.
 *
 * The feed's only clock is `parseHours`, which reads exactly this format — so
 * the conversion happens here rather than the `Moment` growing a timestamp
 * field. That costs staleness between pulls, which is bounded by the pull
 * interval and invisible at hour granularity.
 */
export function relativeTime(iso: unknown, now: number = Date.now()): string {
  const at = asDate(iso)?.getTime();
  if (at === undefined || !Number.isFinite(at)) return '0h';
  const hours = Math.max(0, Math.floor((now - at) / 3_600_000));
  return hours >= 24 ? `${Math.floor(hours / 24)}d` : `${hours}h`;
}

/**
 * Someone else's task, as the feed renders it.
 *
 * Always `kind: 'normal'`. Not `'big'` — that card's entire stat row is the
 * constant `BIG_CARD_STATS`, so emitting one would print invented numbers over
 * a real person's week. Not `'ask'` either: nothing on a task row says a person
 * is asking for company, and guessing would put words in their mouth.
 */
export function taskRowToMoment(
  row: Record<string, unknown>,
  now?: number,
  cheers?: number,
  media?: TaskMedia,
): Moment {
  const task = rowToTask(row);
  return {
    id: task.id,
    who: str(row.owner_id),
    kind: 'normal',
    // Closing it is the news; staking it is when there was none yet.
    time: relativeTime(row.done_at ?? row.created_at, now),
    day: task.day,
    title: task.title,
    pts: task.pts,
    cheers,
    // Carried so a person's own sheet can show which of their week is closed,
    // and so Plan can offer the same goal back at its own price. The feed card
    // reads neither — a moment is drawn the same either way.
    done: task.done,
    cat: task.cat,
    // Notes on someone else's task are not pulled — `pullNotes` answers for
    // your own rows and your own inbox. What is here is what this device wrote.
    cmts: [],
    // Omitted rather than set to undefined when there is none. `momentsAreSound`
    // rejects a `media` key it cannot read, and a rejected payload does not
    // lose the photo — it loses the whole persisted state, week included. A
    // key that is absent is never read.
    ...(media ? { media } : null),
    // Same treatment, and the same reason. `rowToTask` has already narrowed it.
    ...(task.circleId ? { circleId: task.circleId } : null),
  };
}

/**
 * A member's week, counted off the rows the feed just pulled.
 *
 * `ranking()` reads `Person.stats` and says "No week synced yet" without it,
 * which is what the Circle screen shows for every live member today. Derived
 * here rather than read from `week_rollups`, which nothing writes yet — and
 * counting the rows we already have is both cheaper and current, where a rollup
 * is only written when a week closes.
 *
 * `given` stays 0: cheers *given* by someone else are not something this client
 * can see, and a fabricated number would rank people by it.
 */
export function memberStats(rows: Record<string, unknown>[]): Map<string, MemberStats> {
  const byOwner = new Map<string, MemberStats>();
  for (const row of rows) {
    const owner = str(row.owner_id);
    if (!owner) continue;
    const stats = byOwner.get(owner) ?? { done: 0, total: 0, streak: 0, given: 0 };
    stats.total += 1;
    if (row.done_at !== null && row.done_at !== undefined) stats.done += 1;
    byOwner.set(owner, stats);
  }
  return byOwner;
}

/**
 * A `notifications` row, as the feed renders it.
 *
 * Everything comes off `payload`, which the trigger built — deliberately, so
 * this needs no second read. `notifications_select` is scoped to the recipient,
 * but a *profile* is only readable when you share a circle, and a cheer can
 * arrive from an `aud = 'everyone'` task where you share none. A row that had
 * to be joined to `profiles` to be drawn would render as "Someone" exactly when
 * it mattered most.
 */
export function rowToNotification(row: Record<string, unknown>, now?: number): Notification {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const tier = str(row.tier) as NotifTier;
  const title = str(payload.task_title);
  return {
    id: str(row.id),
    tier: NOTIF_TIER_VALUES.includes(tier) ? tier : 'circle',
    kind: 'cheer',
    who: str(payload.actor_id) as PersonId,
    name: str(payload.actor_name) || 'Someone',
    text: title ? `cheered “${title}”` : 'cheered your task',
    time: `${relativeTime(row.created_at, now)} ago`,
    // Opening it opens the task it is about, which is the whole point of a
    // notification you can act on.
    sheetId: str(payload.task_id) || undefined,
  };
}

/** First token only: "Dre, Maya and Nana" is the design's shape, not their full names. */
const firstNameOf = (name: string): string => name.trim().split(/\s+/)[0] || name;

/**
 * Several cheers on one task, as one row.
 *
 * The screen has always promised this — the design ships a fixture reading
 * "Dre, Maya and Nana cheered your run" — and until now the feed gave you three
 * separate lines saying the same thing about the same task.
 *
 * Grouped here rather than in the trigger. A row per cheer is the honest record:
 * withdrawing one deletes exactly that row, and the group shrinks by itself. A
 * trigger that merged them would have to un-merge on delete, editing a jsonb
 * array under concurrency to answer a question the client can answer by reading.
 *
 * Only cheers, and only ones that name a task. Everything else passes through
 * in place — the order of the feed is the order it arrived.
 */
export function batchCheers(items: Notification[]): Notification[] {
  const groups = new Map<string, Notification[]>();
  for (const item of items) {
    if (item.kind !== 'cheer' || !item.sheetId) continue;
    const members = groups.get(item.sheetId);
    if (members) members.push(item);
    else groups.set(item.sheetId, [item]);
  }

  const emitted = new Set<string>();
  return items.flatMap((item) => {
    const members = item.sheetId ? groups.get(item.sheetId) : undefined;
    if (!members) return [item];
    // The group takes the position of its newest member and appears once.
    if (emitted.has(item.sheetId!)) return [];
    emitted.add(item.sheetId!);
    if (members.length === 1) return [item];

    const names = members.map((m) => firstNameOf(m.name ?? ''));
    return [
      {
        ...item,
        // Keyed on the newest member so a cheer arriving after you have read
        // the group makes it unread again — which is the whole point of the row.
        id: `cheer:${item.sheetId}:${item.id}`,
        name: joinNames(names),
        // The stack is three deep in the design; the sentence carries the rest.
        faces: members.slice(0, 3).flatMap((m) => (m.who ? [m.who] : [])),
      },
    ];
  });
}

/** "Dre", "Dre and Maya", "Dre, Maya and Nana", "Dre, Maya and 2 others". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}
