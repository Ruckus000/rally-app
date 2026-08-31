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
  Notification,
  weekLevel,
  weekSummary,
  NotifTier,
  QUICK_LOG_POINTS,
  Suggestion,
  Task,
  TaskMedia,
} from '../data/fixtures';
import { DayIndex, WeekContext, liveWeek, weekAfter } from '../data/week';
import {
  AccountMode,
  Profile,
  DemoContent,
  demoContent,
  seedHistory,
  seedGlobalPosts,
  seedNotifications,
  seedMoments,
  seedPeople,
  seedProfile,
  seedTasks,
  seedYearLevels,
} from '../data/seed';
import {
  AvatarState,
  MemberStats,
  NAME_MAX,
  People,
  PeopleIndex,
  Person,
  PersonId,
  SELF_DEMO_ID,
  indexPeople,
  initialsFromName,
  makePeople,
  personOf,
  withFixtureTints,
} from '../data/people';
import { aggregatesFrom, closingWeek, stakedPoints } from './selectors';
import { useWeekReminder } from '../lib/reminders';
import { flush, load, save } from './persistence';
import { hasSupabaseConfig } from '../lib/supabase';
import {
  SessionState,
  ensureSession,
  onSessionChange,
  startAutoRefresh,
  stopAutoRefresh,
} from '../sync/session';
import {
  ackedTaskIds,
  clearOutbox,
  flushOutbox,
  onOutboxChange,
  unsavedCount,
} from '../sync/outbox';
import { reconcileMedia, reconcileTasks } from '../sync/reconcile';
// The queue's key format is the engine's business, not the reducer's; it hands
// back the ids, and the type-only edge means this adds no import cycle.
// `reconcileActed` and `mergeNotes` live there for the same reason
// `reconcileTasks` lives in reconcile.ts: folding a pull is sync's judgement,
// and the reducer only has to apply the answer.
import {
  dirtyMediaTaskIds,
  dirtyProfile,
  dirtyReactionKeys,
  dirtyTaskIds,
  mergeNotes,
  reconcileActed,
} from '../sync/engine';
import type { PulledNote, ReportSubject } from '../sync/transport';
import type { ReactionRef } from '../sync/reactions';
import { pauseRealtime, resumeRealtime, teardownRealtime } from '../sync/realtime';
import { kickSync, useSyncEngine } from '../sync/useSyncEngine';

export type Tab = 'week' | 'circle' | 'me';
/**
 * Two, not three. Friends and Global were the same renderer over the same type,
 * sorted the same way — what separated them was a tab. They are one list now,
 * and a card says which half it came from.
 */
export type Scope = 'personal' | 'feed';
export type SheetRef = { type: 'task' | 'person' | 'invite'; id: string | null } | null;
/**
 * What the report sheet is open against.
 *
 * Deliberately **not** folded into `SheetRef`. The two look alike — both are a
 * kind plus an id — and they are not the same question. `SheetRef` names a
 * screen to render; this names a *subject* to file a report about, and its
 * `kind` values are the migration's `reports_kind_known` constraint, not a list
 * of sheets. Merging them would mean `OPEN_SHEET` could open a report and
 * `CLOSE_SHEET` could close one, and the report sheet has to be able to sit
 * above an open detail sheet without replacing it.
 *
 * `who` is the person the content belongs to, carried because the block step
 * needs it and a note does not otherwise say who wrote it by id.
 */
export type ReportTarget = { kind: ReportSubject; id: string; who: PersonId };
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

/**
 * The circle you are in, as the two screens that name it need it: the Me
 * screen's subtitle, and the invite sheet's code. Not the whole row — nothing
 * renders `created_at`, and a shape that carried it would invite someone to.
 */
export type CircleRef = { id: string; name: string; inviteCode: string };

/**
 * `circles_name_length` in the schema, mirrored once for the two fields that
 * can reach it — onboarding's circle step and the invite sheet's. A field that
 * overran it would be a 23514 the user could do nothing about.
 */
export const CIRCLE_NAME_MAX = 80;

export type State = {
  /**
   * Which seed this account got. null while onboarding is still undecided —
   * the world is treated as fresh until you either join or skip.
   */
  account: AccountMode | null;
  /**
   * When this account asked to be deleted, as the server's ISO timestamp, or
   * null. Persisted, and it is the *only* thing that survives the wipe a
   * scheduled deletion performs — which makes it the thing the Welcome screen
   * reads to decide whether to offer a way back. Deliberately not derived from
   * the session left on disk: a session is present after an ordinary sign-out
   * too, and offering to un-delete an account nobody asked to delete would be
   * a worse bug than not offering at all.
   */
  deletionAt: string | null;
  /** Which of `people` is you. 'you' in demo mode, a profile id once live. */
  selfId: PersonId;
  /**
   * The Supabase session, as the UI sees it. Never persisted: it is derived on
   * every launch from the session the auth client stores itself, so writing it
   * to our own payload would let an edited file claim a user id we never
   * signed in as. `off` in every demo mode.
   */
  session: SessionState;
  /**
   * How many distinct things the server has permanently refused.
   *
   * Never persisted, for the same reason `session` is not: it is derived from
   * the outbox, which keeps its own record in its own envelope, and a second
   * copy on disk could only ever disagree with the first.
   */
  unsaved: number;
  /** Everyone this account can name, by id. Lookups go through `makePeople`. */
  people: PeopleIndex;
  /**
   * The circle this account is in, on a live account, or null. Deliberately
   * *not* persisted: it is entirely server-derived and refetched on launch and
   * on foreground, so persisting it would buy a soundness validator and a
   * version question in exchange for one pull's worth of latency on a surface
   * you could not use offline anyway.
   *
   * One circle, not many. The schema allows several; every screen in this app
   * has always assumed one, and inventing a picker for a case no user has is
   * work for nobody.
   */
  circle: CircleRef | null;
  /**
   * How many times the world under this session has been reseeded.
   *
   * `SET_ACCOUNT` and `RESET` empty every slice the server owns, and choosing
   * `live` while already live changes nothing else about the state — same
   * account, and (since the session's id is kept) same `selfId`. So there is
   * no other way for the sync engine to tell "the world was replaced" from
   * "the user deleted all of it", and those two need opposite answers: the
   * first must be adopted, the second sent. Read by `observe`, and by nothing
   * that renders.
   *
   * Not persisted. It is a within-process signal between the reducer and the
   * engine, and a launch builds both of them fresh.
   */
  worldEpoch: number;
  /**
   * Whether a pull has answered yet, this launch, for this world.
   *
   * `circle` is `null` for two different reasons — "you are in none" and "we
   * have not asked yet" — and it is not persisted, so every cold start begins
   * in the second one. Anything that treats `null` as the first answer is
   * wrong for as long as the first pull takes: the invite sheet offered to
   * *start* a circle to people who were already in one, which is one tap away
   * from a duplicate nobody meant to make.
   *
   * Not persisted, for the same reason `circle` is not: it describes what this
   * process has been told, and a launch has been told nothing.
   */
  worldSeen: boolean;
  /**
   * Your notification feed on a live account. Persisted, unlike `circle` — the
   * argument that covers the circle sheet does not survive contact with the
   * bell. An empty circle sheet for one pull is a screen you opened knowing it
   * had to load; an empty bell is an *answer*, and "Nothing needs you" is a
   * confident one to give someone who has three cheers waiting. Restored rows
   * are replaced wholesale by the next pull, so being a beat stale costs a
   * `time` that reads a beat old.
   *
   * The demo's are seeded into this same slice, so nothing has to choose. They
   * used to live on the world object, which handed a live account an empty one
   * — the bell was silent for every real user, and "mark all read" marked
   * nothing.
   */
  notifications: Notification[];
  /**
   * The Global feed: the Oz bots' weeks, as ordinary rows.
   *
   * Arranged exactly like `moments` — seeded from a fixture for the demo modes,
   * replaced wholesale by the server for a live account — because it is the
   * same question about a different set of owners. Persisted for the reason the
   * notification feed is: this is the tab a new account lands on, and it exists
   * to have something in it.
   */
  globalPosts: Moment[];
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
  /**
   * What the draft is worth right now — and the only place that number lives.
   *
   * Both `ADD_TASK` and `SAVE_EDIT` used to recompute the price from the
   * category, which was safe while the price *was* the category. Once a model
   * reads the goal, recomputing means the button can promise one number and the
   * reducer stake another. So the composer writes what it is showing here, and
   * the reducer stakes exactly this.
   */
  draftPts: number;
  /** 'blocked' when the draft is something this app will not put points on. */
  draftVerdict: 'ok' | 'blocked';
  /**
   * Why it was blocked, and it lives here rather than in the composer's hook
   * for one reason: a refusal and its explanation have to move together. Held
   * apart — the verdict in the store, the sentence in a hook scoped to the
   * exact title that produced it — they drift out of step the moment someone
   * keeps typing, and the screen becomes a disabled button with nothing next
   * to it. A block with no reason is a dead end.
   */
  draftReason: string;
  draftPair: PersonId[];
  /** null = fall back to config.defaultAudience */
  draftAud: Audience | null;
  /** Non-null when the composer is editing an existing stake rather than adding one. */
  editingId: string | null;

  planOpen: boolean;
  /**
   * Account settings. An overlay like the others, and like the others it is a
   * fact about this session rather than about the account — so it is not in
   * `PERSISTED_KEYS` and reopening the app never lands you inside it.
   */
  settingsOpen: boolean;
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

  /**
   * Who this account has blocked, by id. The server already hides a blocked
   * person's rows via RLS — see `integration/rls/blocks.test.ts` — so this list
   * exists for the gap RLS cannot cover: the moment between the tap and the
   * next round trip, where a phone with no signal has to look like the block
   * already happened. `BLOCKS_PULLED` replaces it wholesale on the next pull,
   * so the server stays the authority the instant it can answer; this is only
   * ever the offline half.
   *
   * Persisted, so a block survives a relaunch offline — see
   * `PERSISTED_KEYS` in persistence.ts.
   */
  blocked: PersonId[];

  /**
   * The report sheet's subject, or null when it is closed. Session state like
   * every other overlay flag, so it is not persisted — reopening the app never
   * lands you inside a half-filed report.
   */
  reportTarget: ReportTarget | null;

  /**
   * Subject ids this account has reported, and therefore hides.
   *
   * Unlike `blocked`, this is **not** the offline half of something the server
   * also enforces. Filing a report changes nothing the server will show you:
   * `reports` is a write-only record and there is no moderation queue draining
   * it. So this list is the *entire* mechanism behind "it's hidden from you" —
   * which is why it is persisted (see `PERSISTED_KEYS`). If it evaporated on
   * relaunch the content would come back, and the sheet would have lied.
   */
  reported: string[];
};

/** An account starts empty; onboarding decides what it gets seeded with. */
const initialState: State = {
  account: null,
  deletionAt: null,
  selfId: SELF_DEMO_ID,
  circle: null,
  worldEpoch: 0,
  worldSeen: false,
  notifications: seedNotifications(null),
  globalPosts: seedGlobalPosts(null),
  session: { status: 'off' },
  unsaved: 0,
  people: seedPeople(null),
  week: liveWeek(),
  history: [],
  yearLevels: [],
  profile: seedProfile(null),
  pendingRollover: null,
  tab: 'week',
  /**
   * The feed, not Personal. A brand-new account has staked nothing, and its own
   * week opens on an empty state — the first screen after signing in should
   * have something in it, and the feed always does. `scope` is persisted, so
   * this is the first launch only; whatever tab you last chose is the one you
   * come back to.
   */
  scope: 'feed',
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
  draftPts: CATEGORY_POINTS.Fitness,
  draftVerdict: 'ok',
  draftReason: '',
  draftPair: [],
  draftAud: null,
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
  onboardStep: 'onboarding',
  toast: null,
  toastSeq: 0,
  blocked: [],
  reportTarget: null,
  reported: [],
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
  | { type: 'SET_DRAFT_RATING'; points: number; verdict: 'ok' | 'blocked'; reason: string }
  | { type: 'SET_DRAFT_DAY'; day: DayIndex }
  | { type: 'SET_DRAFT_AUD'; aud: Audience }
  | { type: 'TOGGLE_PAIR'; key: PersonId }
  | { type: 'ADD_TASK'; aud: Audience }
  | { type: 'START_EDIT'; id: string }
  | { type: 'SAVE_EDIT'; aud: Audience }
  | { type: 'CANCEL_EDIT' }
  | { type: 'ADD_SUGGESTION'; suggestion: Suggestion }
  | { type: 'REMOVE_TASK'; id: string }
  | { type: 'ATTACH_MEDIA'; id: string; media: TaskMedia }
  | { type: 'REMOVE_MEDIA'; id: string }
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
  | { type: 'OPEN_SETTINGS' }
  | { type: 'CLOSE_SETTINGS' }
  | { type: 'SET_NOTIF_FILTER'; filter: 'all' | NotifTier }
  | { type: 'READ_NOTIF'; id: string }
  | { type: 'READ_ALL_NOTIFS' }
  | { type: 'REPLY'; key: PersonId }
  | { type: 'INVITE'; key: PersonId }
  | { type: 'SET_ACCOUNT'; mode: AccountMode }
  | { type: 'RESET'; mode: AccountMode }
  | { type: 'SIGN_OUT' }
  | { type: 'DELETION_SCHEDULED'; at: string }
  | { type: 'DELETION_CANCELLED' }
  | { type: 'ROLLOVER_DETECTED'; to: WeekContext }
  | { type: 'COMMIT_ROLLOVER'; carryIds: string[] }
  | { type: 'SKIP_ONBOARD' }
  | { type: 'FINISH_ONBOARD'; stakes: OnboardStake[]; aud: Audience; name: string }
  | { type: 'RENAME_SELF'; name: string }
  | { type: 'SESSION'; session: SessionState }
  | { type: 'UNSAVED'; count: number }
  | { type: 'SERVER_MERGE'; merge: ServerMerge }
  | { type: 'BLOCK'; id: PersonId }
  | { type: 'UNBLOCK'; id: PersonId }
  | { type: 'BLOCKS_PULLED'; ids: PersonId[] }
  /**
   * Your own avatar just moved, as reported by `lib/avatarUpload`, which is the
   * only thing on this device that can know before the next pull does. No
   * outbox op: the server has already been told (`set_avatar` is an RPC), and
   * this is the local copy catching up so that Settings stops offering to add a
   * photo that is already there — and, more sharply, so that a replace made
   * seconds later hands `previousPath` the object that is actually current
   * rather than the one from a minute ago, which is how objects get orphaned in
   * a bucket every signed-in account can read.
   */
  | { type: 'SET_AVATAR'; path: string | null; state: AvatarState }
  | { type: 'OPEN_REPORT'; target: ReportTarget }
  | { type: 'CLOSE_REPORT' }
  | { type: 'REPORT_FILED'; id: string };

/**
 * What a pull hands the reducer, already narrowed to the rows it knows how to
 * fold in. Deliberately not `sync/types`' `ServerMerge<T>`, which is one
 * table's rows plus its cursor — that is the transport shape, this is the
 * batch as the reducer sees it. Tasks join it with the outbox.
 */
export type ServerMerge = {
  /**
   * The whole live directory — the people you share a circle with and the bots,
   * in one payload. Authoritative for the set: an id it does not name is an id
   * this account can no longer reach, and `[]` is a real answer meaning nobody
   * but you. The engine sets it on every pull that came back, and on none that
   * didn't, so its absence is the only thing that means "no answer".
   */
  people?: Person[];
  /**
   * The circle you are in, or `null` for "you are in none" — which is a real
   * answer and not the absence of one, so the engine only sets the key when the
   * value actually moved.
   */
  circle?: CircleRef | null;
  /** Your own id, once the session and your profile row have both resolved. */
  selfId?: PersonId;
  /**
   * One week of your own rows, as the server has them. Folded by
   * `reconcileTasks`, never assigned: the engine only sends these when the week
   * they answer for is still the week on screen.
   */
  tasks?: Task[];
  /**
   * The photos on your own goals, by goal id — a **map**, not a list, and null
   * rather than absent when the pull could not answer.
   *
   * Its own key rather than riding on `tasks` because it answers a different
   * question over a different table, and because the two arrive on different
   * beats: a photo lands on a goal whose row synced minutes earlier, so the
   * task diff is the identity case exactly when the photo is news. Folded by
   * `reconcileMedia`.
   */
  media?: ReadonlyMap<string, TaskMedia> | null;
  /**
   * Every reaction the server holds *for this user* — which is all `acted` can
   * mean. Authoritative rather than additive: a cheer taken back on another
   * phone is an absence here, and a union would leave it lit forever. What that
   * authority extends to is `reconcileActed`'s business, not this type's.
   */
  reactions?: ReactionRef[];
  /** Notes on your tasks and notes addressed to you. Append-only, keyed by id. */
  notes?: PulledNote[];
  /**
   * How many cheers landed on your week, from anyone but you. Authoritative:
   * a cheer taken back on someone else's phone is a smaller number here, and
   * a max() would leave it lit forever.
   */
  cheersReceived?: number;
  /** Your feed, newest first. Authoritative: a withdrawn cheer takes its row with it. */
  notifications?: Notification[];
  /**
   * Other people's weeks, as the feed renders them. Authoritative for the set —
   * a task someone unstaked is an absence here, and a union would leave it on
   * your screen forever — but never for the thread on one, which is local.
   */
  moments?: Moment[];
  /**
   * The Oz bots' week. Authoritative for the whole set, like `moments` and for
   * the same reason: a bot's task that went away has to leave the feed.
   */
  globalPosts?: Moment[];
  /**
   * Every week this account has closed, as the server has them.
   *
   * Emphatically **not** authoritative, unlike almost everything above it. The
   * server holds only the weeks that were closed while a session existed and the
   * queue drained; this device may hold weeks that never got there. So the merge
   * *fills gaps* and never removes, and an empty array means "the server knows of
   * none" rather than "you have none".
   */
  rollups?: HistoryWeek[];
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
  reportTarget: null,
  note: '',
  wrapOpen: false,
  wrapWeek: null,
  notifOpen: false,
  planOpen: false,
  settingsOpen: false,
} satisfies Partial<State>;

/** Fields the composer clears when an edit session ends — saved or abandoned. */
const ABANDON_EDIT = {
  editingId: null,
  draft: '',
  draftPair: [],
  draftAud: null,
  draftDay: null,
  // An empty composer has nothing to block. Leaving this set would carry a
  // refusal about a goal that is no longer on the screen into the next one.
  draftVerdict: 'ok',
  draftReason: '',
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
    // Server-derived, and the server it came from belongs to the account being
    // left behind. Cleared here for the reason the outbox is.
    circle: null,
    // And with it, the fact that anybody had answered — this is a new world,
    // and nothing has been asked about it yet.
    worldSeen: false,
    notifications: seedNotifications(mode),
    globalPosts: seedGlobalPosts(mode),
    people: seedPeople(mode),
    myTasks: seedTasks(mode),
    moments: seedMoments(mode),
    history: seedHistory(mode, week),
    yearLevels: seedYearLevels(mode),
    profile: seedProfile(mode),
  }) satisfies Partial<State>;

/**
 * Order-insensitive, because the server does not promise one.
 *
 * `absent` and `[]` are deliberately different: absent means the payload could
 * not say, `[]` means it said none. Comparing them equal would be the `bot` bug
 * again — the pull carries the key, the directory on disk predates it, every
 * row compares equal, and an upgrading install never learns anybody's
 * membership. Only a device would find that.
 */
const sameCircleIds = (a?: string[], b?: string[]): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const mine = new Set(a);
  return b.every((id) => mine.has(id));
};

const sameStats = (a?: MemberStats, b?: MemberStats): boolean =>
  a === b ||
  (!!a && !!b && a.done === b.done && a.total === b.total && a.streak === b.streak && a.given === b.given);

/** Field-wise, because a row off the wire is always a fresh object. */
/**
 * Every field, deliberately. A merge skips a row this answers true for, so a
 * field missing here is a field the server can never correct.
 *
 * Seen on device: `bot` was added to `Person` and left out of this. The pull
 * carried the flag, the directory on disk predated it, and every row compared
 * equal — so an upgrading install kept counting the Oz bots as its circle,
 * through any number of pulls. A fresh directory was fine, which is why only
 * the device found it.
 */
const samePerson = (a: Person, b: Person): boolean =>
  a === b ||
  (a.name === b.name &&
    a.first === b.first &&
    a.initials === b.initials &&
    a.tintIndex === b.tintIndex &&
    a.trend === b.trend &&
    !!a.bot === !!b.bot &&
    // Both halves. The path alone would miss a photo going from `pending` to
    // `ready` under the same name, which is the merge that turns a face on.
    a.avatarPath === b.avatarPath &&
    a.avatarState === b.avatarState &&
    sameCircleIds(a.circleIds, b.circleIds) &&
    sameStats(a.stats, b.stats));

/**
 * A merged feed, with this device's thread kept on it.
 *
 * The server owns which rows are in the feed; this device owns the notes it has
 * written on them, which `pullNotes` does not answer for — so a note you just
 * left is carried across rather than blinked away by the next poll.
 *
 * Returns `prev` by identity when nothing moved. Same rows in the same order is
 * the common answer, and handing back the old array is what lets `SERVER_MERGE`
 * skip the render for every screen.
 */
const carryThreads = (prev: Moment[], next?: Moment[]): Moment[] => {
  if (!next) return prev;
  const threads = new Map(prev.map((m) => [m.id, m.cmts]));
  const merged = next.map((m) => {
    const kept = threads.get(m.id);
    return kept?.length ? { ...m, cmts: kept } : m;
  });
  // Returning `prev` keeps the *old* objects, so anything this test does not
  // mention is discarded even when the engine decided the pull was worth
  // dispatching. The photo is mentioned for that reason: it lands on a moment
  // whose title and thread have not moved, which is every photo — the goal syncs
  // when it is staked and the picture follows minutes later.
  const unchanged =
    merged.length === prev.length &&
    merged.every((m, i) => {
      const was = prev[i];
      return (
        !!was &&
        was.id === m.id &&
        was.title === m.title &&
        was.cmts === m.cmts &&
        was.media?.id === m.media?.id &&
        was.media?.url === m.media?.url &&
        // The two the server owns and the card draws. Left out, they were only
        // ever safe by accident: a moment with no thread gets a fresh `cmts`
        // from every pull, so the clause above failed and the merge was taken
        // anyway. Write one note on that moment and the thread is carried
        // across by reference, this whole test starts passing, and the count
        // freezes at whatever it was when you wrote — for the life of the
        // install. `time` stays out on purpose: it is recomputed from the clock
        // every pull, and comparing it would report a change every minute
        // forever.
        was.cheers === m.cheers &&
        was.done === m.done &&
        // A goal can move rooms, and both rooms can be yours. Left out, the
        // card would keep naming the circle it was staked in first — the same
        // omission `cheers` and `done` were, found the same way.
        was.circleId === m.circleId
      );
    });
  return unchanged ? prev : merged;
};

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
      // A live global post is a real row owned by a real profile, so a note on
      // one is an ordinary note and syncs like one. The demo's posts are not,
      // and fall through to `globalNotes` below.
      const onGlobal = state.globalPosts.some((x) => x.id === sh.id);

      // None of the three means it's a demo post, whose id is not a uuid and
      // so can never be written. Without this the note was silently dropped —
      // the field cleared and nothing landed.
      if (!onTask && !onMoment && !onGlobal) {
        return {
          ...state,
          note: '',
          globalNotes: {
            ...state.globalNotes,
            [sh.id]: [...(state.globalNotes[sh.id] ?? []), mine],
          },
        };
      }

      const withNote = (x: Moment) =>
        x.id === sh.id ? { ...x, cmts: [...(x.cmts ?? []), mine] } : x;

      return {
        ...state,
        note: '',
        myTasks: onTask
          ? state.myTasks.map((x) => (x.id === sh.id ? { ...x, cmts: [...x.cmts, mine] } : x))
          : state.myTasks,
        moments: onMoment ? state.moments.map(withNote) : state.moments,
        globalPosts: onGlobal ? state.globalPosts.map(withNote) : state.globalPosts,
      };
    }

    case 'SET_DRAFT':
      return { ...state, draft: action.value };

    case 'SET_DRAFT_CAT':
      // Deliberately leaves `draftPts` alone. The composer is about to re-rate
      // under the new category, and until that lands the honest thing to show
      // is the price the button is still promising — which is this one.
      return { ...state, draftCat: action.cat };

    case 'SET_DRAFT_RATING':
      return {
        ...state,
        draftPts: action.points,
        draftVerdict: action.verdict,
        draftReason: action.verdict === 'blocked' ? action.reason : '',
      };

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
      // Not only the button's business. The composer disables itself on a
      // blocked draft, but a disabled button is a UI state and this is the
      // rule, so the reducer refuses too.
      if (state.draftVerdict === 'blocked') return state;
      // Staked at what was shown, never recomputed. See `draftPts`.
      const pts = state.draftPts;
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
        {
          ...state,
          draft: '',
          draftPair: [],
          draftAud: null,
          draftPts: CATEGORY_POINTS[state.draftCat] ?? 30,
          draftVerdict: 'ok',
          draftReason: '',
          myTasks: [...state.myTasks, task],
        },
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
        // What it is already worth. The composer re-rates on the next keystroke;
        // until then the button offers to save it at the price it has.
        draftPts: t.pts,
        draftVerdict: 'ok',
        draftReason: '',
        draftDay: t.day,
        draftPair: [...t.pair],
        draftAud: t.aud,
      };
    }

    case 'SAVE_EDIT': {
      const title = state.draft.trim();
      if (!title || !state.editingId) return state;
      if (state.draftVerdict === 'blocked') return state;
      // Re-priced from the current rating, which is what closes the obvious
      // loop: stake something demanding, get 60, then edit it down to nothing.
      const pts = state.draftPts;
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
          ...ABANDON_EDIT,
        },
        'Updated — still on the line',
      );
    }

    case 'CANCEL_EDIT':
      return { ...state, ...ABANDON_EDIT };

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

    /**
     * The photo is on the task the moment it is picked, before a byte of it
     * has been uploaded — `localUri` is a file this device already holds, so
     * there is nothing to wait for and nothing to show a spinner about. The
     * upload is `media.ts`'s problem, and the row it earns is the outbox's.
     */
    case 'ATTACH_MEDIA':
      return {
        ...state,
        myTasks: state.myTasks.map((t) => (t.id === action.id ? { ...t, media: action.media } : t)),
      };

    /**
     * Taking one back. The object and the row are cleaned up by the queue and
     * the server respectively; what this owns is the screen, which must stop
     * showing a photo the moment the user says so.
     */
    case 'REMOVE_MEDIA': {
      const task = state.myTasks.find((t) => t.id === action.id);
      if (!task?.media) return state;
      return {
        ...state,
        myTasks: state.myTasks.map((t) =>
          t.id === action.id ? { ...t, media: undefined } : t,
        ),
      };
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

    case 'OPEN_SETTINGS':
      return { ...state, settingsOpen: true };

    case 'CLOSE_SETTINGS':
      return { ...state, settingsOpen: false };

    case 'SET_NOTIF_FILTER':
      return { ...state, notifFilter: action.filter };

    case 'READ_NOTIF':
      return { ...state, notifRead: { ...state.notifRead, [action.id]: true } };

    case 'READ_ALL_NOTIFS':
      return {
        ...state,
        // `state.notifications` for every account. It used to read the world's
        // list, which is empty on a live one — so this marked nothing and the
        // badge stayed lit.
        notifRead: state.notifications.reduce<Record<string, true>>((acc, n) => {
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
        // A live-account fact, and this is a new world. Carried forward it
        // would put "something you wrote never saved" on a demo that has never
        // touched the network — and leave it there, because `clearOutbox` has
        // already emptied the list `Got it` would have had to clear.
        unsaved: 0,
        ...seedFor(action.mode, state.week),
        // `seedFor` pins the demo sentinel, on the reasoning that the real id
        // arrives with the session. On a resumed launch it has already arrived,
        // and `SESSION` returns early for a re-broadcast it reads as equal — so
        // nothing would ever announce it again. Left as the sentinel, the next
        // pull files your own `profiles` row as a stranger: you appear twice in
        // your own circle and `isSelf` is false for your own id, until the next
        // launch. The demo modes keep the sentinel, which is what it is for.
        selfId:
          action.mode === 'live' && state.session.status === 'ready'
            ? state.session.userId
            : SELF_DEMO_ID,
        // The engine's only warning that the slices it diffs against were
        // replaced rather than emptied by hand. Without it, reseeding a live
        // account enqueues a delete for every goal on it — see `observe`.
        worldEpoch: state.worldEpoch + 1,
        acted: {},
        replied: {},
        pending: {},
        notifRead: {},
        usedSugg: {},
      };

    case 'SKIP_ONBOARD': {
      // Leaving the flow early keeps whatever account you'd already chosen —
      // and grants an empty one if you never chose.
      //
      // The feed, where finishing properly lands you on Personal: skipping
      // means nothing was staked, so your own week is an empty state. This is
      // the one landing the app picks with nothing of yours to show, so it
      // opens on the tab that has something in it.
      const mode = state.account ?? 'fresh';
      return {
        ...state,
        account: mode,
        profile: state.account ? state.profile : seedProfile(mode),
        onboardStep: null,
        tab: 'week',
        scope: mode === 'seeded' ? 'personal' : 'feed',
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
        // The same rule `SET_ACCOUNT` follows, and it has to be stated twice
        // because `seedFor` cannot see the session. Left as the sentinel, the
        // next pull files your own `profiles` row as a stranger — you appear
        // twice in your own circle until the app is restarted.
        //
        // The queue this used to clear as a side effect of that sentinel flip
        // is now cleared on purpose, by `clearQueuesForReset`, before the
        // dispatch. Read that file before changing this line: reset promises
        // to take unsent work with it, and nothing here enforces that any more.
        selfId:
          action.mode === 'live' && state.session.status === 'ready'
            ? state.session.userId
            : SELF_DEMO_ID,
        // Same warning to the engine as `SET_ACCOUNT` gives, and for the same
        // reason: `initialState` would otherwise take this back to zero.
        worldEpoch: state.worldEpoch + 1,
        onboardStep: null,
        tab: 'week',
        // The feed, for every mode. It used to branch — the demo opened on its
        // circle and the empty modes on Global — and those were the two halves
        // of one list, so there is nothing left to choose between.
        scope: 'feed',
      };
    }

    /**
     * Sign out, which is `RESET` with one difference that is the entire point.
     *
     * `RESET` sets `onboardStep: null` — it drops you into the app with a fresh
     * account. This sets it to `'onboarding'`, via `initialState`, because the
     * Welcome screen is where `recoverWithApple` lives. Without that, signing
     * out would be a one-way door and this whole feature would be a way to lose
     * an account rather than a way to leave one.
     *
     * The wipe is required, not merely tidy: the restore path refuses to fill
     * history onto a device that already has some, so anything left behind here
     * would mean signing back in restores nothing.
     *
     * `week` is re-read rather than inherited from `initialState`, which
     * captured the calendar at module load and may be a week stale in a
     * long-lived process.
     */
    case 'SIGN_OUT': {
      const week = liveWeek();
      // The epoch counts up rather than restarting, here and below: these two
      // leave `live` and so tear the engine down, but a counter that can go
      // backwards is a counter a future caller can make collide.
      return { ...initialState, week, day: week.today, worldEpoch: state.worldEpoch + 1 };
    }

    /**
     * The account asked to be deleted, and the server said when.
     *
     * `SIGN_OUT` with one field carried over, and the field is the point. The
     * wipe is what makes this read as leaving rather than as a setting that
     * was toggled — a person who taps *Delete my account* and is returned to a
     * working app has every reason to think nothing happened, and so does an
     * App Store reviewer. `deletionAt` is what the Welcome screen then reads to
     * offer the way back.
     *
     * The wipe is also required rather than tidy, for `SIGN_OUT`'s own reason:
     * the restore path refuses to fill history onto a device that already has
     * some, so anything left here would mean cancelling restored nothing.
     */
    case 'DELETION_SCHEDULED': {
      const week = liveWeek();
      return {
        ...initialState,
        week,
        day: week.today,
        deletionAt: action.at,
        worldEpoch: state.worldEpoch + 1,
      };
    }

    /**
     * Staying after all — or abandoning the account without recovering it.
     *
     * Only clears the marker. Whoever dispatches this owns the account state
     * that goes with it: the way back pairs it with `SET_ACCOUNT` and
     * `SKIP_ONBOARD`, and *Get started* pairs it with a real sign-out and a new
     * anonymous account. Doing either from in here would make one action mean
     * two opposite things.
     */
    case 'DELETION_CANCELLED':
      return { ...state, deletionAt: null };

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
      // The arithmetic lives in `closingWeek`, because `RolloverOverlay` has to
      // reach the identical numbers to queue this week for the server. The
      // arrays stay here: `did` needs the tasks themselves, not a count.
      const { points, perfect, streakHeld } = closingWeek(closed);

      const record: HistoryWeek = {
        n: state.week.number,
        label: state.week.label,
        points,
        done: done.length,
        total: closed.length,
        // One rule, two writers — the other is `rowToHistoryWeek`, for the same
        // week arriving back from the server on a reinstall.
        ...weekSummary(done.length, closed.length),
        did: done.map((t) => ({ title: t.title, points: t.pts })),
        helpedBy: [],
        helped: [],
      };

      const currentStreak = streakHeld ? state.profile.currentStreak + 1 : 0;

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
          // Week-scoped, like `acted` below: it counts the cheers this week's
          // rows collected. The next pull refills it, so only a live account
          // clears — the demo's is a fixture with nothing to refill it.
          cheersReceived: state.account === 'live' ? 0 : state.profile.cheersReceived,
        },
        // Week-scoped. Everything else — who you are, what you've said to
        // people, your replies on public posts — carries forward.
        myTasks: carried,
        // A live feed is one week of other people's rows, so carrying it over
        // would show last week's tasks as this week's until the next pull. The
        // demo's are fixtures with no pull to refill them, so they stay: the
        // rule is "drop what the server will re-answer", not "drop moments".
        moments: state.account === 'live' ? [] : state.moments,
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
        // The one landing that stays Personal, and the reason is on the button:
        // "Enter your week". You have just staked one, so it is not empty and
        // it is what you asked for — opening on strangers instead would be the
        // app answering a question nobody asked.
        scope: 'personal',
        myTasks: [...state.myTasks, ...staked],
        people,
      };
    }

    case 'RENAME_SELF': {
      /**
       * The whole feature. There is no push here and no outbox call, because
       * the engine already watches `people[selfId].name` — the watcher Wave A
       * added for onboarding is not onboarding-specific, so writing the name
       * into the directory *is* queueing it.
       *
       * Bounded to `NAME_MAX` because `profiles_name_length` refuses anything
       * longer, and a refusal here would dead-letter at the head of the queue.
       */
      const named = action.name.trim().slice(0, NAME_MAX);
      const current = state.people[state.selfId];
      if (!named || named === current?.name) return state;

      // Spread first, so `personOf` overwrites exactly the three fields a name
      // decides — and everything else about you (tint, trend, stats) survives a
      // rename rather than being quietly dropped by rebuilding the record.
      const people = indexPeople(
        Object.values(state.people)
          .filter((p): p is Person => !!p && p.id !== state.selfId)
          .concat({ ...current, ...personOf(state.selfId, named) }),
      );
      return { ...state, people };
    }

    case 'SET_AVATAR': {
      const current = state.people[state.selfId];
      if (!current) return state;
      const path = action.path ?? undefined;
      const avatarState = action.state === 'none' ? undefined : action.state;
      if (current.avatarPath === path && current.avatarState === avatarState) return state;

      // Spread-and-overwrite, exactly as `RENAME_SELF` does: everything else
      // about you survives, and the two avatar fields move together — a path
      // with no state, or a state with no path, is a photo nothing can render
      // and nothing can clean up.
      const next: Person = { ...current, avatarPath: path, avatarState };
      if (!path) delete next.avatarPath;
      if (!avatarState) delete next.avatarState;

      const people = indexPeople(
        Object.values(state.people)
          .filter((p): p is Person => !!p && p.id !== state.selfId)
          .concat(next),
      );
      return { ...state, people };
    }

    case 'UNSAVED': {
      /**
       * The count the outbox just announced. Compared before storing, because
       * every drain announces and every dispatch re-renders every screen — and
       * the answer is the same number almost every time.
       */
      if (state.unsaved === action.count) return state;
      return { ...state, unsaved: action.count };
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
        (cur as { message?: string }).message === (next as { message?: string }).message &&
        // `anonymous` belongs in here because a successful Apple link changes
        // *only* this: same status, same uuid, an account that can now be got
        // back. Without it the comparison calls that "same", the store keeps the
        // old session, and Me goes on offering to secure an account that already
        // is — the one visible confirmation the user gets, withheld.
        (cur as { anonymous?: boolean }).anonymous === (next as { anonymous?: boolean }).anonymous;
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

    case 'BLOCK': {
      // Idempotent, like `ACT`'s add half: a second tap — or a retry of an
      // entry the queue already sent — must not grow the list a second time.
      if (state.blocked.includes(action.id)) return state;
      return { ...state, blocked: [...state.blocked, action.id] };
    }

    case 'UNBLOCK': {
      if (!state.blocked.includes(action.id)) return state;
      return { ...state, blocked: state.blocked.filter((id) => id !== action.id) };
    }

    case 'BLOCKS_PULLED':
      // The server's whole answer, replacing rather than merging: an unblock
      // on another device is an absence here, and a union would leave it lit
      // on this phone forever — the same reasoning as `reconcileActed`.
      return { ...state, blocked: action.ids };

    case 'OPEN_REPORT':
      // Leaves `sheet` alone on purpose: the report sheet is opened from on top
      // of whatever you were looking at, and closing it should put you back
      // there rather than on an empty screen.
      return { ...state, reportTarget: action.target };

    case 'CLOSE_REPORT':
      // Cancelling is exactly this and nothing else. No report, no block, no
      // toast — a person who opened this sheet by accident owes the app
      // nothing, and a "Nothing was sent" reassurance would be one more thing
      // to read on the way out.
      return { ...state, reportTarget: null };

    case 'REPORT_FILED': {
      // Idempotent for the same reason `BLOCK` is: the same subject reported
      // twice is one hidden thing, not two list entries.
      const reported = state.reported.includes(action.id)
        ? state.reported
        : [...state.reported, action.id];
      // If the detail sheet is standing on the very thing that just went
      // hidden, close it. Leaving it up would show the reported card for as
      // long as the user kept looking at it, which is the one moment the
      // promise "it's hidden from you now" is easiest to catch out.
      const sheet = state.sheet?.id === action.id ? null : state.sheet;
      // `reportTarget` deliberately stays. Filing is the middle of this flow,
      // not the end: the sheet has to still be there to say what just happened
      // and to offer the block as a second, separate decision. `CLOSE_REPORT`
      // is the only thing that clears it.
      return { ...state, reported, sheet };
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

      /**
       * Whoever the server no longer names is no longer here.
       *
       * `merge.people` is the *whole* directory — your circles and the bots, in
       * one payload — so the ids missing from it are ids this account can no
       * longer reach. Until now nothing ever dropped one, and a directory that
       * only grows is a directory that accumulates ghosts: point the app at a
       * second backend, or re-seed the Oz bots (their accounts are minted by
       * `scripts/seed-bots.mjs`, so a reset gives them new uuids), and the old
       * profile rows stay in `people` — and *stay on disk*, because `people` is
       * persisted. The composer's "In it with me" list is `Object.keys(people)`,
       * so each ghost is another chip: the same bot, under the same name, twice.
       *
       * Pruned here rather than in the render because every reader of this
       * slice has the same problem — the header counts it, the leaderboard
       * ranks it — and a directory that is wrong is worth fixing once.
       *
       * An empty payload is "nobody", not "no answer" — a fresh account is in no
       * circle, and an `.env` pointed at a second backend has none of the first
       * one's people. What makes that safe to act on is the engine's own rule: a
       * pull that could not answer never dispatches, so the key is here only
       * when the reads came back.
       *
       * You are never dropped, whatever the payload says. `pullCircle` answers
       * with the members of your circles, so an account in none is not in its
       * own directory — and your name is the one thing here that is written
       * locally before the server has ever heard it.
       */
      if (state.account === 'live' && action.merge.people) {
        const named = new Set<PersonId>(action.merge.people.map((p) => p.id));
        named.add(state.selfId);
        const kept = Object.values(people).filter((p): p is Person => !!p && named.has(p.id));
        if (kept.length !== Object.keys(people).length) {
          people = indexPeople(kept);
        }
      }

      // The dirty set is derived here, from the queue, and deliberately not kept
      // in state: it would be a second record of what the server still owes us,
      // and the one that decides what actually goes out is the outbox.
      let myTasks = action.merge.tasks
        ? reconcileTasks(state.myTasks, action.merge.tasks, dirtyTaskIds(), ackedTaskIds())
        : state.myTasks;

      // The photos, after the rows and against the same freshly-derived queue —
      // a different set, because a media op is keyed by media id and so is
      // invisible to `dirtyTaskIds`. `undefined` means this merge carries no
      // answer about photos at all and is not the same as an empty map, which
      // says these goals have none and is how a removal elsewhere arrives.
      if (action.merge.media !== undefined) {
        myTasks = reconcileMedia(myTasks, action.merge.media, dirtyMediaTaskIds());
      }

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
      // Assigned rather than folded: unlike the slices above, there is nothing
      // local to protect — no screen writes the circle, so the server's answer
      // is the only one there has ever been.
      const circle = action.merge.circle !== undefined ? action.merge.circle : state.circle;

      const notifications =
        action.merge.notifications !== undefined ? action.merge.notifications : state.notifications;

      // Same reasoning, one field over. Nothing local has ever written this —
      // it was a seed constant the Me screen rendered and no code updated.
      const profile =
        action.merge.cheersReceived !== undefined &&
        action.merge.cheersReceived !== state.profile.cheersReceived
          ? { ...state.profile, cheersReceived: action.merge.cheersReceived }
          : state.profile;

      const moments = carryThreads(state.moments, action.merge.moments);
      // The same question about a different set of rows: the Oz bots' feed is
      // the server's to own and yours to have replied to.
      const globalPosts = carryThreads(state.globalPosts, action.merge.globalPosts);

      /**
       * History comes back only onto a device that has none.
       *
       * The narrow rule, and narrow on purpose. The obvious version fills the
       * gaps — take any week the server has that this device does not — and it
       * cannot be written safely, because a `HistoryWeek` is identified by `n`,
       * an ISO week number that repeats every year. Merging by it would fuse
       * week 33 of two different years into one the first time somebody used
       * this app for more than twelve months, and the damage would be invisible
       * until they scrolled back.
       *
       * An empty history has no such ambiguity, and it is exactly the case worth
       * serving: a reinstall, where the account has just been recovered and the
       * weeks would otherwise be gone. A device that already has history keeps
       * what it has, which is never wrong — only, occasionally, incomplete.
       *
       * The totals move with it, from `aggregatesFrom`. `COMMIT_ROLLOVER`
       * remains the only writer of those numbers on every other path, so no week
       * is ever counted twice.
       */
      const restoring = state.history.length === 0 && (action.merge.rollups?.length ?? 0) > 0;
      // Ascending from the server; `history` is newest-first, `yearLevels` is not.
      const ascending = action.merge.rollups ?? [];
      const history = restoring ? [...ascending].reverse() : state.history;
      const yearLevels = restoring
        ? ascending.map((w) => weekLevel(w.done, w.total))
        : state.yearLevels;
      const restored = restoring ? { ...profile, ...aggregatesFrom(history) } : profile;

      if (
        people === state.people &&
        myTasks === state.myTasks &&
        history === state.history &&
        restored === profile &&
        acted === state.acted &&
        personNotes === state.personNotes &&
        circle === state.circle &&
        moments === state.moments &&
        globalPosts === state.globalPosts &&
        profile === state.profile &&
        notifications === state.notifications
      ) {
        return state;
      }
      return {
        ...state,
        people,
        myTasks,
        acted,
        personNotes,
        circle,
        // The server has now answered about this world, whatever it said. Read
        // by the screens that must not mistake "we have not asked" for "you
        // have none".
        worldSeen: true,
        moments,
        globalPosts,
        profile: restored,
        notifications,
        history,
        yearLevels,
      };
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
    // Derived from the outbox, which announces the real number as soon as it
    // hydrates. Restoring a stale one would show a notice for a refusal that
    // has already been acknowledged.
    unsaved: 0,
    // `scope` is persisted and has no soundness check, and this build deleted
    // two of its three values. An app upgrading across that change restores
    // 'friends' or 'global', which no branch in WeekScreen renders — a blank
    // Week tab, on the tab the app opens on. Both of them mean the feed now.
    // Deliberately not a VERSION bump: that discards the week, the history and
    // the profile, which is far too much to pay for a renamed UI enum.
    scope: s.scope === 'personal' ? 'personal' : 'feed',
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
      ? indexPeople(withFixtureTints(Object.values(restored.people).filter((p): p is Person => !!p)))
      : seedPeople(s.account),
    // Re-seeded from the restored account rather than inherited, for the same
    // reason `people` is. A spread only copies keys that are *present*, so a
    // payload written before this slice existed leaves `initialState`'s value
    // standing — and `initialState` is seeded for an undecided account, which
    // means the demo's four. Seen on device: a live account upgrading across
    // that build opened on the Oz *fixture*, credited to "Someone", until the
    // first pull replaced it. Right shape, wrong world, which is this app's
    // most-repeated bug.
    globalPosts: restored?.globalPosts ?? seedGlobalPosts(s.account),
    // Only a live account's is restored. A demo bell is a constant — nothing
    // edits it, and `notifRead` is persisted separately — so a payload written
    // before it was seeded here would otherwise leave the demo permanently
    // silent, which is the bug this whole change is about, upside down.
    notifications:
      s.account === 'live' ? (restored?.notifications ?? []) : seedNotifications(s.account),
  };
}

type Store = {
  state: State;
  dispatch: React.Dispatch<Action>;
  config: Config;
  /** Furniture only a demo account has: the owed list, the rail, invite ideas. */
  demo: DemoContent;
  /** Names, initials, tints and trends — total, for any id at all. */
  people: People;
  /** Resolved audience for the composer: the draft choice, or the configured default. */
  effectiveAudience: Audience;
};

const StoreContext = createContext<Store | null>(null);

/**
 * The people resolver on its own channel. `StoreContext`'s value changes on
 * every dispatch; this one changes only when the directory or the self id
 * does. Components that need nothing but names and tints (Avatar, memoized
 * feed cards) subscribe here so a keystroke elsewhere cannot re-render them.
 */
const PeopleContext = createContext<People | null>(null);

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
    // The other half of "is sync fine": what the server refused outright. It
    // announces on a drop, on hydration, and when the list is acknowledged, so
    // nothing here polls. Read once now too — the queue may have hydrated a
    // refusal from a previous launch before this effect ever ran.
    const unwatchOutbox = onOutboxChange(() =>
      dispatch({ type: 'UNSAVED', count: unsavedCount() }),
    );
    dispatch({ type: 'UNSAVED', count: unsavedCount() });
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
      unwatchOutbox();
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

  /**
   * Keep Monday's reminder saying something true. It is a no-op until the user
   * has actually granted permission, so this costs nothing for anyone who never
   * tapped the button — and it belongs here rather than in the engine because a
   * local notification is a device concern, not a synced one: the demo accounts
   * get it too, and it must survive with no network at all.
   */
  useWeekReminder(state.week.number, stakedPoints(state));

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

  /**
   * Changing *account* throws the queue away. So does changing *identity*.
   *
   * The account mode above is a deliberate act with a confirmation in front of
   * it. This is the involuntary version: an anonymous session lost and a new
   * user minted on the same project. Nothing on screen changes, and the queue
   * is still full of the previous account's work — which `run()` stamps with
   * `owner_id` at send time, so it would land, successfully, filing one
   * person's week under another's name.
   *
   * The local world is deliberately left alone. Those rows are orphaned on the
   * server now, which makes what is on this device the only surviving copy;
   * deleting it to tidy up would be the most destructive thing this could do.
   * Stopping the writes is enough to keep anyone else's history honest.
   *
   * Not fired for the sentinel, which is every first session: a queue built
   * before this install ever held one is exactly the plane case, and it is
   * supposed to drain under the id that finally arrives.
   */
  const lastSelfId = useRef(state.selfId);
  useEffect(() => {
    const prev = lastSelfId.current;
    lastSelfId.current = state.selfId;
    if (prev === state.selfId || prev === SELF_DEMO_ID) return;
    void clearOutbox();
    teardownRealtime();
  }, [state.selfId]);

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

  // Memoized on the slices they actually read, not on `state`. The reducer
  // works hard to keep `state.people` referentially stable across unrelated
  // actions; minting a fresh resolver per dispatch would throw that away at
  // the context boundary and defeat every React.memo downstream.
  const people = useMemo(() => makePeople(state.people, state.selfId), [state.people, state.selfId]);
  const demo = useMemo(() => demoContent(state.account), [state.account]);

  const value = useMemo<Store>(
    () => ({
      state,
      dispatch,
      config,
      demo,
      people,
      effectiveAudience: state.draftAud ?? config.defaultAudience,
    }),
    [state, config, demo, people],
  );

  return (
    <StoreContext.Provider value={value}>
      <PeopleContext.Provider value={people}>{children}</PeopleContext.Provider>
    </StoreContext.Provider>
  );
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
  const people = useContext(PeopleContext);
  if (!people) throw new Error('usePeople must be used inside <StoreProvider>');
  return people;
}

export { ME };
