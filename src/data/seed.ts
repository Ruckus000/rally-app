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

export type World = {
  /** The circle, always including you. */
  members: PersonId[];
  notifications: Notification[];
  owed: { k: PersonId; reason: string }[];
  /** The PICK IT BACK UP rail. */
  suggestions: Suggestion[];
  /** "People you might know" in the invite sheet. */
  inviteSuggestions: PersonId[];
};

const SEEDED: World = Object.freeze({
  members: CIRCLE,
  notifications: NOTIFICATIONS,
  owed: OWED_SEED,
  suggestions: SUGGESTIONS,
  inviteSuggestions: INVITE_SUGGESTIONS,
});

const FRESH: World = Object.freeze({
  members: [SELF_DEMO_ID],
  notifications: [],
  owed: [],
  suggestions: [],
  inviteSuggestions: [],
});

/** Live starts out looking like a fresh account; the server fills it in. */
export const WORLD: Record<AccountMode, World> = { fresh: FRESH, seeded: SEEDED, live: FRESH };

/** Undecided (mid-onboarding) counts as fresh — nothing has been granted yet. */
export const getWorld = (mode: AccountMode | null): World => WORLD[mode ?? 'fresh'];

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
