/**
 * A seeded `State` for tests to build on.
 *
 * Lives outside `__tests__` so jest doesn't try to run it as a suite. It exists
 * because three separate suites were each spelling out the full state literal,
 * so every new field meant three identical edits.
 */
import type { State } from '../state/store';
import { MOMENTS, MY_TASKS } from '../data/fixtures';
import { seedHistory, seedPeople, seedProfile, seedYearLevels } from '../data/seed';
import { SELF_DEMO_ID } from '../data/people';
import { FIXTURE_WEEK } from '../data/week';

/** The populated demo account, mid-week, with nothing acted on yet. */
export const baseState: State = {
  account: 'seeded',
  selfId: SELF_DEMO_ID,
  // A demo account never signs in, so `off` is the only value it can hold.
  session: { status: 'off' },
  people: seedPeople('seeded'),
  // Pinned, so the suite doesn't drift with the calendar.
  week: FIXTURE_WEEK,
  history: seedHistory('seeded', FIXTURE_WEEK),
  yearLevels: seedYearLevels('seeded'),
  profile: seedProfile('seeded'),
  pendingRollover: null,
  tab: 'week',
  scope: 'friends',
  day: FIXTURE_WEEK.today,
  myTasks: MY_TASKS,
  moments: MOMENTS,
  acted: {},
  replied: {},
  pending: {},
  personNotes: {},
  globalNotes: {},
  usedSugg: {},
  note: '',
  draft: '',
  composerVal: '',
  draftDay: null,
  draftCat: 'Fitness',
  draftPair: [],
  draftAud: null,
  editingId: null,
  planOpen: false,
  wrapOpen: false,
  wrapWeek: null,
  notifOpen: false,
  notifFilter: 'all',
  notifRead: {},
  sheet: null,
  composerOpen: false,
  onboardStep: null,
  toast: null,
  toastSeq: 0,
};

/** An account that declined the circle: no tasks, no moments, no history. */
export const freshState: State = {
  ...baseState,
  account: 'fresh',
  // Without this the spread hands a fresh account the whole demo directory.
  people: seedPeople('fresh'),
  myTasks: [],
  moments: [],
  history: [],
  yearLevels: [],
  profile: seedProfile('fresh'),
  scope: 'personal',
};
