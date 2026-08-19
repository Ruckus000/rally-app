/**
 * Photos that have been taken and have not reached the bucket yet.
 *
 * A second queue, deliberately, and the reason is `outbox.ts`'s own comment:
 * that one is **strictly serial and head-of-line blocking**, because ordering
 * is the point of it — a note names a task by foreign key, an edit depends on
 * the create before it. A photo has no such relationship to anything: it
 * belongs to exactly one task and to no other entry. Put a 300 KB upload at
 * the head of the ordered queue and every cheer, every tick, every note behind
 * it waits out the radio; run it in its own lane and nothing does.
 *
 * The other half of the separation is what is being carried. The outbox
 * envelope is JSON in AsyncStorage; the payload here is a file on disk, and
 * the entry only ever holds its *path*. Nothing base64 is ever persisted.
 *
 * ─── the ordering that does matter ────────────────────────────────────────
 *
 * Upload first, record second. A `task_media` row is a promise that an object
 * exists at that path, and it is read by everyone who can see the task — so a
 * row written before its upload landed is a broken image on somebody else's
 * phone. The row is therefore enqueued into the *outbox* only once the upload
 * has succeeded, which also puts it back under the ordering guarantees the
 * outbox exists to provide.
 *
 * The reverse failure — an object with no row — is the one this accepts. It
 * costs a few hundred KB in a bucket nobody reads, is scoped to the owner's
 * own folder, and is invisible; a sweep can collect them later.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { backoffMs } from './backoff';
import { enqueue, type SendOutcome } from './outbox';
import { projectRef } from '../lib/supabase';

export type MediaEntry = {
  /** Client-minted, and the primary key of the row this becomes. */
  id: string;
  taskId: string;
  /** Where the file is on this device. Copied out of the picker's cache dir. */
  localUri: string;
  /** The object name in the bucket: `<owner>/<task>/<media>.jpg`. */
  path: string;
  width: number;
  height: number;
  at: number;
  tries: number;
  nextAt: number;
  lastError?: string;
};

/**
 * The seam between this queue and Supabase Storage. `ownerId` is asked per
 * drain rather than injected once, for the reason the outbox gives: the
 * session can arrive long after the photo did.
 */
export type MediaTransport = {
  ownerId(): string | null;
  upload(entry: MediaEntry): Promise<SendOutcome>;
};

const KEY = 'rally:media:v1';
const VERSION = 1;
/** Matches the outbox: the tap path is synchronous, the disk write is not. */
const DEBOUNCE_MS = 400;
const DEAD_MAX = 20;

let queue: MediaEntry[] = [];
let dead: MediaEntry[] = [];
let inFlight: string | null = null;
let running: Promise<void> | null = null;
let hydrated = false;
let owner: string | null = null;

// ─── persistence ──────────────────────────────────────────────────────────

type Envelope = {
  version: number;
  backend: string | null;
  owner: string | null;
  entries: MediaEntry[];
  dead: MediaEntry[];
};

let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

async function write(): Promise<void> {
  const envelope: Envelope = {
    version: VERSION,
    backend: projectRef(),
    owner,
    entries: queue,
    dead,
  };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(envelope));
  } catch {
    // Quota, disk full, whatever. The photo is still in memory and still
    // uploads; a failed write must never take down the tap that caused it.
  }
}

function schedule(): void {
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    dirty = false;
    void write();
  }, DEBOUNCE_MS);
}

/** Write now. Called when the app backgrounds, beside the outbox's flush. */
export function flushMedia(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!dirty) return Promise.resolve();
  dirty = false;
  return write();
}

const entryIsSound = (v: unknown): v is MediaEntry => {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<MediaEntry>;
  return (
    typeof e.id === 'string' &&
    typeof e.taskId === 'string' &&
    typeof e.localUri === 'string' &&
    typeof e.path === 'string' &&
    Number.isFinite(e.at) &&
    Number.isFinite(e.tries) &&
    Number.isFinite(e.nextAt)
  );
};

/**
 * Once per process, like the outbox's. Re-hydrating a second time would merge
 * every restored entry back in under a fresh id and upload each photo twice.
 */
export async function hydrateMedia(): Promise<void> {
  if (hydrated) return;
  hydrated = true;

  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    const envelope = JSON.parse(raw) as Partial<Envelope>;
    // A queue written against another project addresses a bucket this one
    // does not have. Same escape as the outbox and the state payload.
    const ref = projectRef();
    const foreign = typeof envelope?.backend === 'string' && !!ref && envelope.backend !== ref;
    if (envelope?.version !== VERSION || foreign) return;

    owner = typeof envelope.owner === 'string' ? envelope.owner : null;
    const stored = (Array.isArray(envelope.entries) ? envelope.entries : []).filter(entryIsSound);
    // Restored work is older than anything enqueued since launch, so it goes
    // in front — the same reasoning the outbox applies to its seq.
    queue = [...stored, ...queue];
    dead = (Array.isArray(envelope.dead) ? envelope.dead : []).filter(entryIsSound).slice(-DEAD_MAX);
  } catch {
    // Truncated or corrupt. Anything enqueued since launch is still in memory.
  }
}

// ─── enqueue ──────────────────────────────────────────────────────────────

/**
 * Record a photo the user has attached. Synchronous and cheap: it is on the
 * tap path, so the only work here is array surgery.
 *
 * One photo per task is the v1 rule and the table enforces it, so a second
 * attach replaces a first that has not left the device — otherwise the upload
 * would land and the row insert behind it would collide with itself forever.
 */
export function enqueueMedia(entry: Omit<MediaEntry, 'at' | 'tries' | 'nextAt'>): void {
  const at = Date.now();
  const open = queue.find((e) => e.taskId === entry.taskId && e.id !== inFlight);
  if (open) queue = queue.filter((e) => e !== open);
  queue.push({ ...entry, at, tries: 0, nextAt: at });
  schedule();
  announce();
}

/**
 * The task is gone, so the photo is not going anywhere.
 *
 * Called when a `task.delete` is enqueued. The row would cascade server-side
 * anyway, but the upload would still spend a phone's radio on a file nothing
 * will ever point at. An in-flight entry is left alone — it is already on the
 * wire, and the object it writes is collectable by the same sweep that
 * collects any other orphan.
 */
export function dropMediaFor(taskId: string): void {
  const before = queue.length;
  queue = queue.filter((e) => e.taskId !== taskId || e.id === inFlight);
  if (queue.length !== before) schedule();
}

export const pendingMedia = (): MediaEntry[] => queue.map((e) => ({ ...e }));
export const deadMedia = (): MediaEntry[] => dead.map((e) => ({ ...e }));

/** How many photos the server has permanently refused. Feeds the same banner. */
export const unsavedMediaCount = (): number => dead.length;

const listeners = new Set<() => void>();

export function onMediaChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const announce = (): void => {
  for (const fn of listeners) fn();
};

// ─── drain ────────────────────────────────────────────────────────────────

/**
 * Upload what is due, oldest first, one at a time.
 *
 * Serial *within this lane* — a phone uploading three photos at once is three
 * slow uploads rather than one quick one — but it holds nothing else up,
 * which is the whole point of the lane existing.
 *
 * Single-flight, like `drain`: a second call while one is in progress joins
 * the first rather than starting a second pass over the same entries.
 */
export function drainMedia(transport: MediaTransport, now: number = Date.now()): Promise<void> {
  if (running) return running;
  running = run(transport, now).finally(() => {
    running = null;
  });
  return running;
}

async function run(transport: MediaTransport, now: number): Promise<void> {
  if (queue.length === 0) return;

  const ownerId = transport.ownerId();
  if (!ownerId) return;
  // A queue that outlived its author uploads into a folder that is no longer
  // the caller's — the storage policy would refuse it, but the check belongs
  // here for the reason the outbox gives: hydration can beat the session.
  if (owner && owner !== ownerId) {
    await clearMedia();
    return;
  }
  if (owner !== ownerId) {
    owner = ownerId;
    schedule();
  }

  let changed = false;
  let refused = false;
  try {
    while (queue.length) {
      const head = queue[0];
      if (head.nextAt > now) break;

      inFlight = head.id;
      let outcome: SendOutcome;
      try {
        outcome = await transport.upload(head);
      } catch (err) {
        // A transport that throws rather than reports has failed in a way it
        // did not anticipate, which is not the server refusing.
        outcome = { ok: false, permanent: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        inFlight = null;
      }

      const at = queue.findIndex((e) => e.id === head.id);
      if (at === -1) break;
      changed = true;

      if (!outcome.ok && !outcome.permanent) {
        head.tries += 1;
        head.lastError = outcome.error;
        head.nextAt = now + backoffMs(head.tries);
        // Unlike the outbox, this does *not* block what is behind it: these
        // entries have no relationship to each other, so one phone photo
        // failing must not strand the next.
        queue = [...queue.slice(1), head];
        break;
      }

      queue.splice(at, 1);

      if (!outcome.ok) {
        head.lastError = outcome.error;
        dead.push(head);
        if (dead.length > DEAD_MAX) dead = dead.slice(-DEAD_MAX);
        refused = true;
        continue;
      }

      // Landed. Only now does the row that points at it become the outbox's
      // problem — see this file's header for why that order is load-bearing.
      enqueue('media.attach', `media:${head.id}`, {
        mediaId: head.id,
        taskId: head.taskId,
        path: head.path,
        width: head.width,
        height: head.height,
      });
    }
  } finally {
    if (changed) schedule();
  }

  if (refused) announce();
}

/**
 * Forget every photo waiting to go. Called when the account is reset or the
 * identity changes, for the reason `clearOutbox` is: work queued as one person
 * must never be sent as another.
 */
export async function clearMedia(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  dirty = false;
  const hadDead = dead.length > 0;
  queue = [];
  dead = [];
  inFlight = null;
  owner = null;
  if (hadDead) announce();
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // The in-memory queue is already empty, which is the half that would
    // otherwise still reach the network.
  }
}

/** Test seam — the module holds the queue and the timer across a suite. */
export function __resetMediaForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  dirty = false;
  hydrated = false;
  queue = [];
  dead = [];
  inFlight = null;
  owner = null;
  running = null;
  listeners.clear();
}
