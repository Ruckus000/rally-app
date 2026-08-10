/**
 * The whole app's state. One reducer, one provider.
 *
 * Routing between screens is the product, not an afterthought, so overlay
 * transitions are modelled as explicit actions (`GO_PLACE`, `OPEN_PLAN_WITH`)
 * that close whatever else was open rather than as independent booleans that
 * callers have to remember to reset.
 */
import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  AUDIENCES,
  Audience,
  CATEGORY_POINTS,
  Category,
  FIRST,
  MY_TASKS,
  MOMENTS,
  ME,
  Note,
  NOTIFICATIONS,
  NotifTier,
  QUICK_LOG_POINTS,
  Suggestion,
  Task,
} from '../data/fixtures';
import { CURRENT_WEEK, DayIndex } from '../data/week';
import type { PersonKey } from '../theme/tokens';

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
  tab: Tab;
  scope: Scope;
  day: DayIndex;
  myTasks: Task[];
  moments: typeof MOMENTS;
  /** `${id}:${kind}` → true. kind: cheer | in | cosign | nod | back | share */
  acted: Record<string, true>;
  replied: Partial<Record<PersonKey, true>>;
  pending: Partial<Record<PersonKey, true>>;
  personNotes: Partial<Record<PersonKey, Note[]>>;
  usedSugg: Record<string, true>;

  note: string;
  draft: string;
  composerVal: string;

  draftDay: DayIndex | null;
  draftCat: Category;
  draftPair: PersonKey[];
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

const initialState: State = {
  tab: 'week',
  scope: 'friends',
  day: CURRENT_WEEK.today,
  myTasks: MY_TASKS,
  moments: MOMENTS,
  acted: {},
  replied: {},
  pending: {},
  personNotes: {},
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
  | { type: 'TOGGLE_PAIR'; key: PersonKey }
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
  | { type: 'REPLY'; key: PersonKey }
  | { type: 'INVITE'; key: PersonKey }
  | { type: 'JOIN_CIRCLE' }
  | { type: 'SKIP_ONBOARD' }
  | { type: 'FINISH_ONBOARD' }
  | { type: 'DISMISS_TOOLTIP' };

export type PlanSeed = {
  title?: string;
  cat?: Category;
  pair?: PersonKey[];
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
      if (!t || !sh) return state;
      const mine: Note = { w: 'You', k: 'you', t };
      if (sh.type === 'task') {
        return {
          ...state,
          note: '',
          myTasks: state.myTasks.map((x) =>
            x.id === sh.id ? { ...x, cmts: [...x.cmts, mine] } : x,
          ),
          moments: state.moments.map((x) =>
            x.id === sh.id ? { ...x, cmts: [...(x.cmts ?? []), mine] } : x,
          ),
        };
      }
      if (sh.type === 'person' && sh.id) {
        const k = sh.id as PersonKey;
        return withToast(
          {
            ...state,
            note: '',
            personNotes: { ...state.personNotes, [k]: [...(state.personNotes[k] ?? []), mine] },
          },
          `${k === 'you' ? 'You' : FIRST_NAME(k)} will see that`,
        );
      }
      return state;
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
        notifRead: NOTIFICATIONS.reduce<Record<string, true>>((acc, n) => {
          acc[n.id] = true;
          return acc;
        }, { ...state.notifRead }),
      };

    case 'REPLY':
      return { ...state, replied: { ...state.replied, [action.key]: true } };

    case 'INVITE':
      return withToast(
        { ...state, pending: { ...state.pending, [action.key]: true } },
        `Invited ${FIRST_NAME(action.key)}`,
      );

    case 'JOIN_CIRCLE':
      return { ...state, onboardStep: 'plan' };

    case 'SKIP_ONBOARD':
      return { ...state, onboardStep: null };

    case 'FINISH_ONBOARD':
      return { ...state, onboardStep: null, tab: 'week', scope: 'personal' };

    case 'DISMISS_TOOLTIP':
      return { ...state, seenTooltip: true };

    default:
      return state;
  }
}

const FIRST_NAME = (k: PersonKey) => FIRST[k];

type Store = {
  state: State;
  dispatch: React.Dispatch<Action>;
  config: Config;
  /** Resolved audience for the composer: the draft choice, or the configured default. */
  effectiveAudience: Audience;
};

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({
  children,
  config = DEFAULT_CONFIG,
}: {
  children: React.ReactNode;
  config?: Config;
}) {
  const [state, dispatch] = useReducer(reducer, initialState);
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

  const value = useMemo<Store>(
    () => ({
      state,
      dispatch,
      config,
      effectiveAudience: state.draftAud ?? config.defaultAudience,
    }),
    [state, config],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

export { ME };
