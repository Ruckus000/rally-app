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
import { AUDIENCES, CATEGORY_POINTS, Task } from '../data/fixtures';
import { DAY_NAMES } from '../data/week';
import type { State } from './store';

const KEY = 'rally:state:v1';
/**
 * 2: the week, its history and the running totals became persisted state, and
 * the envelope's separate `week` field went away. An older payload is missing
 * required slices, so it's discarded rather than half-restored.
 */
const VERSION = 2;
const DEBOUNCE_MS = 400;

/** The slices worth keeping. Everything else is rebuilt on launch. */
const PERSISTED_KEYS = [
  'account',
  'onboardStep',
  'seenTooltip',
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
      Array.isArray(t.cmts),
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

function isSound(data: unknown): data is Persisted {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<Persisted>;
  if (!tasksAreSound(d.myTasks)) return false;
  if (!Array.isArray(d.moments)) return false;
  if (d.account !== null && d.account !== 'fresh' && d.account !== 'seeded') return false;
  if (!weekIsSound(d.week)) return false;
  if (!historyIsSound(d.history)) return false;
  if (!Array.isArray(d.yearLevels)) return false;
  if (!d.profile || typeof d.profile !== 'object') return false;
  // Dying mid-prompt should bring you back to the prompt, so it persists —
  // which means it also has to survive the trip intact.
  if (d.pendingRollover && !weekIsSound(d.pendingRollover.to)) return false;
  return true;
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

/** Every reducer branch updates immutably, so reference equality is reliable. */
const unchanged = (a: Persisted | null, b: Persisted) =>
  !!a && PERSISTED_KEYS.every((k) => a[k] === b[k]);

async function write(data: Persisted) {
  try {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ version: VERSION, data }),
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
