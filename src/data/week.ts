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
 * Fixture anchor: Thursday Aug 13 2026. Its Monday-start week is Aug 10–16 —
 * the range the design reference shows — and `today` lands on day 3, matching
 * the prototype's `day: 3`.
 */
export const CURRENT_WEEK = buildWeekContext(new Date(2026, 7, 13), 33);
