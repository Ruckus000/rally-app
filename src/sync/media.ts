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
 *
 * ─── the second phase ─────────────────────────────────────────────────────
 *
 * An entry is not finished when its bytes land. A goal photo has to get past
 * the screener before anybody else can fetch it — see
 * `20260820020000_task_media_screened.sql` — and until it does, the row sits
 * `pending` and the storage policy refuses every reader but its owner.
 *
 * That call lives here rather than in the outbox for the reason the upload
 * does: it is slow, it is one round trip to a model, and it has no ordering
 * relationship to anything. Putting it in the ordered queue would make every
 * cheer behind it wait out an image being judged.
 *
 * The phase has to be persisted, not inferred, because the two failures look
 * identical from the outside: an entry that never uploaded and an entry that
 * uploaded and never got screened are both "an entry that is still here".
 * `phase` is what tells the drain which half it is resuming.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { backoffMs } from './backoff';
import { enqueue, type SendOutcome } from './outbox';
import { projectRef } from '../lib/supabase';

/**
 * Which half of the journey an entry is on: bytes to the bucket, then verdict
 * from the screener. An entry only ever moves forwards through these.
 */
export type MediaPhase = 'upload' | 'screen';

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
  phase: MediaPhase;
  at: number;
  tries: number;
  nextAt: number;
  lastError?: string;
};

/**
 * What the screener said, reduced to the three things this queue can do about
 * it.
 *
 * `retry` covers every answer that is not a verdict: the server's own
 * `waiting` — the row has not been written yet, because the outbox is behind —
 * an offline phone, a 500, and any shape this client does not recognise. They
 * are one case here because the response to all of them is the same, and
 * because the alternative is worse: a photo is only ever deleted off
 * somebody's device on an explicit `refused`, never on a reply that could not
 * be read.
 */
export type ScreenOutcome =
  | { state: 'ready' }
  | { state: 'refused' }
  | { state: 'retry'; error?: string };

/**
 * The seam between this queue and Supabase. `ownerId` is asked per drain
 * rather than injected once, for the reason the outbox gives: the session can
 * arrive long after the photo did.
 */
export type MediaTransport = {
  ownerId(): string | null;
  upload(entry: MediaEntry): Promise<SendOutcome>;
  screen(entry: MediaEntry): Promise<ScreenOutcome>;
};

const KEY = 'rally:media:v1';
const VERSION = 1;
/** Matches the outbox: the tap path is synchronous, the disk write is not. */
const DEBOUNCE_MS = 400;
const DEAD_MAX = 20;
/**
 * How long an entry waits after its upload before asking for a verdict.
 *
 * The screener needs the `task_media` row, and that row is written by the
 * *outbox*, which drains on its own schedule. Asking the instant the bytes
 * land would usually reach the server before the row does and spend a round
 * trip being told `waiting`. This is not a correctness device — `retry` and
 * the backoff behind it are — it just makes the common case cost one call
 * instead of two.
 */
const SCREEN_AFTER_MS = 2_500;
/**
 * How many times a photo asks for a verdict before the lane stops asking.
 *
 * Needed because one of the `retry` cases is not transient. The screener
 * answers `waiting` while the `task_media` row is missing, and the row is the
 * *outbox's* to write — so an attach that dead-letters there leaves this entry
 * asking a question that will never have a different answer. With the backoff
 * saturated at a minute, an unbounded lane would spend one edge-function call
 * a minute on it for as long as the app is installed.
 *
 * Thirty is far past any real outage and still terminates in half an hour.
 * What is given up on lands in `dead` beside a photo the bucket refused,
 * which is the honest place for it: from the owner's side both mean the
 * picture is on their phone and on nobody else's.
 */
const SCREEN_MAX_TRIES = 30;

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
 * `phase` is not in `entryIsSound`, and the envelope version is not bumped.
 *
 * Both are the same decision. A build shipped before screening existed wrote
 * entries with no `phase` at all, and those entries are photos somebody is
 * waiting on. Rejecting them — or discarding the envelope over the version —
 * would silently drop a queued photo on upgrade, which is a worse outcome
 * than the thing the version check exists to prevent.
 *
 * Anything unrecognised reads as `upload`, which is the safe direction: an
 * entry that had in fact uploaded gets uploaded again, and the object write
 * is an idempotent upsert to the same name. The reverse default would skip
 * the upload and ask for a verdict on bytes that were never sent.
 */
const phaseOf = (v: unknown): MediaPhase => (v === 'screen' ? 'screen' : 'upload');

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
    const stored = (Array.isArray(envelope.entries) ? envelope.entries : [])
      .filter(entryIsSound)
      .map((e) => ({ ...e, phase: phaseOf(e.phase) }));
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
export function enqueueMedia(entry: Omit<MediaEntry, 'at' | 'tries' | 'nextAt' | 'phase'>): void {
  const at = Date.now();
  const open = queue.find((e) => e.taskId === entry.taskId && e.id !== inFlight);
  if (open) queue = queue.filter((e) => e !== open);
  queue.push({ ...entry, phase: 'upload', at, tries: 0, nextAt: at });
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

const blockedListeners = new Set<(entry: MediaEntry) => void>();

/**
 * A photo the screener refused.
 *
 * Separate from `onMediaChange` because it is a different kind of news and
 * has a different subscriber. `onMediaChange` says "the count changed" and is
 * for a banner; this hands over the entry itself, because whoever listens has
 * to take the photo off the task, delete the file, and say so — none of which
 * can be done from a count.
 *
 * The server has already deleted the object and the row by the time this
 * fires. What is left is entirely local.
 */
export function onMediaBlocked(fn: (entry: MediaEntry) => void): () => void {
  blockedListeners.add(fn);
  return () => {
    blockedListeners.delete(fn);
  };
}

// ─── drain ────────────────────────────────────────────────────────────────

/**
 * Move what is due one step forward, oldest first, one at a time.
 *
 * Serial *within this lane* — a phone uploading three photos at once is three
 * slow uploads rather than one quick one — but it holds nothing else up,
 * which is the whole point of the lane existing.
 *
 * "One step" rather than "upload": an entry that lands its bytes moves to the
 * screening phase and goes to the back rather than leaving, so a photo behind
 * it starts uploading while this one waits on a verdict.
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
  const blocked: MediaEntry[] = [];
  try {
    while (queue.length) {
      const head = queue[0];
      if (head.nextAt > now) break;

      // Held across both phases: `enqueueMedia` and `dropMediaFor` use it to
      // leave alone an entry that is already on the wire, and a screening call
      // is as much on the wire as an upload is.
      inFlight = head.id;
      let outcome: SendOutcome | undefined;
      let verdict: ScreenOutcome | undefined;
      try {
        if (head.phase === 'upload') {
          outcome = await transport.upload(head);
        } else {
          verdict = await transport.screen(head);
        }
      } catch (err) {
        // A transport that throws rather than reports has failed in a way it
        // did not anticipate, which is not the server refusing.
        const error = err instanceof Error ? err.message : String(err);
        if (head.phase === 'upload') outcome = { ok: false, permanent: false, error };
        else verdict = { state: 'retry', error };
      } finally {
        inFlight = null;
      }

      const at = queue.findIndex((e) => e.id === head.id);
      if (at === -1) break;
      changed = true;

      if (outcome) {
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

        if (!outcome.ok) {
          queue.splice(at, 1);
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

        // Not finished: the bytes are there and nobody but the owner may read
        // them yet. `tries` restarts because the two phases fail for unrelated
        // reasons, and an upload that took four attempts on a bad train should
        // not start its screening on a minute-long backoff.
        head.phase = 'screen';
        head.tries = 0;
        head.lastError = undefined;
        head.nextAt = now + SCREEN_AFTER_MS;
        queue = [...queue.slice(1), head];
        continue;
      }

      if (verdict!.state === 'retry') {
        head.tries += 1;
        head.lastError = verdict!.error;

        if (head.tries >= SCREEN_MAX_TRIES) {
          queue.splice(at, 1);
          dead.push(head);
          if (dead.length > DEAD_MAX) dead = dead.slice(-DEAD_MAX);
          refused = true;
          continue;
        }

        head.nextAt = now + backoffMs(head.tries);
        queue = [...queue.slice(1), head];
        break;
      }

      queue.splice(at, 1);

      // `ready` needs nothing done. The row is readable, and the local file
      // stays exactly where it is — it is what the owner's own screen draws
      // from, and always was.
      if (verdict!.state === 'refused') blocked.push(head);
    }
  } finally {
    if (changed) schedule();
  }

  if (refused) announce();
  // After the queue is settled and written, so a listener that dispatches —
  // and every one of them does — cannot see a half-updated lane.
  for (const entry of blocked) {
    for (const fn of blockedListeners) fn(entry);
  }
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
  blockedListeners.clear();
}
