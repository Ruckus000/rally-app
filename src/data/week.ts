/**
 * The single week-context object.
 *
 * The handoff flags "no rollover logic" as a gap: every week reference in the
 * app must derive from one object rather than from scattered literals. This is
 * that object. The fixture pins it to Week 33 so the build matches the design
 * reference; swap `anchor` for a real clock and everything downstream follows.
 */

export const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type WeekContext = {
  /** ISO-ish week number used in copy: "Week 33". */
  number: number;
  /** Monday of this week. Week starts Monday; day 0 is Monday. */
  start: Date;
  end: Date;
  /** 0–6, Monday-indexed. */
  today: DayIndex;
  /** Days remaining including today's tail, as the Plan eyebrow counts them. */
  daysLeft: number;
  /** "Aug 10–16" */
  dateRange: string;
  /** "Week 33" */
  label: string;
  /** "Thursday" */
  todayName: string;
};

const formatRange = (start: Date, end: Date) => {
  const a = `${MONTHS[start.getMonth()]} ${start.getDate()}`;
  const b =
    start.getMonth() === end.getMonth()
      ? `${end.getDate()}`
      : `${MONTHS[end.getMonth()]} ${end.getDate()}`;
  return `${a}–${b}`;
};

/** Monday-indexed day for a JS date (JS weeks start Sunday). */
export const dayIndexOf = (d: Date): DayIndex => (((d.getDay() + 6) % 7) as DayIndex);

export const buildWeekContext = (anchor: Date, number: number): WeekContext => {
  const today = dayIndexOf(anchor);
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - today);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    number,
    start,
    end,
    today,
    daysLeft: 7 - today,
    dateRange: formatRange(start, end),
    label: `Week ${number}`,
    todayName: DAY_NAMES[today],
  };
};

/**
 * ISO-8601 week number: weeks start Monday, and week 1 is the one containing
 * the first Thursday of the year.
 */
export const isoWeekNumber = (d: Date): number => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Shift to the Thursday of this week — that's what decides the week's year.
  t.setUTCDate(t.getUTCDate() - dayIndexOf(d) + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(
    firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3,
  );
  return 1 + Math.round((t.getTime() - firstThursday.getTime()) / (7 * 86400000));
};

/** The week it actually is, right now. */
export const liveWeek = (now: Date = new Date()): WeekContext =>
  buildWeekContext(now, isoWeekNumber(now));

/**
 * Fixture anchor: Thursday Aug 13 2026, which really is ISO week 33 and whose
 * Monday-start range is Aug 10–16 — what the design reference shows. Tests seed
 * from this so the suite doesn't drift with the calendar.
 */
export const FIXTURE_WEEK = buildWeekContext(new Date(2026, 7, 13), 33);

/**
 * Kept for the modules that only need "some week" at import time. Anything
 * that must react to the week changing reads `state.week` instead.
 */
export const CURRENT_WEEK = FIXTURE_WEEK;

/** The week after the given one. */
export const weekAfter = (week: WeekContext): WeekContext => {
  const d = new Date(week.start);
  d.setDate(d.getDate() + 7);
  return buildWeekContext(d, isoWeekNumber(d));
};

/** The week `n` weeks before the given one — used to label seeded history. */
export const weekBefore = (week: WeekContext, n: number): WeekContext => {
  const d = new Date(week.start);
  d.setDate(d.getDate() - 7 * n);
  return buildWeekContext(d, isoWeekNumber(d));
};
