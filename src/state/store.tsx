/**
 * The whole app's state. One reducer, one provider.
 *
 * Routing between screens is the product, not an afterthought, so overlay
 * transitions are modelled as explicit actions (`GO_PLACE`, `OPEN_PLAN_WITH`)
 * that close whatever else was open rather than as independent booleans that
 * callers have to remember to reset.
 */
import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { AppState } from 'react-native';
import {
  AUDIENCES,
  Audience,
  CATEGORY_POINTS,
  Category,
  HistoryWeek,
  ME,
  Moment,
  Note,
  weekHeldStreak,
  weekLevel,
  NotifTier,
  QUICK_LOG_POINTS,
  Suggestion,
  Task,
} from '../data/fixtures';
import { DayIndex, WeekContext, liveWeek, weekAfter } from '../data/week';
import {
  AccountMode,
  Profile,
  World,
  getWorld,
  seedHistory,
  seedMoments,
  seedPeople,
  seedProfile,
  seedTasks,
  seedYearLevels,
} from '../data/seed';
import {
  People,
  PeopleIndex,
  Person,
  PersonId,
  SELF_DEMO_ID,
  indexPeople,
  makePeople,
} from '../data/people';
import { flush, load, save } from './persistence';

export type Tab = 'week' | 'circle' | 'me';
export type Scope = 'personal' | 'friends' | 'global';
export type SheetRef = { type: 'task' | 'person' | 'invite'; id: string | null } | null;
export type OnboardStep = 'join' | 'plan' | null;

/** Configuration, already modelled as props in the reference. */
export type Config = {
  showRank: boolean;
  defaultAudience: Exclude<Audience, 'private'>;
  quietComebacks: boolean;
};

export const DEFAULT_CONFIG: Config = {
  showRank: true,
  defaultAudience: 'friends',
  quietComebacks: true,
};

export type State = {
  /**
   * Which seed this account got. null while onboarding is still undecided —
   * the world is treated as fresh until you either join or skip.
   */
  account: AccountMode | null;
  /** Which of `people` is you. 'you' in demo mode, a profile id once live. */
  selfId: PersonId;
  /** Everyone this account can name, by id. Lookups go through `makePeople`. */
  people: PeopleIndex;
  /** The week this state belongs to. Compared against the clock to spot rollover. */
  week: WeekContext;
  /** Closed weeks, newest first. */
  history: HistoryWeek[];
  /** One level per week since joining, oldest first. */
  yearLevels: number[];
  /** Running totals, advanced when a week closes. */
  profile: Profile;
  /**
   * Set when the calendar has moved on but you haven't been asked yet. Nothing
   * is rewritten until you confirm — silently rebuilding someone's week on
   * launch would be the wrong instinct.
   */
  pendingRollover: { to: WeekContext } | null;
  tab: Tab;
  scope: Scope;
  day: DayIndex;
  myTasks: Task[];
  moments: Moment[];
  /** `${id}:${kind}` → true. kind: cheer | in | cosign | nod | back | share */
  acted: Record<string, true>;
  replied: Partial<Record<PersonId, true>>;
  pending: Partial<Record<PersonId, true>>;
  personNotes: Partial<Record<PersonId, Note[]>>;
  /** Your replies on public posts, which live outside your tasks and moments. */
  globalNotes: Record<string, Note[]>;
  usedSugg: Record<string, true>;

  note: string;
  draft: string;
  composerVal: string;

  draftDay: DayIndex | null;
  draftCat: Category;
  draftPair: PersonId[];
  /** null = fall back to config.defaultAudience */
  draftAud: Audience | null;
  /** Non-null when the composer is editing an existing stake rather than adding one. */
  editingId: string | null;

  planOpen: boolean;
  wrapOpen: boolean;
  wrapWeek: number | null;
  notifOpen: boolean;
  notifFilter: 'all' | NotifTier;
  /** Per-item read tracking, rather than clearing everything on first open. */
  notifRead: Record<string, true>;
  sheet: SheetRef;
  composerOpen: boolean;

  onboardStep: OnboardStep;
  seenTooltip: boolean;
  toast: string | null;
  /** Bumped on every toast so an identical message still re-animates. */
  toastSeq: number;
};

/** An account starts empty; onboarding decides what it gets seeded with. */
const initialState: State = {
  account: null,
  selfId: SELF_DEMO_ID,
  people: seedPeople(null),
  week: liveWeek(),
  history: [],
  yearLevels: [],
  profile: seedProfile(null),
  pendingRollover: null,
  tab: 'week',
  scope: 'friends',
  day: liveWeek().today,
  myTasks: [],
  moments: [],
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
  onboardStep: 'join',
  seenTooltip: false,
  toast: null,
  toastSeq: 0,
};

export type Action =
  | { type: 'SET_TAB'; tab: Tab }
  | { type: 'SET_SCOPE'; scope: Scope }
  | { type: 'TOAST'; message: string | null }
  | { type: 'TOGGLE_TASK'; id: string }
  | { type: 'ACT'; id: string; kind: string; toast?: string }
  | { type: 'OPEN_SHEET'; sheet: SheetRef }
  | { type: 'CLOSE_SHEET' }
  | { type: 'SET_NOTE'; value: string }
  | { type: 'SEND_NOTE' }
  | { type: 'SET_DRAFT'; value: string }
  | { type: 'SET_DRAFT_CAT'; cat: Category }
  | { type: 'SET_DRAFT_DAY'; day: DayIndex }
  | { type: 'SET_DRAFT_AUD'; aud: Audience }
  | { type: 'TOGGLE_PAIR'; key: PersonId }
  | { type: 'ADD_TASK'; aud: Audience }
  | { type: 'START_EDIT'; id: string }
  | { type: 'SAVE_EDIT'; aud: Audience }
  | { type: 'CANCEL_EDIT' }
  | { type: 'ADD_SUGGESTION'; suggestion: Suggestion }
  | { type: 'REMOVE_TASK'; id: string }
  | { type: 'CYCLE_TASK_AUD'; id: string }
  | { type: 'SET_COMPOSER'; open: boolean }
  | { type: 'SET_COMPOSER_VAL'; value: string }
  | { type: 'SUBMIT_COMPOSER' }
  | { type: 'OPEN_PLAN' }
  | { type: 'OPEN_PLAN_WITH'; seed: PlanSeed }
  | { type: 'CLOSE_PLAN' }
  | { type: 'GO_PLACE'; patch: Partial<State> }
  | { type: 'OPEN_WRAP'; week: number | null }
  | { type: 'CLOSE_WRAP' }
  | { type: 'OPEN_NOTIF' }
  | { type: 'CLOSE_NOTIF' }
  | { type: 'SET_NOTIF_FILTER'; filter: 'all' | NotifTier }
  | { type: 'READ_NOTIF'; id: string }
  | { type: 'READ_ALL_NOTIFS' }
  | { type: 'REPLY'; key: PersonId }
  | { type: 'INVITE'; key: PersonId }
  | { type: 'JOIN_CIRCLE' }
  | { type: 'RESET'; mode: AccountMode }
  | { type: 'ROLLOVER_DETECTED'; to: WeekContext }
  | { type: 'COMMIT_ROLLOVER'; carryIds: string[] }
  | { type: 'SKIP_ONBOARD' }
  | { type: 'FINISH_ONBOARD' }
  | { type: 'DISMISS_TOOLTIP' };

export type PlanSeed = {
  title?: string;
  cat?: Category;
  pair?: PersonId[];
  day?: DayIndex;
  toast?: string;
};

const withToast = (s: State, message?: string): State =>
  message ? { ...s, toast: message, toastSeq: s.toastSeq + 1 } : s;

/** Everything an overlay-to-overlay route has to clear. */
const CLEARED = {
  sheet: null,
  note: '',
  wrapOpen: false,
  wrapWeek: null,
  notifOpen: false,
  planOpen: false,
} satisfies Partial<State>;

/** Fields reset when an edit session is abandoned rather than saved. */
const ABANDON_EDIT = {
  editingId: null,
  draft: '',
  draftPair: [],
  draftAud: null,
  draftDay: null,
} satisfies Partial<State>;

let taskSeq = 0;
const nextTaskId = () => `m${Date.now()}-${taskSeq++}`;

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_TAB':
      return { ...state, tab: action.tab };

    case 'SET_SCOPE':
      return { ...state, scope: action.scope };

    case 'TOAST':
      return action.message === null
        ? { ...state, toast: null }
        : withToast(state, action.message);

    case 'TOGGLE_TASK': {
      const myTasks = state.myTasks.map((t) =>
        t.id === action.id ? { ...t, done: !t.done } : t,
      );
      const next = { ...state, myTasks };
      const allDone = myTasks.length > 0 && myTasks.every((t) => t.done);
      const wasAllDone = state.myTasks.length > 0 && state.myTasks.every((t) => t.done);
      return allDone && !wasAllDone ? withToast(next, 'That’s the whole week. Tell the circle.') : next;
    }

    case 'ACT': {
      const key = `${action.id}:${action.kind}`;
      // A second tap un-cheers. Only cheers toggle; the rest are one-way.
      if (action.kind === 'cheer' && state.acted[key]) {
        const acted = { ...state.acted };
        delete acted[key];
        return withToast({ ...state, acted }, 'Cheer taken back');
      }
      if (state.acted[key]) return state;
      return withToast({ ...state, acted: { ...state.acted, [key]: true } }, action.toast);
    }

    case 'OPEN_SHEET':
      return { ...state, sheet: action.sheet, note: '' };

    case 'CLOSE_SHEET':
      return { ...state, sheet: null, note: '' };

    case 'SET_NOTE':
      return { ...state, note: action.value };

    case 'SEND_NOTE': {
      const t = state.note.trim();
      const sh = state.sheet;
      if (!t || !sh || !sh.id) return state;
      const people = makePeople(state.people, state.selfId);
      const mine: Note = { w: people.name(state.selfId), k: state.selfId, t };

      if (sh.type === 'person') {
        const k = sh.id;
        return withToast(
          {
            ...state,
            note: '',
            personNotes: { ...state.personNotes, [k]: [...(state.personNotes[k] ?? []), mine] },
          },
          `${people.first(k)} will see that`,
        );
      }

      if (sh.type !== 'task') return state;

      const onTask = state.myTasks.some((x) => x.id === sh.id);
      const onMoment = state.moments.some((x) => x.id === sh.id);

      // Neither means it's a public post. Without this the note was silently
      // dropped — the field cleared and nothing landed.
      if (!onTask && !onMoment) {
        return {
          ...state,
          note: '',
          globalNotes: {
            ...state.globalNotes,
            [sh.id]: [...(state.globalNotes[sh.id] ?? []), mine],
          },
        };
      }

      return {
        ...state,
        note: '',
        myTasks: onTask
          ? state.myTasks.map((x) => (x.id === sh.id ? { ...x, cmts: [...x.cmts, mine] } : x))
          : state.myTasks,
        moments: onMoment
          ? state.moments.map((x) =>
              x.id === sh.id ? { ...x, cmts: [...(x.cmts ?? []), mine] } : x,
            )
          : state.moments,
      };
    }

    case 'SET_DRAFT':
      return { ...state, draft: action.value };

    case 'SET_DRAFT_CAT':
      return { ...state, draftCat: action.cat };

    case 'SET_DRAFT_DAY':
      return { ...state, draftDay: action.day };

    case 'SET_DRAFT_AUD':
      return { ...state, draftAud: action.aud };

    case 'TOGGLE_PAIR':
      return {
        ...state,
        draftPair: state.draftPair.includes(action.key)
          ? state.draftPair.filter((x) => x !== action.key)
          : [...state.draftPair, action.key],
      };

    case 'ADD_TASK': {
      const title = state.draft.trim();
      if (!title) return state;
      const pts = CATEGORY_POINTS[state.draftCat] ?? 30;
      const task: Task = {
        id: nextTaskId(),
        day: state.draftDay ?? state.day,
        title,
        cat: state.draftCat,
        pts,
        done: false,
        aud: action.aud,
        pair: [...state.draftPair],
        pairKind: state.draftPair.length ? 'loose' : null,
        cmts: [],
        source: 'staked',
      };
      return withToast(
        { ...state, draft: '', draftPair: [], draftAud: null, myTasks: [...state.myTasks, task] },
        `+${pts} on the line`,
      );
    }

    case 'START_EDIT': {
      const t = state.myTasks.find((x) => x.id === action.id);
      if (!t) return state;
      // Load the stake back into the composer, and route to Plan to edit it there.
      return {
        ...state,
        ...CLEARED,
        planOpen: true,
        editingId: t.id,
        draft: t.title,
        draftCat: t.cat,
        draftDay: t.day,
        draftPair: [...t.pair],
        draftAud: t.aud,
      };
    }

    case 'SAVE_EDIT': {
      const title = state.draft.trim();
      if (!title || !state.editingId) return state;
      const pts = CATEGORY_POINTS[state.draftCat] ?? 30;
      return withToast(
        {
          ...state,
          myTasks: state.myTasks.map((t) =>
            t.id !== state.editingId
              ? t
              : {
                  ...t,
                  title,
                  cat: state.draftCat,
                  pts,
                  day: state.draftDay ?? t.day,
                  aud: action.aud,
                  pair: [...state.draftPair],
                  pairKind: state.draftPair.length ? (t.pairKind ?? 'loose') : null,
                },
          ),
          editingId: null,
          draft: '',
          draftPair: [],
          draftAud: null,
          draftDay: null,
        },
        'Updated — still on the line',
      );
    }

    case 'CANCEL_EDIT':
      return {
        ...state,
        editingId: null,
        draft: '',
        draftPair: [],
        draftAud: null,
        draftDay: null,
      };

    case 'ADD_SUGGESTION': {
      const s = action.suggestion;
      if (state.usedSugg[s.id]) return state;
      const task: Task = {
        id: nextTaskId(),
        day: state.draftDay ?? state.day,
        title: s.title,
        cat: s.cat,
        pts: s.pts,
        done: false,
        aud: 'friends',
        pair: s.pair ?? [],
        pairKind: (s.pair ?? []).length ? 'loose' : null,
        cmts: [],
        source: 'staked',
        fromSuggestion: s.id,
      };
      return withToast(
        {
          ...state,
          usedSugg: { ...state.usedSugg, [s.id]: true },
          myTasks: [...state.myTasks, task],
        },
        `+${s.pts} on the line`,
      );
    }

    case 'REMOVE_TASK': {
      const removed = state.myTasks.find((t) => t.id === action.id);
      // If it came off a suggestion card, hand that card back rather than
      // leaving it stuck on "Staked ✓" with nothing behind it.
      const usedSugg = { ...state.usedSugg };
      if (removed?.fromSuggestion) delete usedSugg[removed.fromSuggestion];
      return withToast(
        {
          ...state,
          usedSugg,
          myTasks: state.myTasks.filter((t) => t.id !== action.id),
          ...(state.editingId === action.id ? ABANDON_EDIT : null),
        },
        'Unstaked — off the line',
      );
    }

    case 'CYCLE_TASK_AUD':
      return {
        ...state,
        myTasks: state.myTasks.map((t) =>
          t.id === action.id
            ? { ...t, aud: AUDIENCES[(AUDIENCES.indexOf(t.aud) + 1) % AUDIENCES.length] }
            : t,
        ),
      };

    case 'SET_COMPOSER':
      return { ...state, composerOpen: action.open, composerVal: '' };

    case 'SET_COMPOSER_VAL':
      return { ...state, composerVal: action.value };

    case 'SUBMIT_COMPOSER': {
      const title = state.composerVal.trim();
      if (!title) return state;
      const task: Task = {
        id: nextTaskId(),
        day: state.day,
        title,
        cat: 'Quick log',
        pts: QUICK_LOG_POINTS,
        done: false,
        aud: 'friends',
        pair: [],
        pairKind: null,
        cmts: [],
        source: 'quicklog',
      };
      return withToast(
        { ...state, composerVal: '', composerOpen: false, myTasks: [...state.myTasks, task] },
        'Logged to your week',
      );
    }

    case 'OPEN_PLAN':
      return { ...state, planOpen: true };

    case 'OPEN_PLAN_WITH': {
      const s = action.seed;
      return withToast(
        {
          ...state,
          ...CLEARED,
          planOpen: true,
          editingId: null,
          draft: s.title ?? '',
          draftCat: s.cat ?? state.draftCat,
          draftPair: s.pair ?? [],
          draftDay: s.day ?? state.day,
        },
        s.toast,
      );
    }

    case 'CLOSE_PLAN':
      return { ...state, planOpen: false, ...(state.editingId ? ABANDON_EDIT : null) };

    case 'GO_PLACE':
      return { ...state, ...CLEARED, ...(state.editingId ? ABANDON_EDIT : null), ...action.patch };

    case 'OPEN_WRAP':
      return { ...state, ...CLEARED, wrapOpen: true, wrapWeek: action.week };

    case 'CLOSE_WRAP':
      return { ...state, wrapOpen: false, wrapWeek: null };

    case 'OPEN_NOTIF':
      return { ...state, notifOpen: true };

    case 'CLOSE_NOTIF':
      return { ...state, notifOpen: false };

    case 'SET_NOTIF_FILTER':
      return { ...state, notifFilter: action.filter };

    case 'READ_NOTIF':
      return { ...state, notifRead: { ...state.notifRead, [action.id]: true } };

    case 'READ_ALL_NOTIFS':
      return {
        ...state,
        notifRead: getWorld(state.account).notifications.reduce<Record<string, true>>((acc, n) => {
          acc[n.id] = true;
          return acc;
        }, { ...state.notifRead }),
      };

    case 'REPLY':
      return { ...state, replied: { ...state.replied, [action.key]: true } };

    case 'INVITE':
      return withToast(
        { ...state, pending: { ...state.pending, [action.key]: true } },
        `Invited ${makePeople(state.people, state.selfId).first(action.key)}`,
      );

    case 'JOIN_CIRCLE':
      // Joining is what grants you the circle, its history and the demo week.
      return {
        ...state,
        account: 'seeded',
        selfId: SELF_DEMO_ID,
        people: seedPeople('seeded'),
        myTasks: seedTasks('seeded'),
        moments: seedMoments('seeded'),
        history: seedHistory('seeded', state.week),
        yearLevels: seedYearLevels('seeded'),
        profile: seedProfile('seeded'),
        onboardStep: 'plan',
      };

    case 'SKIP_ONBOARD': {
      // Declining the invite leaves you with a genuinely empty account.
      const mode = state.account ?? 'fresh';
      return {
        ...state,
        account: mode,
        profile: state.account ? state.profile : seedProfile(mode),
        onboardStep: null,
      };
    }

    case 'RESET': {
      const week = liveWeek();
      return {
        ...initialState,
        week,
        day: week.today,
        account: action.mode,
        selfId: SELF_DEMO_ID,
        people: seedPeople(action.mode),
        myTasks: seedTasks(action.mode),
        moments: seedMoments(action.mode),
        history: seedHistory(action.mode, week),
        yearLevels: seedYearLevels(action.mode),
        profile: seedProfile(action.mode),
        onboardStep: null,
        tab: 'week',
        scope: action.mode === 'seeded' ? 'friends' : 'personal',
      };
    }

    case 'ROLLOVER_DETECTED':
      // Only ask once, and never while onboarding is still on screen.
      if (state.pendingRollover || state.onboardStep) return state;
      if (action.to.number === state.week.number) return state;
      return { ...state, ...CLEARED, pendingRollover: { to: action.to } };

    case 'COMMIT_ROLLOVER': {
      const to = state.pendingRollover?.to;
      if (!to) return state;

      const closed = state.myTasks;
      const done = closed.filter((t) => t.done);
      const points = done.reduce((a, t) => a + t.pts, 0);
      const perfect = closed.length > 0 && done.length === closed.length;

      const record: HistoryWeek = {
        n: state.week.number,
        label: state.week.label,
        sub: closed.length ? `${done.length} of ${closed.length} done` : 'nothing staked',
        points,
        done: done.length,
        total: closed.length,
        quiet: done.length === 0,
        did: done.map((t) => ({ title: t.title, points: t.pts })),
        helpedBy: [],
        helped: [],
      };

      const held = weekHeldStreak(done.length);
      const currentStreak = held ? state.profile.currentStreak + 1 : 0;

      const carried = state.myTasks
        .filter((t) => action.carryIds.includes(t.id))
        .map((t) => ({ ...t, done: false, cmts: [] }));

      return {
        ...state,
        week: to,
        day: to.today,
        pendingRollover: null,
        history: [record, ...state.history],
        yearLevels: [...state.yearLevels, weekLevel(done.length, closed.length)],
        profile: {
          ...state.profile,
          allTimePoints: state.profile.allTimePoints + points,
          weeksIn: state.profile.weeksIn + 1,
          bestWeekPoints: Math.max(state.profile.bestWeekPoints, points),
          bestWeekLabel:
            points > state.profile.bestWeekPoints
              ? `Wk ${state.week.number}`
              : state.profile.bestWeekLabel,
          longestStreak: Math.max(state.profile.longestStreak, currentStreak),
          mostTasksClosed: Math.max(state.profile.mostTasksClosed, done.length),
          perfectWeeks: state.profile.perfectWeeks + (perfect ? 1 : 0),
          currentStreak,
        },
        // Week-scoped. Everything else — who you are, what you've said to
        // people, your replies on public posts — carries forward.
        myTasks: carried,
        acted: {},
        notifRead: {},
        usedSugg: {},
        replied: {},
        ...CLEARED,
      };
    }

    case 'FINISH_ONBOARD':
      return { ...state, onboardStep: null, tab: 'week', scope: 'personal' };

    case 'DISMISS_TOOLTIP':
      return { ...state, seenTooltip: true };

    default:
      return state;
  }
}

/**
 * Restore, and fill in what an older payload cannot have had.
 *
 * A spread only copies keys that are *present*, so a payload written before the
 * directory existed would leave `people` and `selfId` missing and render the
 * whole circle as "Someone". Both are derivable from `account`, which has
 * always been on disk. This is also the seam live-mode hydration hangs off.
 */
export function hydrate(restored?: Partial<State> | null): State {
  const s = restored ? { ...initialState, ...restored } : initialState;
  return {
    ...s,
    // In a demo account there is exactly one legitimate self, so `selfId` is
    // not restored — it is asserted. Honouring whatever was on disk would let
    // an edited payload point self at Maya, which hands her your live week in
    // the ranking, highlights her row as you, and authors your notes under her
    // name. Only a live account has an identity worth restoring, and that one
    // will come from the session rather than from disk.
    selfId: s.account === 'live' ? (restored?.selfId ?? SELF_DEMO_ID) : SELF_DEMO_ID,
    // Rebuilt rather than taken as-is: a directory off disk came through
    // JSON.parse and so carries Object.prototype, where a lookup for an id
    // like `toString` returns the inherited function instead of missing.
    // indexPeople gives it a null prototype again.
    people: restored?.people
      ? indexPeople(Object.values(restored.people).filter((p): p is Person => !!p))
      : seedPeople(s.account),
  };
}

type Store = {
  state: State;
  dispatch: React.Dispatch<Action>;
  config: Config;
  /** What this account has: circle, history, suggestions, profile numbers. */
  world: World;
  /** Names, initials, tints and trends — total, for any id at all. */
  people: People;
  /** Resolved audience for the composer: the draft choice, or the configured default. */
  effectiveAudience: Audience;
};

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({
  children,
  config = DEFAULT_CONFIG,
  restored,
  persist = true,
}: {
  children: React.ReactNode;
  config?: Config;
  /** State loaded from disk before first paint. */
  restored?: Partial<State> | null;
  /** Tests turn this off so no debounced writes outlive the suite. */
  persist?: boolean;
}) {
  const [state, dispatch] = useReducer(reducer, hydrate(restored));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Single-slot toast: each new message restarts the dismissal clock.
  useEffect(() => {
    if (!state.toast) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => dispatch({ type: 'TOAST', message: null }), 1700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state.toast, state.toastSeq]);

  // Persist the durable slices. `save` debounces and skips no-op writes itself.
  useEffect(() => {
    if (persist) save(state);
  }, [state, persist]);

  // Backgrounding is the last reliable moment before a force-quit. Coming back
  // is when the calendar may have moved on without us.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        if (persist) flush();
        return;
      }
      dispatch({ type: 'ROLLOVER_DETECTED', to: liveWeek() });
    });
    return () => sub.remove();
  }, [persist]);

  // …and on launch, for the much more common case of reopening days later.
  useEffect(() => {
    dispatch({ type: 'ROLLOVER_DETECTED', to: liveWeek() });
  }, []);

  const value = useMemo<Store>(
    () => ({
      state,
      dispatch,
      config,
      world: getWorld(state.account),
      people: makePeople(state.people, state.selfId),
      effectiveAudience: state.draftAud ?? config.defaultAudience,
    }),
    [state, config],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

/** Load persisted state before the first render. Used by the root entry point. */
export async function loadPersistedState(): Promise<Partial<State> | null> {
  return load();
}

/** The dev affordance behind "Simulate next week" on Me. */
export const nextWeekAfter = weekAfter;

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

export function usePeople() {
  return useStore().people;
}

export { ME };
