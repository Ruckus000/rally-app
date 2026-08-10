/**
 * Mock data. Explicitly *not* spec — the handoff calls out that every person,
 * task, week and grid cell here is a fixture standing in for a backend.
 */
import type { PersonKey } from '../theme/tokens';
import type { DayIndex } from './week';

export type Audience = 'friends' | 'everyone' | 'private';
export type Category = 'Fitness' | 'Work' | 'Home' | 'Mind' | 'Quick log';

export const NAME: Record<PersonKey, string> = {
  you: 'You',
  maya: 'Maya Chen',
  dre: 'Dre Okafor',
  jordan: 'Jordan Lee',
  sofia: 'Sofia Park',
  nana: 'Nana Rosa',
  tomas: 'Tomás Vega',
};

export const FIRST: Record<PersonKey, string> = {
  you: 'You',
  maya: 'Maya',
  dre: 'Dre',
  jordan: 'Jordan',
  sofia: 'Sofia',
  nana: 'Nana',
  tomas: 'Tomás',
};

export const INITIALS: Record<PersonKey, string> = {
  you: 'AR',
  maya: 'MC',
  dre: 'DO',
  jordan: 'JL',
  sofia: 'SP',
  nana: 'NR',
  tomas: 'TV',
};

export type MemberStats = { done: number; total: number; streak: number; given: number };

export const STATS: Record<Exclude<PersonKey, 'you'>, MemberStats> = {
  maya: { done: 7, total: 7, streak: 5, given: 9 },
  dre: { done: 5, total: 7, streak: 2, given: 6 },
  sofia: { done: 4, total: 6, streak: 4, given: 3 },
  nana: { done: 6, total: 6, streak: 1, given: 5 },
  jordan: { done: 1, total: 5, streak: 0, given: 1 },
  tomas: { done: 2, total: 2, streak: 1, given: 0 },
};

export const FRIENDS: PersonKey[] = ['maya', 'dre', 'jordan', 'sofia', 'nana'];
export const CIRCLE: PersonKey[] = ['you', ...FRIENDS, 'tomas'];

export const TREND: Record<PersonKey, 'up' | 'down' | 'same'> = {
  maya: 'up',
  dre: 'down',
  jordan: 'down',
  sofia: 'up',
  nana: 'same',
  tomas: 'up',
  you: 'up',
};

export const CIRCLE_NAME = 'The Basement';
export const ME = {
  key: 'you' as PersonKey,
  name: 'Alex Rivera',
  handle: '@alexrivera',
  shortHandle: '@alexr',
  since: 'rallying since Nov 2025',
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
  inviteLink: 'rally.app/join/basement-9x2',
};

export const CATEGORIES: Category[] = ['Fitness', 'Work', 'Home', 'Mind'];
export const CATEGORY_POINTS: Record<Category, number> = {
  Fitness: 35,
  Work: 45,
  Home: 25,
  Mind: 25,
  'Quick log': 20,
};

/** Placeholder changes with the selected category. */
export const CATEGORY_HINT: Record<string, string> = {
  Fitness: 'run three times this week',
  Work: 'ship the portfolio site by Friday',
  Home: 'meal prep every Sunday',
  Mind: 'read 30 minutes before bed',
};

export const AUDIENCES: Audience[] = ['friends', 'everyone', 'private'];
export const AUDIENCE_LABEL: Record<Audience, string> = {
  friends: 'Friends',
  everyone: '🌐 Everyone',
  private: '🔒 Private',
};
/** Bare words for the segmented control, where the glyphs would be noise. */
export const AUDIENCE_WORD: Record<Audience, string> = {
  friends: 'Friends',
  everyone: 'Everyone',
  private: 'Private',
};

export const QUICK_LOG_POINTS = 20;

export type Note = { w: string; k: PersonKey; t: string };

export type Task = {
  id: string;
  day: DayIndex;
  title: string;
  cat: Category;
  pts: number;
  done: boolean;
  aud: Audience;
  pair: PersonKey[];
  pairKind: 'joint' | 'loose' | null;
  pairStatus?: Partial<Record<PersonKey, boolean>>;
  cmts: Note[];
  /** Quick logs and staked tasks are both tasks; this is how the list tells them apart. */
  source: 'staked' | 'quicklog';
};

export const MY_TASKS: Task[] = [
  {
    id: 'm1',
    day: 0,
    title: 'Run 3x this week',
    cat: 'Fitness',
    pts: 40,
    done: true,
    aud: 'friends',
    pair: ['dre'],
    pairKind: 'joint',
    pairStatus: { dre: false },
    cmts: [{ w: 'Dre', k: 'dre', t: 'Same pace as me — let’s go again Thursday.' }],
    source: 'staked',
  },
  {
    id: 'm2',
    day: 1,
    title: 'Ship the portfolio site',
    cat: 'Work',
    pts: 50,
    done: false,
    aud: 'friends',
    pair: [],
    pairKind: null,
    cmts: [{ w: 'Maya', k: 'maya', t: 'Friday. I’m calling you Friday, don’t hide.' }],
    source: 'staked',
  },
  {
    id: 'm3',
    day: 2,
    title: 'Therapy homework',
    cat: 'Mind',
    pts: 20,
    done: false,
    aud: 'private',
    pair: ['sofia'],
    pairKind: 'loose',
    cmts: [{ w: 'Sofia', k: 'sofia', t: 'Proud of you for doing this at all.' }],
    source: 'staked',
  },
  {
    id: 'm4',
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
  },
  {
    id: 'm5',
    day: 4,
    title: 'Inbox zero by Friday',
    cat: 'Work',
    pts: 25,
    done: false,
    aud: 'friends',
    pair: [],
    pairKind: null,
    cmts: [],
    source: 'staked',
  },
  {
    id: 'm6',
    day: 6,
    title: 'Meal prep for the week',
    cat: 'Home',
    pts: 25,
    done: false,
    aud: 'everyone',
    pair: ['nana'],
    pairKind: 'loose',
    cmts: [{ w: 'Nana', k: 'nana', t: 'The bean recipe. You’ll thank me.' }],
    source: 'staked',
  },
];

export type MomentKind = 'big' | 'ask' | 'quiet' | 'quietwin' | 'normal';

export type Moment = {
  id: string;
  who: PersonKey;
  kind: MomentKind;
  time: string;
  day: DayIndex;
  title?: string;
  text?: string;
  quote?: string;
  pts?: number;
  backers?: PersonKey[];
  cmts?: Note[];
};

export const MOMENTS: Moment[] = [
  {
    id: 'f1',
    who: 'maya',
    kind: 'big',
    time: '6h',
    day: 1,
    title: '7 of 7 — the entire thing',
    pts: 285,
    quote: 'Dre’s 6am texts did this, not me.',
    backers: ['dre', 'nana'],
    cmts: [
      { w: 'Dre', k: 'dre', t: 'The 6am club pays out.' },
      { w: 'Nana', k: 'nana', t: 'A perfect week. Dinner’s on me.' },
    ],
  },
  {
    id: 'f2',
    who: 'jordan',
    kind: 'ask',
    time: '3h',
    day: 2,
    title: 'Draft the business plan',
    quote: 'Third day staring at page one. Someone sit with me on a call.',
    cmts: [],
  },
  {
    id: 'f3',
    who: 'tomas',
    kind: 'quiet',
    time: '1d',
    day: 2,
    text: 'Tomás’s week didn’t finish last week. Back at it — no fuss.',
  },
  {
    id: 'f4',
    who: 'sofia',
    kind: 'quietwin',
    time: '2h',
    day: 3,
    title: '5 mornings of meditation, unbroken',
    cmts: [],
  },
  {
    id: 'f5',
    who: 'nana',
    kind: 'normal',
    time: '1d',
    day: 5,
    title: 'Tomato beds are in the ground',
    quote: 'Dre turned up with 40kg of soil unannounced.',
    backers: ['maya'],
    cmts: [{ w: 'Maya', k: 'maya', t: 'Tomato szn is upon us.' }],
  },
];

/** The big card's stat row is the author's week, not yours. */
export const BIG_CARD_STATS = { tasks: '7/7', pts: '285', streak: '5w' };
export const BIG_CARD_BASE_CHEERS = 12;

export type GlobalPost = {
  id: string;
  name: string;
  ini: string;
  tint: string;
  time: string;
  statLabel: string;
  title: string;
  quote: string;
  cheers: number;
  comments: number;
};

export const GLOBAL_POSTS: GlobalPost[] = [
  {
    id: 'g1',
    name: '@kwon.builds',
    ini: 'K',
    tint: '#D8C9E0',
    time: '2h',
    statLabel: '11w streak',
    title: 'Day 77 — still going',
    quote: 'Some mornings I do not want to. Today was one of them.',
    cheers: 142,
    comments: 12,
  },
  {
    id: 'g2',
    name: '@marisol_runs',
    ini: 'M',
    tint: '#C9DCE0',
    time: '4h',
    statLabel: '19:48',
    title: 'Finished a sub-20 5K this morning',
    quote: '',
    cheers: 98,
    comments: 6,
  },
  {
    id: 'g3',
    name: '@task.goblin',
    ini: 'G',
    tint: '#E0D8C9',
    time: '6h',
    statLabel: '9/9 tasks',
    title: 'Clean sweep this week',
    quote: 'Nothing rolled over. First time all year.',
    cheers: 210,
    comments: 24,
  },
  {
    id: 'g4',
    name: '@dailydozen',
    ini: 'D',
    tint: '#E9E0C2',
    time: '9h',
    statLabel: '6w streak',
    title: 'Rebuilt the streak after a rough month',
    quote: '',
    cheers: 76,
    comments: 9,
  },
];

export type Suggestion = {
  id: string;
  tag: string;
  title: string;
  sub: string;
  pts: number;
  cat: Category;
  pair?: PersonKey[];
};

export const SUGGESTIONS: Suggestion[] = [
  {
    id: 's1',
    tag: 'UNFINISHED LAST WEEK',
    title: 'Stretch every night',
    sub: 'You got 4 of 7. Dre never dropped it.',
    pts: 20,
    cat: 'Fitness',
  },
  {
    id: 's2',
    tag: 'ALREADY IN',
    title: 'Run 3x this week',
    sub: 'Maya and Dre staked this one Monday.',
    pts: 40,
    cat: 'Fitness',
    pair: ['maya', 'dre'],
  },
  {
    id: 's3',
    tag: '3 WEEKS RUNNING',
    title: 'Read 30 mins nightly',
    sub: 'Your longest streak. Don’t break it here.',
    pts: 30,
    cat: 'Mind',
  },
];

export const PERSON_TASKS: Partial<Record<PersonKey, { t: string; done: boolean; sub: string }[]>> = {
  maya: [
    { t: 'Run 3x this week', done: true, sub: 'finished Tuesday' },
    { t: 'Ship the newsletter', done: true, sub: 'cheered by 2' },
    { t: 'Swim Sunday', done: true, sub: 'Nana joined her' },
  ],
  dre: [
    { t: '10K under 55:00', done: true, sub: '54:12 — Maya paced him' },
    { t: 'Stretch every night', done: false, sub: '4 of 7 nights' },
  ],
  jordan: [
    { t: 'Draft the business plan', done: false, sub: 'stalled 3 days' },
    { t: 'Email the landlord', done: true, sub: 'you nudged this one' },
  ],
  sofia: [
    { t: 'Meditate 5 mornings', done: true, sub: 'nobody said anything yet' },
    { t: 'Read 100 pages', done: false, sub: '62 in' },
  ],
  nana: [
    { t: 'Plant the tomato beds', done: true, sub: 'Dre showed up with soil' },
    { t: 'Call each grandkid', done: true, sub: '6 of 6' },
  ],
  tomas: [{ t: 'Walk 20 minutes daily', done: true, sub: '2 of 2 — fresh start' }],
};

export const PERSON_NOTES: Partial<Record<PersonKey, Note[]>> = {
  maya: [{ w: 'Dre', k: 'dre', t: 'Machine. Absolute machine.' }],
  dre: [{ w: 'Maya', k: 'maya', t: 'Negative splits?? Tell me everything.' }],
  jordan: [],
  sofia: [],
  nana: [{ w: 'Maya', k: 'maya', t: 'Tomato szn is upon us.' }],
  tomas: [],
};

export type HistoryWeek = {
  n: number;
  label: string;
  sub: string;
  pts: string;
  quiet?: boolean;
  did: { title: string; pts: string }[];
  helpedBy: { k: PersonKey; detail: string }[];
  helped: { k: PersonKey; detail: string }[];
};

export const WEEK_HISTORY: Record<number, HistoryWeek> = {
  32: {
    n: 32,
    label: 'Week 32',
    sub: '6 of 7 done',
    pts: '190 pts',
    did: [
      { title: 'Run 3x', pts: '+40' },
      { title: 'Ship newsletter draft', pts: '+35' },
      { title: 'Meal prep Sunday', pts: '+25' },
      { title: 'Stretch 5 nights', pts: '+20' },
      { title: 'Read 60 pages', pts: '+30' },
      { title: 'Call home twice', pts: '+40' },
    ],
    helpedBy: [
      { k: 'maya', detail: 'paced your Tuesday run' },
      { k: 'dre', detail: '2 nudges when you went quiet' },
    ],
    helped: [{ k: 'nana', detail: 'cheered her tomato beds' }],
  },
  31: {
    n: 31,
    label: 'Week 31',
    sub: '7 of 7 — the whole thing',
    pts: '240 pts',
    did: [
      { title: '10K long run', pts: '+50' },
      { title: 'Portfolio case study', pts: '+60' },
      { title: 'Meal prep Sunday', pts: '+40' },
      { title: 'Read 200 pages', pts: '+50' },
      { title: 'Inbox zero', pts: '+40' },
    ],
    helpedBy: [
      { k: 'maya', detail: 'checked in every morning' },
      { k: 'dre', detail: 'ran the 10K with you' },
    ],
    helped: [{ k: 'jordan', detail: 'sat with him on a call' }],
  },
  30: {
    n: 30,
    label: 'Week 30',
    sub: 'didn’t finish — back at it quietly',
    pts: '—',
    quiet: true,
    did: [],
    helpedBy: [{ k: 'sofia', detail: 'checked in twice, no pressure' }],
    helped: [],
  },
};

export const PAST_WEEKS = [32, 31, 30];

/** One cell per week since joining — not a fixed 52. */
export const YEAR_LEVELS = [
  1, 3, 2, 0, 3, 2, 3, 1, 2, 3, 0, 2, 3, 3, 1, 2, 3, 3, 1, 0, 2, 3, 3, 2, 1, 3, 0, 0, 1, 2, 3, 3, 2,
  3, 1, 3, 3,
];

export const OWED_SEED: { k: PersonKey; reason: string }[] = [
  { k: 'sofia', reason: 'kept a 5-morning streak and nobody said a word' },
  { k: 'nana', reason: 'sent you a recipe — she’d love to know it landed' },
];

export const INVITE_SUGGESTIONS: PersonKey[] = ['tomas'];

export type NotifTier = 'needs' | 'week' | 'circle';

export type Notification = {
  id: string;
  tier: NotifTier;
  kind: 'ask' | 'reply' | 'owed' | 'due' | 'streak' | 'wrap' | 'cheer' | 'finished' | 'joined';
  who?: PersonKey;
  faces?: PersonKey[];
  name?: string;
  text: string;
  time: string;
  cta?: string | null;
  sheetId?: string;
  person?: boolean;
  aging?: string | null;
  goTab?: 'week' | 'circle' | 'me';
  goWrap?: boolean;
  goPlan?: boolean;
};

export const NOTIFICATIONS: Notification[] = [
  {
    id: 'n1',
    tier: 'needs',
    kind: 'ask',
    who: 'jordan',
    text: 'is stuck on his business plan and asked the circle',
    time: '3h ago',
    cta: 'Sit with him',
    sheetId: 'f2',
  },
  {
    id: 'n2',
    tier: 'needs',
    kind: 'reply',
    who: 'maya',
    text: 'asked you a question on your portfolio task',
    time: '5h ago',
    cta: 'Reply',
    sheetId: 'm2',
  },
  {
    id: 'n3',
    tier: 'needs',
    kind: 'owed',
    who: 'sofia',
    text: 'cheered you twice — you haven’t said anything back',
    time: '',
    cta: 'Say hi',
    person: true,
    aging: '9 days',
  },
  {
    id: 'n4',
    tier: 'week',
    kind: 'due',
    name: 'Read 100 pages',
    text: 'is still open — today is the last day',
    time: 'Due today',
    cta: 'Open',
    sheetId: 'm4',
  },
  {
    id: 'n5',
    tier: 'week',
    kind: 'streak',
    name: '3-week streak',
    text: 'holds if you close two more tasks',
    time: '2 days left',
    cta: null,
    goTab: 'week',
  },
  {
    id: 'n6',
    tier: 'week',
    kind: 'wrap',
    name: 'Sunday wrap',
    text: 'is ready — see who carried you this week',
    time: 'Sunday',
    cta: 'See it',
    goWrap: true,
  },
  {
    id: 'n6b',
    tier: 'week',
    kind: 'streak',
    name: '50 pts',
    text: 'short of your best week — three days left to stake more',
    time: 'Week 33',
    cta: 'Stake it',
    goPlan: true,
  },
  {
    id: 'n7',
    tier: 'circle',
    kind: 'cheer',
    faces: ['dre', 'maya', 'nana'],
    name: 'Dre, Maya and Nana',
    text: 'cheered your run',
    time: '1d ago',
    sheetId: 'm1',
  },
  {
    id: 'n8',
    tier: 'circle',
    kind: 'finished',
    who: 'maya',
    text: 'closed all 7 of her tasks — a perfect week',
    time: '1d ago',
    sheetId: 'f1',
  },
  {
    id: 'n9',
    tier: 'circle',
    kind: 'joined',
    who: 'tomas',
    text: 'joined the circle',
    time: '3d ago',
    person: true,
  },
];

export const NOTIF_TIERS: { key: NotifTier; title: string; accent: string; blurb: string }[] = [
  {
    key: 'needs',
    title: 'NEEDS YOU',
    accent: '#C3F53C',
    blurb: 'Someone is waiting on a word from you.',
  },
  {
    key: 'week',
    title: 'YOUR WEEK',
    accent: '#191E16',
    blurb: 'Your own commitments and what’s at stake.',
  },
  {
    key: 'circle',
    title: 'YOUR CIRCLE',
    accent: '#D5E2BD',
    blurb: 'What the circle got up to. Nothing to do here.',
  },
];

/** Sort key for the friends feed: "3h" before "1d". */
export const parseHours = (t?: string) => {
  if (!t) return 999;
  return t.endsWith('d') ? parseInt(t, 10) * 24 : parseInt(t, 10);
};
