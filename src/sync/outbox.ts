/**
 * Mutations that have happened locally and have not reached the server yet.
 *
 * The reducer has already applied every one of these; the queue is a record of
 * what the server still owes us, not a request the UI is waiting on. Two things
 * follow from that and shape everything below.
 *
 * **The outbox never rolls the reducer back.** When the server refuses a row
 * permanently the entry is moved to a dead list and dropped. Deleting a task
 * the user staked because a policy said 42501 is a far worse outcome than the
 * two copies quietly disagreeing until the next reconcile.
 *
 * **`drain()` is called, never scheduled.** Nothing in this file owns a timer,
 * so every test here runs on real time and finishes in milliseconds. The
 * question of *when* to drain is `scheduler.ts`, which is fifteen lines and one
 * fake-timer test.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { backoffMs } from './backoff';
import { projectRef } from '../lib/supabase';

export type OutboxOp =
  | 'task.upsert'
  | 'task.delete'
  | 'reaction.add'
  | 'reaction.remove'
  | 'note.add'
  | 'profile.update'
  | 'device.register';

export type OutboxEntry = {
  /** Client-minted, and the idempotency key the transport should send. */
  id: string;
  /** Monotonic. The only ordering authority — `at` is a wall clock and lies. */
  seq: number;
  op: OutboxOp;
  /** Coalescing key, e.g. `task:<uuid>`. Two entries sharing one are the same row. */
  key: string;
  /** No `owner_id`. See `drain` — identity is stamped at send time. */
  payload: Record<string, unknown>;
  /** Client wall clock at enqueue; doubles as the last-write-wins timestamp. */
  at: number;
  tries: number;
  nextAt: number;
  lastError?: string;
};

export type OutboxStats = { sent: number; failed: number; dead: number };

/**
 * The seam between the queue and Supabase. `ownerId` is asked once per drain
 * rather than injected once at construction, because the session can arrive
 * long after the mutations did.
 */
export type QueueTransport = {
  /** Null when there is no session yet. Nothing sends until there is one. */
  ownerId(): string | null;
  /**
   * Reports the outcome rather than throwing it. Whether a refusal is worth
   * retrying is a judgement about the wire — SQLSTATEs, HTTP statuses, whether
   * a token can be refreshed — and the transport already has to make it. This
   * used to be re-derived here from a thrown code, which meant two lists of
   * permanent SQLSTATEs that had to agree, on the one path where disagreeing
   * either retries forever or silently drops a tap the user watched land.
   */
  send(op: OutboxOp, payload: Record<string, unknown>, entry: OutboxEntry): Promise<SendOutcome>;
};

export type SendOutcome =
  | { ok: true }
  /** `permanent` means no future attempt can succeed: retrying is a loop. */
  | { ok: false; permanent: boolean; error: string };

/**
 * Its own key, deliberately not a slice of `rally:state:v1`. `isSound()` over
 * there discards the entire state payload on any single failure, and a
 * malformed `history` array eating six unsent mutations would be a data loss
 * caused entirely by where they were stored.
 */
const KEY = 'rally:outbox:v1';
const VERSION = 1;
/** Matches persistence.ts. Enqueue is on the tap path; the disk write is not. */
const DEBOUNCE_MS = 400;
/** Only ever read by a debug screen, so a bounded tail is all it needs to be. */
const DEAD_MAX = 50;

const OPS: readonly OutboxOp[] = [
  'task.upsert',
  'task.delete',
  'reaction.add',
  'reaction.remove',
  'note.add',
  'profile.update',
  'device.register',
];

// ─── module state ─────────────────────────────────────────────────────────

let queue: OutboxEntry[] = [];
let dead: OutboxEntry[] = [];
let nextSeq = 1;
/**
 * Keys the server has confirmed. Read once, at delete-enqueue time, to answer
 * "has this row ever left the device?". Pruned when the row is deleted, so it
 * tracks live tasks rather than growing forever — and it is never evicted by
 * size, because forgetting a key here silently drops a delete for a row the
 * server still holds.
 */
let acked = new Set<string>();
/** The entry currently awaiting the transport. It cannot be coalesced away. */
let inFlight: string | null = null;
let running: Promise<OutboxStats> | null = null;

// ─── persistence ──────────────────────────────────────────────────────────
//
// The debounce below is deliberately the same shape as persistence.ts rather
// than a shared helper: sharing one would mean changing that module, whose
// exported surface is pinned by a test suite that has no business failing over
// a change to the outbox.

/**
 * `backend` and `owner` answer "whose queue is this", which the entries alone
 * cannot. `owner_id` is stamped per send rather than at enqueue — see `run()` —
 * so a queue restored after the account changed would go out under the new
 * name, attributing one person's week to another. Null owner means never
 * drained, which is the plane case and still sends.
 */
type Envelope = {
  version: number;
  backend: string | null;
  owner: string | null;
  entries: OutboxEntry[];
  dead: OutboxEntry[];
  acked: string[];
};

let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

/** The account this queue has been draining as, or null if it never has. */
let owner: string | null = null;

async function write(): Promise<void> {
  const envelope: Envelope = {
    version: VERSION,
    backend: projectRef(),
    owner,
    entries: queue,
    dead,
    acked: [...acked],
  };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(envelope));
  } catch {
    // Quota, disk full, whatever. A failed write must never take down the tap
    // that caused it; the mutation is still in memory and still sends.
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

/** Write now. Called when the app backgrounds, alongside persistence.flush(). */
export function flushOutbox(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!dirty) return Promise.resolve();
  dirty = false;
  return write();
}

function entryIsSound(v: unknown): v is OutboxEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<OutboxEntry>;
  return (
    typeof e.id === 'string' &&
    Number.isFinite(e.seq) &&
    OPS.includes(e.op as OutboxOp) &&
    typeof e.key === 'string' &&
    !!e.payload &&
    typeof e.payload === 'object' &&
    !Array.isArray(e.payload) &&
    Number.isFinite(e.at) &&
    Number.isFinite(e.tries) &&
    Number.isFinite(e.nextAt)
  );
}

/**
 * Unlike the state payload this discards *per entry*, not wholesale. One
 * corrupt row is not a reason to throw away five good mutations that the user
 * believes are already saved.
 */
/**
 * Once per process. The effect that calls this re-runs whenever sync flips on,
 * and it flips on again after any live -> demo -> live round trip — without
 * this, every restored entry is merged in a second time, with a fresh id and
 * seq, and a duplicate of an in-flight id also defeats the coalescing guard.
 */
let hydrated = false;

export async function hydrateOutbox(): Promise<void> {
  if (hydrated) return;
  hydrated = true;

  let stored: OutboxEntry[] = [];
  let storedDead: OutboxEntry[] = [];
  let storedAcked: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const envelope = JSON.parse(raw) as Partial<Envelope>;
      // A queue written against another project addresses rows that do not
      // exist here, under an id this project never issued. Same three escapes
      // as the state payload: an absent stamp predates the check, and an
      // unconfigured build cannot tell.
      const ref = projectRef();
      const foreign =
        typeof envelope?.backend === 'string' && !!ref && envelope.backend !== ref;
      if (envelope?.version === VERSION && !foreign) {
        owner = typeof envelope.owner === 'string' ? envelope.owner : null;
        stored = (Array.isArray(envelope.entries) ? envelope.entries : []).filter(entryIsSound);
        storedDead = (Array.isArray(envelope.dead) ? envelope.dead : []).filter(entryIsSound);
        storedAcked = (Array.isArray(envelope.acked) ? envelope.acked : []).filter(
          (k): k is string => typeof k === 'string',
        );
      }
    }
  } catch {
    // Truncated or corrupt. Nothing to restore; anything enqueued since launch
    // is still in memory below.
  }

  stored.sort((a, b) => a.seq - b.seq);

  // Hydration races a cold start: someone can stake a task before the read
  // resolves. Restored work is older by definition, so it goes in front and the
  // in-memory entries are re-numbered above it rather than colliding with it.
  const live = queue;
  nextSeq = (stored.length ? stored[stored.length - 1].seq : 0) + 1;
  for (const e of live) e.seq = nextSeq++;

  queue = [...stored, ...live];
  dead = storedDead.slice(-DEAD_MAX);
  acked = new Set(storedAcked);
  // A refusal from a previous launch is still a refusal. The envelope carries
  // `dead`, so the notice has to come back with it rather than only ever
  // appearing in the session that earned it.
  if (dead.length > 0) announce();
}

// ─── enqueue ──────────────────────────────────────────────────────────────

const isFree = (e: OutboxEntry) => e.id !== inFlight;

/**
 * Record a mutation the reducer has already applied. Synchronous and cheap: it
 * sits on the tap path, so the only work here is array surgery.
 */
export function enqueue(op: OutboxOp, key: string, payload: Record<string, unknown>): void {
  const at = Date.now();

  if (op === 'task.delete') {
    const pendingUpsert = queue.some((e) => e.key === key && e.op === 'task.upsert');
    const busy = queue.some((e) => e.key === key && !isFree(e));
    queue = queue.filter((e) => !(e.key === key && e.op === 'task.upsert' && isFree(e)));

    // Staked and unstaked before either ever reached the server: the row exists
    // nowhere but in the reducer, so there is nothing to tell anyone about. An
    // in-flight upsert breaks the tie — the server may be learning about it
    // right now, so the delete has to follow it.
    if (pendingUpsert && !busy && !acked.has(key)) {
      schedule();
      return;
    }
  }

  if (op === 'reaction.remove') {
    const pendingAdd = queue.some((e) => e.key === key && e.op === 'reaction.add');
    const busy = queue.some((e) => e.key === key && !isFree(e));
    queue = queue.filter((e) => !(e.key === key && e.op === 'reaction.add' && isFree(e)));

    // Cheered and un-cheered before either left the device. Both entries go:
    // the delete would otherwise match on a tuple no row has, and — worse — an
    // add that outlives its own cancellation puts a cheer on someone's phone
    // that this device is no longer showing.
    //
    // No `acked` check, unlike task.delete: the unique tuple is the row's whole
    // identity, so a pending add is proof the server has not been told. An
    // in-flight one is not, and the delete has to follow it.
    if (pendingAdd && !busy) {
      schedule();
      return;
    }
  }

  // Same row, same op, not yet on the wire: the newer payload is the whole
  // truth about that row, so it replaces the older one. The seq stays, because
  // moving it to the back would let a later edit overtake a create it depends
  // on. `tries`/`nextAt` stay too — coalescing must not be a way to dodge a
  // backoff the server just asked for.
  //
  // Notes are exempt. The key is the note's own primary key, so two entries
  // sharing one are the same insert rather than two versions of a row, and a
  // note is never edited — saying the same thing twice is a second note.
  const open =
    op === 'note.add' ? undefined : queue.find((e) => e.key === key && e.op === op && isFree(e));
  if (open) {
    open.payload = payload;
    open.at = at;
    schedule();
    return;
  }

  queue.push({
    id: randomUUID(),
    seq: nextSeq++,
    op,
    key,
    payload,
    at,
    tries: 0,
    nextAt: at,
  });
  schedule();
}

/**
 * Rows this device has watched reach the server.
 *
 * Reconcile needs it to tell "another device deleted this" from "this never
 * got there at all" — a dead-lettered upsert, or a row belonging to a session
 * that has since been replaced. Only the first of those justifies deleting the
 * user's copy.
 */
export function ackedTaskIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const key of acked) {
    if (key.startsWith('task:')) ids.add(key.slice('task:'.length));
  }
  return ids;
}

export function pending(): OutboxEntry[] {
  return queue.map((e) => ({ ...e }));
}

/** Permanently refused. Kept so a debug screen can say what went wrong. */
export function deadLetters(): OutboxEntry[] {
  return dead.map((e) => ({ ...e }));
}

/**
 * How many distinct things the server has permanently refused.
 *
 * Counted by `key` rather than by entry, because the key is the row and the
 * entry is the attempt: a task written and then deleted is two ops about one
 * thing, and telling someone two of their tasks never saved when one did would
 * be its own small lie.
 */
export function unsavedCount(): number {
  return new Set(dead.map((e) => e.key)).size;
}

/**
 * Acknowledged. The list is diagnostic — the row itself lives in the reducer
 * and is untouched by this — so forgetting it costs nothing but the notice.
 *
 * There has to be a way to do this. The condition is permanent by definition
 * and survives relaunches in the envelope, so a banner with no way to dismiss
 * it would be a banner for the life of the install.
 */
export async function forgetDeadLetters(): Promise<void> {
  if (dead.length === 0) return;
  dead = [];
  announce();
  schedule();
}

/**
 * Who wants to know when the dead list changes.
 *
 * The same shape as `onSessionChange`, and for the same reason: the fact lives
 * in a module, the screen that shows it lives in React, and polling for it
 * would mean a timer for something that changes a handful of times a year.
 */
const listeners = new Set<() => void>();

export function onOutboxChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function announce(): void {
  for (const fn of listeners) fn();
}

// ─── drain ────────────────────────────────────────────────────────────────

type Verdict = 'ok' | 'retry' | 'drop';

const messageOf = (err: unknown): string => {
  if (!err) return 'unknown';
  if (typeof err === 'object') {
    const e = err as { message?: string; code?: string };
    return e.message ?? e.code ?? 'unknown';
  }
  return String(err);
};

/**
 * Send what is due, oldest first, one at a time.
 *
 * Strictly serial and head-of-line blocking. Two mutations of the same row in
 * parallel would land in whichever order the network felt like, and a create
 * that has not been acked yet is a foreign key the update behind it depends on.
 *
 * Single-flight: a second call while one is in progress joins the first rather
 * than starting a second pass over the same entries.
 */
export function drain(transport: QueueTransport, now: number = Date.now()): Promise<OutboxStats> {
  if (running) return running;
  running = run(transport, now).finally(() => {
    running = null;
  });
  return running;
}

async function run(transport: QueueTransport, now: number): Promise<OutboxStats> {
  const stats: OutboxStats = { sent: 0, failed: 0, dead: 0 };
  if (queue.length === 0) return stats;

  // Identity is resolved here and stamped per send, never written at enqueue.
  // That is what lets someone stake ten tasks on a plane, before this install
  // has ever held a session, and have all ten land under the right owner later.
  const ownerId = transport.ownerId();
  if (!ownerId) return stats;

  // …and it is also why the queue has to be checked against the account it was
  // drained as. Stamping at send time means a queue that outlived its author
  // does not fail — it succeeds, under the wrong name, filing one person's week
  // as another's. The store clears the queue on an identity change too, but
  // hydration can beat the session resolving, so the guard has to be here as
  // well. A null owner has never been drained: that is the plane, and it sends.
  if (owner && owner !== ownerId) {
    await clearOutbox();
    return stats;
  }
  if (owner !== ownerId) {
    owner = ownerId;
    schedule();
  }

  let changed = false;
  try {
    while (queue.length) {
      const head = queue[0];
      if (head.nextAt > now) break;

      inFlight = head.id;
      let verdict: Verdict = 'ok';
      let failure: unknown = null;
      try {
        const outcome = await transport.send(
          head.op,
          { ...head.payload, owner_id: ownerId },
          head,
        );
        if (!outcome.ok) {
          failure = outcome.error;
          verdict = outcome.permanent ? 'drop' : 'retry';
        }
      } catch (err) {
        // A transport that throws rather than reports has failed in a way it
        // did not anticipate, which is not the same as the server refusing.
        failure = err;
        verdict = 'retry';
      } finally {
        inFlight = null;
      }

      // An enqueue can land during the await. It can never touch the in-flight
      // entry — `isFree` sees to that — but locating by id rather than by index
      // keeps that guarantee inside one function instead of two.
      const at = queue.findIndex((e) => e.id === head.id);
      if (at === -1) break;
      changed = true;

      if (verdict === 'retry') {
        head.tries += 1;
        head.lastError = messageOf(failure);
        head.nextAt = now + backoffMs(head.tries);
        stats.failed += 1;
        // Everything behind it waits. Order is the point of the queue.
        break;
      }

      queue.splice(at, 1);

      if (verdict === 'drop') {
        head.lastError = messageOf(failure);
        dead.push(head);
        if (dead.length > DEAD_MAX) dead = dead.slice(-DEAD_MAX);
        stats.dead += 1;
        // Somebody's week just stopped matching the server. Announced here
        // rather than after the loop so a drain that drops several still says
        // so once per drop, and the screen never has to poll for it.
        announce();
        // Deliberately no rollback and deliberately no `break`: the entry is
        // gone, so the row behind it is no longer blocked by it.
        continue;
      }

      // Only tasks. `acked` answers one question — has this row ever left the
      // device? — and only `task.delete` asks it. A reaction's tuple is its own
      // answer, and a note is never deleted at all.
      if (head.op === 'task.upsert') acked.add(head.key);
      else if (head.op === 'task.delete') acked.delete(head.key);
      stats.sent += 1;
    }
  } finally {
    if (changed) schedule();
  }

  return stats;
}

/** Test seam — the module holds the queue, the seq and the timer across a suite. */
/**
 * Forget everything queued, and the record of what has been sent.
 *
 * Called when the account is reset. "This clears everything you've done and
 * starts over" has to include work the device has not managed to send yet:
 * without this, a task the user staked and then erased is uploaded minutes
 * later, and the dead list keeps its title on disk indefinitely.
 */
export async function clearOutbox(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  dirty = false;
  const hadDead = dead.length > 0;
  queue = [];
  dead = [];
  acked = new Set();
  nextSeq = 1;
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

export function __resetOutboxForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  dirty = false;
  hydrated = false;
  queue = [];
  dead = [];
  acked = new Set();
  nextSeq = 1;
  inFlight = null;
  owner = null;
  running = null;
}
