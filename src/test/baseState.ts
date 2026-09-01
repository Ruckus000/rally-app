/**
 * A seeded `State` for tests to build on.
 *
 * Lives outside `__tests__` so jest doesn't try to run it as a suite. It exists
 * because three separate suites were each spelling out the full state literal,
 * so every new field meant three identical edits.
 */
import type { State } from '../state/store';
import { CATEGORY_POINTS, MOMENTS, MY_TASKS } from '../data/fixtures';
import {
  seedGlobalPosts,
  seedHistory,
  seedNotifications,
  seedPeople,
  seedProfile,
  seedYearLevels,
} from '../data/seed';
import { SELF_DEMO_ID } from '../data/people';
import { FIXTURE_WEEK } from '../data/week';

/** The populated demo account, mid-week, with nothing acted on yet. */
export const baseState: State = {
  account: 'seeded',
  deletionAt: null,
  selfId: SELF_DEMO_ID,
  circles: [],
  activeCircleId: null,
  // A fixture has never been reseeded. The engine reads this to tell a world
  // being replaced from one the user emptied by hand; a fixture is neither.
  worldEpoch: 0,
  // A fixture is the answer, so nothing is waiting on a pull to give one.
  worldSeen: true,
  // Seeded like every other demo slice. These two used to be empty here and
  // filled from the world object instead, which is exactly the arrangement
  // that let a live account read the demo's.
  notifications: seedNotifications('seeded'),
  globalPosts: seedGlobalPosts('seeded'),
  // A demo account never signs in, so `off` is the only value it can hold.
  session: { status: 'off' },
  // Nothing has been refused. The banner that reads this must stay silent
  // unless a test says otherwise.
  unsaved: 0,
  people: seedPeople('seeded'),
  // Pinned, so the suite doesn't drift with the calendar.
  week: FIXTURE_WEEK,
  history: seedHistory('seeded', FIXTURE_WEEK),
  yearLevels: seedYearLevels('seeded'),
  profile: seedProfile('seeded'),
  pendingRollover: null,
  tab: 'week',
  scope: 'feed',
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
  draftPts: CATEGORY_POINTS.Fitness,
  draftVerdict: 'ok',
  draftReason: '',
  draftPair: [],
  draftAud: null,
  draftCircleId: null,
  editingId: null,
  planOpen: false,
  settingsOpen: false,
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
  blocked: [],
  reportTarget: null,
  reported: [],
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
