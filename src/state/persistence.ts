/**
 * Durable state, on disk.
 *
 * Only the things that should survive a relaunch are written. Overlay flags,
 * draft buffers and the toast are deliberately excluded — reopening into a
 * half-written composer or an open sheet would be wrong.
 *
 * Note that what comes back off disk is untrusted input: it may be truncated,
 * or written by an older build. Anything that fails the checks below is
 * discarded whole rather than half-restored.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AUDIENCES, CATEGORY_POINTS, MOMENT_KINDS, NOTIF_TIERS, Task } from '../data/fixtures';
import type { Moment } from '../data/fixtures';
import { ACCOUNT_MODES } from '../data/seed';
import { NAME_MAX } from '../data/people';
import { DAY_NAMES } from '../data/week';
import { projectRef } from '../lib/supabase';
import type { State } from './store';

const KEY = 'rally:state:v1';
/**
 * 2: the week, its history and the running totals became persisted state, and
 * the envelope's separate `week` field went away. An older payload is missing
 * required slices, so it's discarded rather than half-restored.
 *
 * `people` and `selfId` arriving did *not* bump this, on purpose. A bump makes
 * `load()` return null, which would throw away the staked week, the history,
 * the year grid, the streak and the totals and drop the user back on the join
 * screen. Nothing about the on-disk identity encoding changed — demo ids are
 * still 'maya', you are still 'you' — and both new keys are derivable from
 * `account`, which was already there. `hydrate()` backfills them.
 */
const VERSION = 2;
const DEBOUNCE_MS = 400;

/** The slices worth keeping. Everything else is rebuilt on launch. */
const PERSISTED_KEYS = [
  'account',
  'onboardStep',
  'tab',
  'scope',
  'myTasks',
  'moments',
  'acted',
  'replied',
  'pending',
  'personNotes',
  'globalNotes',
  'week',
  'history',
  'yearLevels',
  'profile',
  'pendingRollover',
  'usedSugg',
  'notifRead',
  'selfId',
  'people',
  'notifications',
  'globalPosts',
  /**
   * A block taken offline must still hold on relaunch — that's the whole point
   * of this task, and a block that evaporated on force-quit would be worse than
   * no local filter at all, since it would read as "undone" rather than "never
   * synced". Deliberately **not** a `VERSION` bump: the field is additive and
   * self-healing exactly the way `people`/`selfId` were when they were added —
   * a payload written before it existed simply lacks the key, the spread in
   * `hydrate()` leaves `initialState.blocked` (`[]`) standing, and the next
   * pull's `BLOCKS_PULLED` overwrites it with the truth regardless. Nothing
   * downstream crashes on an empty list the way `DAY_NAMES[task.day]` would on
   * a missing `day`, so there is nothing here that justifies discarding a
   * user's staked week, history and totals over.
   */
  'blocked',
  /**
   * And the reported list, for a stronger reason than `blocked` has. A block is
   * re-derivable — the next pull hands the whole list back. A report is not:
   * nothing on the server remembers that *you* asked to stop seeing this, since
   * `reports` is unreadable by anybody including its author. So this key is the
   * only copy of "hidden from you", and losing it un-hides the exact thing
   * somebody went out of their way to get rid of. Additive and no `VERSION`
   * bump, for the reasons above.
   */
  'reported',
  /**
   * And when this account asked to be deleted, which has to outlive the wipe
   * that scheduling one performs. `DELETION_SCHEDULED` returns `initialState`
   * with only this field carried across, so if it were not persisted the
   * marker would survive exactly until the app was next closed — and the way
   * back would disappear with it, silently, for the fortnight that matters.
   *
   * Additive, and no `VERSION` bump, for the reason `blocked` and `reported`
   * give above and `people`/`selfId` gave before them. A bump discards the
   * staked week, the history, the year grid and the totals; a payload written
   * before this key existed simply lacks it, and the spread in `hydrate()`
   * leaves `initialState.deletionAt` (null) standing — which is the right
   * answer for every install that predates the feature, since none of them has
   * a deletion pending.
   */
  'deletionAt',
] as const;

export type Persisted = Pick<State, (typeof PERSISTED_KEYS)[number]>;

export const pick = (state: State): Persisted =>
  PERSISTED_KEYS.reduce((acc, k) => {
    (acc as Record<string, unknown>)[k] = state[k];
    return acc;
  }, {} as Persisted);

/**
 * Validate the fields that would crash a render if they came back wrong —
 * `DAY_NAMES[task.day]` and the category/audience lookups. This is not a
 * schema validator; it's the crashing subset.
 */
function tasksAreSound(value: unknown): value is Task[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (t) =>
      t &&
      typeof t === 'object' &&
      typeof t.id === 'string' &&
      typeof t.title === 'string' &&
      Number.isInteger(t.day) &&
      t.day >= 0 &&
      t.day < DAY_NAMES.length &&
      t.cat in CATEGORY_POINTS &&
      AUDIENCES.includes(t.aud) &&
      Array.isArray(t.pair) &&
      Array.isArray(t.cmts) &&
      mediaIsSound(t.media),
  );
}

/**
 * A photo on a task, or nothing.
 *
 * Deliberately **not** a `VERSION` bump: the field is additive and optional,
 * exactly like the two before it, and bumping would throw away every existing
 * install's week to add a key they simply do not have yet. What it does need
 * is this — `undefined` is the normal case, and anything else is checked,
 * because the renderer reads `.localUri` and divides by `.h`, and a payload
 * carrying `media: null` would take the card down rather than the photo.
 */
function mediaIsSound(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.path === 'string' &&
    // Positive, not merely finite. Both reach an `aspectRatio`, and a zero
    // height is an infinite one — a card that takes the whole screen rather
    // than a photo that looks wrong. `w / h || 4 / 3` does not save it either:
    // only `NaN` is falsy enough to fall through to that default.
    typeof m.w === 'number' &&
    typeof m.h === 'number' &&
    Number.isFinite(m.w) &&
    Number.isFinite(m.h) &&
    m.w > 0 &&
    m.h > 0
  );
}

/**
 * The crashing subset, exactly as `tasksAreSound` scopes itself — not a schema
 * validator. `moments` used to be checked with a bare `Array.isArray`, which was
 * fine while every one of them was a fixture written by this build. They are
 * other people's rows now, so a `day` out of range or a `kind` this build has no
 * card for arrives from the network and reaches the renderer unchecked.
 */
function momentsAreSound(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every(
    (m) =>
      m &&
      typeof m === 'object' &&
      typeof m.id === 'string' &&
      typeof m.who === 'string' &&
      (MOMENT_KINDS as readonly string[]).includes(m.kind) &&
      Number.isInteger(m.day) &&
      m.day >= 0 &&
      m.day < DAY_NAMES.length &&
      // The backstop, not the gate. `write` drops a photo it could not read
      // back, so nothing this build persists reaches here malformed — which
      // matters, because failing is not losing the photo. `isSound` is
      // all-or-nothing: it loses the week too.
      mediaIsSound(m.media),
  );
}

/**
 * The bell's feed, which is why it persists at all: it is server-derived, and
 * until now that meant every cold start showed "Nothing needs you" until the
 * first pull came back — an empty state that reads as an answer rather than as
 * a wait. The next pull is authoritative and replaces this wholesale, so what
 * is on disk only has to be right for the second before it arrives.
 *
 * The crashing subset again, plus one bound. `text` and `time` are rendered as
 * text nodes, so a non-string is a red screen. `tier` decides which section a
 * row lands in; an unknown one renders nowhere, which is invisible rather than
 * fatal, but a row that cannot be seen has no business surviving a relaunch.
 *
 * `name` is bounded because it is another account's display name, reaching
 * every row and every accessibility label. `text` is not: it carries a task
 * title, and the server puts no length limit on those — a bound here would let
 * one long title discard the whole payload and take the user's week with it.
 * Undefined passes: a payload written before this key existed is not corrupt.
 */
function notificationsAreSound(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const tiers: readonly string[] = NOTIF_TIERS.map((t) => t.key);
  return value.every(
    (n) =>
      n &&
      typeof n === 'object' &&
      typeof n.id === 'string' &&
      tiers.includes(n.tier) &&
      typeof n.text === 'string' &&
      typeof n.time === 'string' &&
      // Three first names and "and N others" at most — a legitimate one cannot
      // reach this, because each name is bounded at the server.
      (n.name === undefined || isBoundedString(n.name, NAME_MAX * 4)) &&
      (n.faces === undefined ||
        (Array.isArray(n.faces) && n.faces.every((f: unknown) => typeof f === 'string'))),
  );
}

/** History drives the year grid, Past weeks and the running totals. */
function historyIsSound(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every(
    (h) =>
      h &&
      typeof h === 'object' &&
      Number.isFinite(h.n) &&
      typeof h.label === 'string' &&
      Number.isFinite(h.points) &&
      Number.isFinite(h.done) &&
      Number.isFinite(h.total) &&
      Array.isArray(h.did),
  );
}

function weekIsSound(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const w = value as Record<string, unknown>;
  return (
    Number.isFinite(w.number) &&
    Number.isInteger(w.today) &&
    (w.today as number) >= 0 &&
    (w.today as number) < DAY_NAMES.length &&
    typeof w.label === 'string'
  );
}

/**
 * Undefined is fine — a payload written before the directory existed backfills
 * from `account`. What's checked is the shape every avatar and row reads.
 */
/**
 * A display name is the one string an outsider controls that reaches every
 * screen and every accessibility label, so it is bounded rather than trusted
 * and truncated at each of the dozens of render sites.
 *
 * Imported rather than repeated: this check discards the entire payload, and
 * `personOf` clamps to the same number on the way in. Two spellings that drifted
 * apart would mean rows that pass one and fail the other — which reads as the
 * app forgetting everything, at launch, with no error.
 */

const isBoundedString = (v: unknown, max = NAME_MAX): boolean =>
  typeof v === 'string' && v.length <= max;

/**
 * Undefined is fine, for the reason `PERSISTED_KEYS`' comment on `'blocked'`
 * gives: a payload written before this slice existed is not corrupt, only old.
 * What's checked is the shape the filter in `selectors.ts` reads — a list of
 * ids, nothing fancier — so a malformed entry cannot reach `Set` construction
 * or an `Array.includes` and crash a render over what is, worst case, a stale
 * block silently not applying.
 */
function blockedIsSound(value: unknown): boolean {
  if (value === undefined) return true;
  return Array.isArray(value) && value.every((id) => typeof id === 'string');
}

function peopleAreSound(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).every((p) => {
    if (!p || typeof p !== 'object') return false;
    const r = p as Record<string, unknown>;
    return (
      isBoundedString(r.id, 128) &&
      isBoundedString(r.name) &&
      isBoundedString(r.first) &&
      isBoundedString(r.initials, 8)
    );
  });
}

function isSound(data: unknown): data is Persisted {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<Persisted>;
  if (!tasksAreSound(d.myTasks)) return false;
  if (!momentsAreSound(d.moments)) return false;
  // Same shape, same rules — the Oz bots' rows are moments like any other.
  if (d.globalPosts !== undefined && !momentsAreSound(d.globalPosts)) return false;
  if (!notificationsAreSound(d.notifications)) return false;
  // Written against the tuple so a new account mode can never be silently
  // discarded here — that failure mode is a permanently forgetful app.
  if (d.account !== null && !(ACCOUNT_MODES as readonly string[]).includes(d.account as string))
    return false;
  if (!weekIsSound(d.week)) return false;
  if (!historyIsSound(d.history)) return false;
  if (!Array.isArray(d.yearLevels)) return false;
  if (!d.profile || typeof d.profile !== 'object') return false;
  // Dying mid-prompt should bring you back to the prompt, so it persists —
  // which means it also has to survive the trip intact.
  if (d.pendingRollover && !weekIsSound(d.pendingRollover.to)) return false;
  if (!peopleAreSound(d.people)) return false;
  if (d.selfId !== undefined && typeof d.selfId !== 'string') return false;
  // Parsed by `new Date()` to draw a date on the Welcome screen. Anything that
  // is neither absent nor a string would render "Invalid Date" at the one
  // moment somebody is deciding whether to keep their account.
  if (d.deletionAt !== undefined && d.deletionAt !== null && typeof d.deletionAt !== 'string')
    return false;
  if (!blockedIsSound(d.blocked)) return false;
  return true;
}

/**
 * Was this payload written against a different Supabase project?
 *
 * A live account's state is a picture of one backend: its tasks, its circle,
 * its bots, its ids. Point the app at another project and none of it exists
 * there — but the payload is byte-identical in shape to a good one, so nothing
 * else here can tell. Switching backends used to show the previous one's world
 * until the app was uninstalled.
 *
 * Three ways to answer "no", and each one is load-bearing rather than lenient:
 *
 *   - Demo and seeded worlds are not backend-derived, and those modes make no
 *     network calls at all. A URL change must not eat a demo week.
 *   - No stamp means the payload predates this check. It was written against
 *     the backend still in use, so it is kept and stamped on the next write —
 *     an upgrade nobody notices rather than one that costs a staked week.
 *   - No configured project means the build cannot tell, which is every jest
 *     suite that does not set the env. Discarding on ignorance would be a
 *     permanently forgetful app.
 */
function isForeign(envelope: { backend?: unknown; data?: unknown }): boolean {
  const account = (envelope.data as Partial<Persisted> | undefined)?.account;
  if (account !== 'live') return false;
  if (typeof envelope.backend !== 'string') return false;
  const ref = projectRef();
  if (!ref) return false;
  return envelope.backend !== ref;
}

export async function load(): Promise<Persisted | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;

    const envelope = JSON.parse(raw);
    // A version bump discards rather than migrates. A *week* change used to
    // discard too — that was right only while the week could never move, and
    // is now exactly the bug that would eat a week's work. Rollover handles it.
    if (envelope?.version !== VERSION) return null;
    if (isForeign(envelope)) return null;
    if (!isSound(envelope.data)) return null;

    return envelope.data as Persisted;
  } catch {
    // Truncated or corrupt payload. Start clean rather than crash on boot.
    return null;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let queued: Persisted | null = null;
let lastWritten: Persisted | null = null;

/**
 * Every reducer branch updates immutably, so reference equality is reliable —
 * which also means `people` must only ever be *replaced*, never rebuilt per
 * render, or this skip stops skipping and every render hits the disk.
 */
const unchanged = (a: Persisted | null, b: Persisted) =>
  !!a && PERSISTED_KEYS.every((k) => a[k] === b[k]);

/**
 * A moment as it goes to disk: no signed URL, and no photo this build could not
 * read back.
 *
 * **The URL is dropped** because it is a bearer link with an hour on it. Written
 * to disk it is a token in a file, and restored it is a token that expired
 * overnight — a photo that renders nothing until the first pull mints another.
 * The durable half is `path`, which is what the next pull signs. Same argument
 * `lib/avatarUrl.ts` makes for never persisting its cache at all.
 *
 * **A malformed photo is dropped** rather than carried, because of what the
 * check on the way back in does when it meets one. `momentsAreSound` failing
 * does not lose the photo — `isSound` is all-or-nothing, so it loses the entire
 * payload, week included. Nothing in this build can write a bad one, and this
 * is what keeps that true across the next change to the shape: the validator
 * stays a backstop instead of a tripwire.
 *
 * Done here rather than in `pick` on purpose. `pick` is compared by reference to
 * decide whether a write is needed at all, so minting new arrays there would
 * write on every keystroke.
 */
const scrubMoments = (moments: Moment[]): Moment[] =>
  moments.map((m) => {
    if (!m.media) return m;
    if (!mediaIsSound(m.media)) {
      const { media: _dropped, ...rest } = m;
      return rest;
    }
    if (m.media.url === undefined) return m;
    const { url: _url, ...media } = m.media;
    return { ...m, media };
  });

async function write(data: Persisted) {
  try {
    // The scrubbed copy is what goes to disk; `lastWritten` stays the object
    // `pick` built, because that is what the next `unchanged` compares against
    // by reference. Remembering the copy instead would make every save a write.
    const payload: Persisted = {
      ...data,
      moments: scrubMoments(data.moments),
      globalPosts: scrubMoments(data.globalPosts),
    };
    // `backend` rides in the envelope, beside `version`, rather than in `data`.
    // It describes the write, not the app: as a state key it would be picked,
    // reference-diffed by `unchanged`, and threaded through `hydrate`, `RESET`
    // and `seedFor` for no gain.
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ version: VERSION, backend: projectRef(), data: payload }),
    );
    lastWritten = data;
  } catch {
    // Disk full, quota, whatever. A failed save must never take the app down.
  }
}

/** Debounced so typing in a composer doesn't thrash the disk. */
export function save(state: State) {
  const data = pick(state);
  if (unchanged(lastWritten, data)) return;

  queued = data;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const pending = queued;
    queued = null;
    if (pending) void write(pending);
  }, DEBOUNCE_MS);
}

/**
 * Write immediately. Called when the app backgrounds, which closes the common
 * force-quit window — it isn't a guarantee for every kill path. Returns the
 * write so callers that care (tests) can wait for it.
 */
export function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const pending = queued;
  queued = null;
  return pending ? write(pending) : Promise.resolve();
}

/** Test seam — the module keeps write state across a suite otherwise. */
export function __resetForTests() {
  if (timer) clearTimeout(timer);
  timer = null;
  queued = null;
  lastWritten = null;
}
