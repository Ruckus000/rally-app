/**
 * What an account starts with.
 *
 * The fixtures are not the app's initial state — they're one of two seeds.
 * Joining the circle gets you the populated demo; skipping gets you a genuinely
 * empty account, which is the first-run state the handoff left undesigned.
 *
 * A `World` is derived from the account mode and never stored in state. Both
 * are built once here, so `getWorld` is a lookup with stable references.
 */
import {
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
  YEAR_LEVELS,
  CIRCLE,
} from './fixtures';
import type { PersonKey } from '../theme/tokens';

export type AccountMode = 'fresh' | 'seeded';

/** The numbers that used to be hardcoded on `ME`. A fresh account zeroes them. */
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
  members: PersonKey[];
  notifications: Notification[];
  /** Week numbers, keys into WEEK_HISTORY. */
  pastWeeks: number[];
  yearLevels: number[];
  owed: { k: PersonKey; reason: string }[];
  /** The PICK IT BACK UP rail. */
  suggestions: Suggestion[];
  /** "People you might know" in the invite sheet. */
  inviteSuggestions: PersonKey[];
  profile: Profile;
};

const SEEDED: World = Object.freeze({
  members: CIRCLE,
  notifications: NOTIFICATIONS,
  pastWeeks: PAST_WEEKS,
  yearLevels: YEAR_LEVELS,
  owed: OWED_SEED,
  suggestions: SUGGESTIONS,
  inviteSuggestions: INVITE_SUGGESTIONS,
  profile: {
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
  },
});

const FRESH: World = Object.freeze({
  members: ['you'] as PersonKey[],
  notifications: [],
  pastWeeks: [],
  yearLevels: [],
  owed: [],
  suggestions: [],
  inviteSuggestions: [],
  profile: {
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
  },
});

export const WORLD: Record<AccountMode, World> = { fresh: FRESH, seeded: SEEDED };

/** Undecided (mid-onboarding) counts as fresh — nothing has been granted yet. */
export const getWorld = (mode: AccountMode | null): World => WORLD[mode ?? 'fresh'];

export const seedTasks = (mode: AccountMode | null): Task[] =>
  mode === 'seeded' ? MY_TASKS : [];

export const seedMoments = (mode: AccountMode | null): Moment[] =>
  mode === 'seeded' ? MOMENTS : [];

/** Identity is the same whichever way you came in. */
export const IDENTITY = ME;
