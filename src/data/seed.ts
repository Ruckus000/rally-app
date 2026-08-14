/**
 * What an account starts with.
 *
 * The fixtures are not the app's initial state — they're one of two seeds.
 * Joining the circle gets you the populated demo; skipping gets a genuinely
 * empty account, which is the first-run state the handoff left undesigned.
 *
 * A `World` is what your account *type* gives you and never changes: who's in
 * the circle, what's in the feed, what you can be nudged about. Anything that
 * accumulates — closed weeks, the year grid, your running totals — is state,
 * because rollover has to move it.
 */
import {
  HistoryWeek,
  INVITE_SUGGESTIONS,
  GLOBAL_MOMENTS,
  MOMENTS,
  ME,
  MY_TASKS,
  Moment,
  NOTIFICATIONS,
  Notification,
  OWED_SEED,
  PAST_WEEKS,
  SUGGESTIONS,
  Suggestion,
  Task,
  WEEK_HISTORY,
  YEAR_LEVELS,
  CIRCLE,
} from './fixtures';
import { WeekContext, weekBefore } from './week';
import {
  DEMO_INDEX,
  PeopleIndex,
  SELF_DEMO_ID,
  SELF_ONLY_INDEX,
  indexPeople,
  type PersonId,
} from './people';

/**
 * Kept as a tuple so the persistence guard can be written against it. The two
 * used to be spelled out separately, and a mode added here but not there would
 * have meant every payload of that kind was silently thrown away on launch.
 */
export const ACCOUNT_MODES = ['fresh', 'seeded', 'live'] as const;
export type AccountMode = (typeof ACCOUNT_MODES)[number];

/**
 * Your running totals. Held in state and updated when a week closes, rather
 * than derived from `history` — the seeded account's 2,840 points cover 37
 * weeks but only three of them have detailed records, so deriving would
 * double-count those three against the baseline.
 */
export type Profile = {
  allTimePoints: number;
  weeksIn: number;
  bestWeekPoints: number;
  bestWeekLabel: string;
  longestStreak: number;
  mostTasksClosed: number;
  perfectWeeks: number;
  currentStreak: number;
  cheersReceived: number;
  baseCheersGiven: number;
};

/**
 * Content that only a demo account has, and that a live one is *right* to have
 * none of.
 *
 * This used to be called a World and to hold `members` and `notifications` too
 * — a live account got the `fresh` one, so those two read as a circle of one
 * and a bell with nothing in it. Both were bugs, five times between them: the
 * header's "1 people, ranked by follow-through" next to two names, a badge that
 * could never light, and a "mark all read" that marked nothing.
 *
 * The fix that lasts is not another guard at the call site. It is that this
 * type no longer has a field a live account could want. Everything left is
 * demo furniture — three fixtures with no server counterpart and no plans for
 * one — so an empty answer is the true one rather than a stale one. Anything
 * with two possible sources lives in state and is seeded per mode, next to
 * `moments` and `globalPosts`.
 */
export type DemoContent = {
  owed: { k: PersonId; reason: string }[];
  /** The PICK IT BACK UP rail. */
  suggestions: Suggestion[];
  /** "People you might know" in the invite sheet. */
  inviteSuggestions: PersonId[];
};

const SEEDED_CONTENT: DemoContent = Object.freeze({
  owed: OWED_SEED,
  suggestions: SUGGESTIONS,
  inviteSuggestions: INVITE_SUGGESTIONS,
});

/** A fresh account, and a live one: none of this is theirs to have. */
const NOTHING: DemoContent = Object.freeze({ owed: [], suggestions: [], inviteSuggestions: [] });

export const DEMO_CONTENT: Record<AccountMode, DemoContent> = {
  fresh: NOTHING,
  seeded: SEEDED_CONTENT,
  live: NOTHING,
};

/** Undecided (mid-onboarding) counts as fresh — nothing has been granted yet. */
export const demoContent = (mode: AccountMode | null): DemoContent =>
  DEMO_CONTENT[mode ?? 'fresh'];

/**
 * Who is in the demo's circle. A live account's is `Object.keys(state.people)`,
 * and `circleMembers` is the one place that chooses — which is what the
 * header's member count now asks, having previously asked the world.
 */
export const seedCircle = (mode: AccountMode | null): PersonId[] =>
  mode === 'seeded' ? CIRCLE : [SELF_DEMO_ID];

/**
 * The demo's bell. A live account's arrives from `notifications`, written by a
 * trigger, so this is seeded into state exactly like `moments` — and never
 * restored from disk, because unlike a moment it cannot be edited: nothing but
 * `notifRead` moves, and that is persisted separately.
 */
export const seedNotifications = (mode: AccountMode | null): Notification[] =>
  mode === 'seeded' ? NOTIFICATIONS : [];

/**
 * Live mode gets an empty directory rather than the self-only one: the account
 * is a real profile row, so inventing a placeholder for it would shadow it.
 */
export const seedPeople = (mode: AccountMode | null): PeopleIndex => {
  if (mode === 'seeded') return DEMO_INDEX;
  // A live circle arrives from the server. Null prototype like every other
  // directory in the app, so a lookup for an id like `toString` still misses
  // instead of returning an inherited function.
  if (mode === 'live') return indexPeople([]);
  return SELF_ONLY_INDEX;
};

export const seedTasks = (mode: AccountMode | null): Task[] =>
  mode === 'seeded' ? MY_TASKS : [];

export const seedMoments = (mode: AccountMode | null): Moment[] =>
  mode === 'seeded' ? MOMENTS : [];

/**
 * The Global feed, which is public — so unlike the circle's, it is seeded for
 * *every* demo mode. A fresh account knows nobody and has staked nothing; this
 * is the one tab it can open on and find something.
 *
 * Live gets nothing, and the Oz bots' real rows arrive on the next pull. Same
 * arrangement as `moments`, and deliberately so: one slice, seeded for the
 * demo and replaced by the server, rather than a second way to ask.
 */
export const seedGlobalPosts = (mode: AccountMode | null): Moment[] =>
  mode === 'live' ? [] : GLOBAL_MOMENTS;

/**
 * Seeded history is labelled relative to whatever week it is now, so the demo
 * ages gracefully instead of describing weeks that have already passed.
 * Newest first, matching how Past weeks renders.
 */
export const seedHistory = (mode: AccountMode | null, week: WeekContext): HistoryWeek[] => {
  if (mode !== 'seeded') return [];
  return PAST_WEEKS.map((n, i) => {
    const w = weekBefore(week, i + 1);
    return { ...WEEK_HISTORY[n], n: w.number, label: w.label };
  });
};

export const seedYearLevels = (mode: AccountMode | null): number[] =>
  mode === 'seeded' ? YEAR_LEVELS : [];

const FRESH_PROFILE: Profile = {
  allTimePoints: 0,
  // You're in your first week the moment you start, not your zeroth.
  weeksIn: 1,
  bestWeekPoints: 0,
  bestWeekLabel: '—',
  longestStreak: 0,
  mostTasksClosed: 0,
  perfectWeeks: 0,
  currentStreak: 0,
  cheersReceived: 0,
  baseCheersGiven: 0,
};

const SEEDED_PROFILE: Profile = {
  allTimePoints: 2840,
  weeksIn: 37,
  bestWeekPoints: 240,
  bestWeekLabel: 'Wk 31',
  longestStreak: 5,
  mostTasksClosed: 9,
  perfectWeeks: 3,
  currentStreak: 3,
  cheersReceived: 19,
  baseCheersGiven: 12,
};

export const seedProfile = (mode: AccountMode | null): Profile =>
  mode === 'seeded' ? { ...SEEDED_PROFILE } : { ...FRESH_PROFILE };

/** Identity is the same whichever way you came in. */
export const IDENTITY = ME;
