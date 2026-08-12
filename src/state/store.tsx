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
import { randomUUID } from 'expo-crypto';
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
  MemberStats,
  People,
  PeopleIndex,
  Person,
  PersonId,
  SELF_DEMO_ID,
  indexPeople,
  initialsFromName,
  makePeople,
} from '../data/people';
import { flush, load, save } from './persistence';
import { hasSupabaseConfig } from '../lib/supabase';
import {
  SessionState,
  ensureSession,
  onSessionChange,
  startAutoRefresh,
  stopAutoRefresh,
} from '../sync/session';
import { ackedTaskIds, clearOutbox, flushOutbox } from '../sync/outbox';
import { reconcileTasks } from '../sync/reconcile';
// The queue's key format is the engine's business, not the reducer's; it hands
// back the ids, and the type-only edge means this adds no import cycle.
// `reconcileActed` and `mergeNotes` live there for the same reason
// `reconcileTasks` lives in reconcile.ts: folding a pull is sync's judgement,
// and the reducer only has to apply the answer.
import {
  dirtyProfile,
  dirtyReactionKeys,
  dirtyTaskIds,
  mergeNotes,
  reconcileActed,
} from '../sync/engine';
import type { PulledNote } from '../sync/transport';
import type { ReactionRef } from '../sync/reactions';
import { pauseRealtime, resumeRealtime, teardownRealtime } from '../sync/realtime';
import { kickSync, useSyncEngine } from '../sync/useSyncEngine';

export type Tab = 'week' | 'circle' | 'me';
export type Scope = 'personal' | 'friends' | 'global';
export type SheetRef = { type: 'task' | 'person' | 'invite'; id: string | null } | null;
/**
 * Deliberately coarse. Onboarding is seven screens now, and all seven of them
 * are transient: which chips are lit, what you've typed, which suggestions you
 * ticked. None of that belongs in a persisted reducer, so the store knows only
 * that the flow is up and `OnboardOverlay` holds the step.
 */
export type OnboardStep = 'onboarding' | null;

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
  /**
   * The Supabase session, as the UI sees it. Never persisted: it is derived on
   * every launch from the session the auth client stores itself, so writing it
   * to our own payload would let an edited file claim a user id we never
   * signed in as. `off` in every demo mode.
   */
  session: SessionState;
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
  /** `${id}:${kind}` → true. kind: cheer | in | cosign | nod | share */
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
  toast: string | null;
  /** Bumped on every toast so an identical message still re-animates. */
  toastSeq: number;
};

/** An account starts empty; onboarding decides what it gets seeded with. */
const initialState: State = {
  account: null,
  selfId: SELF_DEMO_ID,
  session: { status: 'off' },
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
  onboardStep: 'onboarding',
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
  | { type: 'SET_ACCOUNT'; mode: AccountMode }
  | { type: 'RESET'; mode: AccountMode }
  | { type: 'ROLLOVER_DETECTED'; to: WeekContext }
  | { type: 'COMMIT_ROLLOVER'; carryIds: string[] }
  | { type: 'SKIP_ONBOARD' }
  | { type: 'FINISH_ONBOARD'; stakes: OnboardStake[]; aud: Audience; name: string }
  | { type: 'SESSION'; session: SessionState }
  | { type: 'SERVER_MERGE'; merge: ServerMerge };

/**
 * What a pull hands the reducer, already narrowed to the rows it knows how to
 * fold in. Deliberately not `sync/types`' `ServerMerge<T>`, which is one
 * table's rows plus its cursor — that is the transport shape, this is the
 * batch as the reducer sees it. Tasks join it with the outbox.
 */
export type ServerMerge = {
  people?: Person[];
  /** Your own id, once the session and your profile row have both resolved. */
  selfId?: PersonId;
  /**
   * One week of your own rows, as the server has them. Folded by
   * `reconcileTasks`, never assigned: the engine only sends these when the week
   * they answer for is still the week on screen.
   */
  tasks?: Task[];
  /**
   * Every reaction the server holds *for this user* — which is all `acted` can
   * mean. Authoritative rather than additive: a cheer taken back on another
   * phone is an absence here, and a union would leave it lit forever. What that
   * authority extends to is `reconcileActed`'s business, not this type's.
   */
  reactions?: ReactionRef[];
  /** Notes on your tasks and notes addressed to you. Append-only, keyed by id. */
  notes?: PulledNote[];
};

/**
 * One commitment carried out of onboarding. The flow's own suggestions have a
 * title, a frequency and a point value but no category and no day, so the
 * category is decided by the screen that knows which intent the suggestion came
 * from and the day is decided here — see `FINISH_ONBOARD`.
 */
export type OnboardStake = { title: string; cat: Category; pts: number };

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

/**
 * Client-minted, so a mutation is a safe replay. A row whose id the server
 * chose can only be created once; a row whose id we chose can be sent again
 * after a timeout we never saw the answer to, and the second insert collides
 * with the first instead of duplicating it.
 */
const nextTaskId = (): string => randomUUID();

/**
 * Everything an account *mode* decides, in one place. `SET_ACCOUNT` and `RESET`
 * both apply it, so the two can never drift into seeding different things —
 * which is exactly what would happen the next time a slice was added.
 *
 * `selfId` stays the demo sentinel even for 'live': the real id arrives with
 * the session, and `hydrate` explains why the placeholder is safe.
 */
const seedFor = (mode: AccountMode, week: WeekContext) =>
  ({
    account: mode,
    selfId: SELF_DEMO_ID,
    people: seedPeople(mode),
    myTasks: seedTasks(mode),
    moments: seedMoments(mode),
    history: seedHistory(mode, week),
    yearLevels: seedYearLevels(mode),
    profile: seedProfile(mode),
  }) satisfies Partial<State>;

const sameStats = (a?: MemberStats, b?: MemberStats): boolean =>
  a === b ||
  (!!a && !!b && a.done === b.done && a.total === b.total && a.streak === b.streak && a.given === b.given);

/** Field-wise, because a row off the wire is always a fresh object. */
const samePerson = (a: Person, b: Person): boolean =>
  a === b ||
  (a.name === b.name &&
    a.first === b.first &&
    a.initials === b.initials &&
    a.tint === b.tint &&
    a.trend === b.trend &&
    sameStats(a.stats, b.stats));

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
      // Client-minted, for the reason `nextTaskId` is: `notes` has no unique
      // constraint that could dedupe a replay, and cannot have one — saying the
      // same thing twice is a second note, not a mistake. The pk is the only
      // thing that makes a re-sent insert collide with itself instead of
      // appearing twice on someone's screen.
      const mine: Note = { w: people.name(state.selfId), k: state.selfId, t, id: randomUUID() };

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

    case 'SET_ACCOUNT':
      // Which world you get, said on its own. This used to be welded to
      // "joining the circle", which was fine while there were two answers; now
      // that going live is a third, the flow has to be able to say "the demo",
      // "empty" or "live" without also claiming a membership.
      //
      // Deliberately re-appliable: the front door is one back-press away from
      // every step, so choosing again has to reseed rather than leave the
      // previous choice's fixtures lying underneath the new one. That includes
      // what you'd already acted on — those ids belong to the world being left.
      return {
        ...state,
        ...seedFor(action.mode, state.week),
        acted: {},
        replied: {},
        pending: {},
        notifRead: {},
        usedSugg: {},
      };

    case 'SKIP_ONBOARD': {
      // Leaving the flow early keeps whatever account you'd already chosen —
      // and grants an empty one if you never chose. Either way you land on your
      // own week, the same place finishing properly puts you.
      const mode = state.account ?? 'fresh';
      return {
        ...state,
        account: mode,
        profile: state.account ? state.profile : seedProfile(mode),
        onboardStep: null,
        tab: 'week',
        scope: 'personal',
      };
    }

    case 'RESET': {
      // 'live' seeds nothing, and needs no branch to do it: every seed function
      // already answers empty for anything that isn't 'seeded'.
      const week = liveWeek();
      return {
        ...initialState,
        week,
        day: week.today,
        ...seedFor(action.mode, week),
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

    case 'FINISH_ONBOARD': {
      /**
       * What you staked on screen 3 becomes ordinary tasks — the same shape
       * `ADD_TASK` mints, so nothing downstream can tell where they came from.
       *
       * They all land on today. The flow never asks for a day (see
       * `StakeScreen` on why it doesn't), and its frequencies — 'every day',
       * '×3 this week' — don't name one either; today is the only answer that
       * lets a first week start the moment it's staked rather than sitting in
       * the future being notional.
       */
      const staked: Task[] = action.stakes.map((s) => ({
        id: nextTaskId(),
        day: state.day,
        title: s.title,
        cat: s.cat,
        pts: s.pts,
        done: false,
        aud: action.aud,
        pair: [],
        pairKind: null,
        cmts: [],
        source: 'staked',
      }));
      /**
       * The name goes into the people directory, which is where every screen
       * already resolves a name and initials from — and on a live account the
       * engine watches that entry and pushes it to `profiles.name`, so this is
       * also the moment the rename is queued.
       *
       * It was once written here as the literal 'You' with the typed string
       * discarded, which made the flow ask for your name and then render you as
       * "Someone" the first time a pull answered. See `profileName.test.ts`.
       */
      const named = action.name.trim();
      /**
       * Demo keeps the fixture convention — the self row is called 'You', and
       * every screen that greets you renders that. A live account cannot: this
       * string is pushed to `profiles.name`, which is what everyone *else* sees
       * beside your week, and a circle full of people called "You" is the bug
       * that convention would cause.
       */
      const selfName = state.account === 'live' ? named : 'You';
      const people = named
        ? {
            ...indexPeople(Object.values(state.people).filter((p): p is Person => !!p)),
            [state.selfId]: {
              ...(state.people[state.selfId] ?? { id: state.selfId }),
              name: selfName,
              first: named.split(/\s+/)[0] || named,
              initials: initialsFromName(named),
            },
          }
        : state.people;

      return {
        ...state,
        onboardStep: null,
        tab: 'week',
        scope: 'personal',
        myTasks: [...state.myTasks, ...staked],
        people,
      };
    }

    case 'SESSION': {
      const cur = state.session;
      const next = action.session;
      // `ensureSession()` both resolves *and* broadcasts, so a cold start
      // delivers the same session twice. Every dispatch re-renders every
      // screen, so an equal session is worth comparing rather than storing.
      const same =
        cur.status === next.status &&
        (cur as { userId?: string }).userId === (next as { userId?: string }).userId &&
        (cur as { message?: string }).message === (next as { message?: string }).message;
      if (same) return state;

      // Identity comes from the session that just authenticated, never from
      // the payload on disk. `selfId` is persisted and `isSound` can only
      // check that it is a string, so an edited file could otherwise name
      // anyone as you — and every write would then go out under an id this
      // device never proved it owned.
      const selfId = next.status === 'ready' ? next.userId : state.selfId;

      /**
       * Onboarding runs before the anonymous session has necessarily resolved,
       * and `SET_ACCOUNT` pins `selfId` to the demo sentinel until it does. So
       * a name typed in that window is filed under `'you'`, and this line used
       * to strand it: the lookup for the new uuid missed, `stranger()` answered,
       * and the app called you "Someone" without ever touching the network.
       *
       * Carried only from the sentinel. Two real ids in succession is a
       * different account, and that name belongs to whoever typed it.
       */
      let people = state.people;
      if (selfId !== state.selfId && state.selfId === SELF_DEMO_ID) {
        const carried = state.people[state.selfId];
        if (carried) {
          people = indexPeople(
            Object.values(state.people)
              .filter((p): p is Person => !!p && p.id !== state.selfId)
              .concat({ ...carried, id: selfId }),
          );
        }
      }

      return { ...state, session: next, selfId, people };
    }

    case 'SERVER_MERGE': {
      // A merge, never an assignment: rows arriving from someone else's phone
      // must not clobber what is only local yet, and must not close whatever
      // the user has open — which is why this is not routed through GO_PLACE.
      let people = state.people;
      let draft: Record<PersonId, Person> | null = null;

      // Your own row is in the answer like anyone else's, and until the queued
      // rename lands it still says whatever the signup trigger defaulted it to.
      // Merging that back would overwrite the name you just typed with
      // "Someone" — and because a merge is authoritative, it would stay.
      const selfIsDirty = dirtyProfile();

      for (const p of action.merge.people ?? []) {
        if (selfIsDirty && p.id === state.selfId) continue;
        const known = people[p.id];
        if (known && samePerson(known, p)) continue;
        // Copied once, on the first row that actually differs, and with a null
        // prototype so a lookup for an id like `toString` still misses.
        if (!draft) {
          draft = Object.assign(Object.create(null) as Record<PersonId, Person>, people);
          people = draft;
        }
        draft[p.id] = p;
      }

      // The dirty set is derived here, from the queue, and deliberately not kept
      // in state: it would be a second record of what the server still owes us,
      // and the one that decides what actually goes out is the outbox.
      let myTasks = action.merge.tasks
        ? reconcileTasks(state.myTasks, action.merge.tasks, dirtyTaskIds(), ackedTaskIds())
        : state.myTasks;

      // The same shape one slice over, and the same reason for asking the queue
      // rather than state: a cheer tapped a second ago is in `acted` and is not
      // on the server yet, so the pull that raced it answers for the moment
      // before it and must not be allowed to take it back.
      const acted = action.merge.reactions
        ? reconcileActed(state.acted, action.merge.reactions, dirtyReactionKeys())
        : state.acted;

      // Notes land where the reducer's own put them — a task's `cmts` for a
      // task note, `personNotes` for one addressed to someone — and are folded
      // into the *reconciled* tasks, not the old ones, so a row that just
      // arrived can carry its own thread in the same commit.
      let personNotes = state.personNotes;
      if (action.merge.notes?.length) {
        const directory = makePeople(people, state.selfId);
        const merged = mergeNotes({ myTasks, personNotes }, action.merge.notes, directory.name);
        myTasks = merged.myTasks;
        personNotes = merged.personNotes;
      }

      // A merge carries rows, not an identity. Whoever you are was settled by
      // the session; letting a server payload move `selfId` would reintroduce
      // exactly the substitution the SESSION branch just closed off.
      // Identity, so `useReducer` bails out of the render entirely. A poll that
      // found nothing new is the common case and must cost nothing — which is
      // why every fold above answers by identity when it changed nothing.
      if (
        people === state.people &&
        myTasks === state.myTasks &&
        acted === state.acted &&
        personNotes === state.personNotes
      ) {
        return state;
      }
      return { ...state, people, myTasks, acted, personNotes };
    }

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
    // Never off disk. It is re-derived from the auth client on every launch,
    // and a stored one would be an unauthenticated claim to a user id.
    session: { status: 'off' },
    // In a demo account there is exactly one legitimate self, so `selfId` is
    // not restored — it is asserted. Honouring whatever was on disk would let
    // an edited payload point self at Maya, which hands her your live week in
    // the ranking, highlights her row as you, and authors your notes under her
    // name. Only a live account has an identity worth restoring, and that one
    // will come from the session rather than from disk.
    // A live account with no stored selfId keeps the demo sentinel rather than
    // getting a null or an empty string, because `PersonId` is total and every
    // caller would otherwise need a new branch. It is safe as a placeholder for
    // exactly one reason: 'you' is not in the id space the server hands out —
    // profile ids are uuids — and `seedPeople('live')` is empty, so nothing in
    // the directory can match it. Until `SERVER_MERGE` supplies the real id,
    // `isSelf` answers false for every real person and `people.get('you')`
    // resolves to the visible "Someone" stranger. Nobody else is rendered as you.
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
  sync = true,
}: {
  children: React.ReactNode;
  config?: Config;
  /** State loaded from disk before first paint. */
  restored?: Partial<State> | null;
  /** Tests turn this off so no debounced writes outlive the suite. */
  persist?: boolean;
  /** Mirrors `persist`: tests turn this off so no session work outlives the suite. */
  sync?: boolean;
}) {
  const [state, dispatch] = useReducer(reducer, hydrate(restored));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * The one gate on every piece of network machinery below. `fresh` and
   * `seeded` are demo modes that must make zero network calls ever, so the
   * account check comes before anything that could touch the client — and
   * `hasSupabaseConfig()` reads env rather than constructing anything, so an
   * unconfigured build never gets as far as `getSupabase()`.
   */
  const syncOn = persist && sync && state.account === 'live' && hasSupabaseConfig();

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

  /**
   * Sign in, and keep the session slice current. Nothing here is on the path
   * between a tap and a render: it resolves whenever it resolves, and the
   * reducer has already been answering taps since the first frame.
   */
  useEffect(() => {
    if (!syncOn) return;

    // Subscribed before the call, or the transition it broadcasts on the way to
    // `ready` would land before anyone was listening.
    const unsubscribe = onSessionChange((session) => dispatch({ type: 'SESSION', session }));
    let live = true;
    void ensureSession().then((session) => {
      if (live) dispatch({ type: 'SESSION', session });
    });
    // The provider mounts with the app in front, and supabase-js only refreshes
    // while it has been told so — see startAutoRefresh's note.
    startAutoRefresh();

    return () => {
      live = false;
      unsubscribe();
      stopAutoRefresh();
    };
  }, [syncOn]);

  /**
   * Push what the reducer has already applied, and fold back what the server
   * has. Same gate as everything else, and deliberately the same expression
   * rather than a second one that could drift away from it. The engine holds no
   * React state, so nothing here re-renders on a timer.
   */
  useSyncEngine(state, dispatch, syncOn);

  // Backgrounding is the last reliable moment before a force-quit. Coming back
  // is when the calendar may have moved on without us — and, in live mode, when
  /**
   * Switching accounts throws away the queue.
   *
   * "This clears everything you've done and starts over" has to mean the work
   * the device has not managed to send yet as well. Without this, a task the
   * user staked and then erased is uploaded minutes later, because RESET empties
   * `myTasks` and turns the engine off in the same commit — so no deletes are
   * ever enqueued and the pending upserts simply outlive the wipe.
   */
  const lastAccount = useRef(state.account);
  useEffect(() => {
    if (lastAccount.current === state.account) return;
    lastAccount.current = state.account;
    void clearOutbox();
    // …and the socket, which is subscribed for an account that no longer exists.
    // `removeAllChannels` rather than an unsubscribe: this is the sign-out path,
    // so anything still open belongs to the account being left. It cannot build
    // a client to do it — see `teardownRealtime` — so a demo account that has
    // never opened a channel stays genuinely offline through this line.
    teardownRealtime();
  }, [state.account]);

  // the access token needs refreshing again before the first write 401s.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        if (persist) flush();
        if (syncOn) {
          stopAutoRefresh();
          // The queue is the record of what the server still owes us, so it has
          // to survive a force-quit exactly as the state does.
          void flushOutbox();
          // A websocket held open behind the app is a radio kept awake for
          // events nobody is on screen to see. The poll on foreground catches up
          // on all of them in one round trip, which is what makes this safe.
          pauseRealtime();
        }
        return;
      }
      if (syncOn) {
        startAutoRefresh();
        // Cleared before the kick below, which is what actually resubscribes.
        resumeRealtime();
        // Whatever was staked on the train goes now, rather than up to five
        // seconds after the user is already looking at the screen.
        kickSync();
        // A launch with no network leaves the session `offline`, and the sign-in
        // effect only runs when `syncOn` flips. Without this, sync would stay
        // silently dead until the process was restarted — the one failure mode
        // a user would never think to report.
        void ensureSession().then((session) => dispatch({ type: 'SESSION', session }));
      }
      dispatch({ type: 'ROLLOVER_DETECTED', to: liveWeek() });
    });
    return () => sub.remove();
  }, [persist, syncOn]);

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
