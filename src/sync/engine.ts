/**
 * The part that decides *what* to send, and folds *what came back* into state.
 *
 * It holds no React state, on purpose. `StoreProvider`'s context is
 * `useMemo(..., [state, config])`, so a `setState` on a poll tick would
 * re-render every screen in the app on a timer, forever, for nothing. Refs and
 * module state only, and at most one batched `SERVER_MERGE` per cycle — which
 * the reducer already bails out of by identity when the rows changed nothing.
 *
 * There is no middleware seam in the store to hang this off, and adding one
 * would put sync logic on the synchronous path between a tap and a render.
 * Instead `observe(state)` runs on every state change — the same cadence as the
 * existing `save(state)` effect — and diffs the durable slices by *reference*.
 * That is reliable for exactly the reason `unchanged()` in persistence.ts is
 * reliable: every reducer branch builds its result immutably, so an object that
 * is identical is a row that was not touched.
 */
import type { Dispatch } from 'react';
import type { Note, Task } from '../data/fixtures';
import type { PersonId } from '../data/people';
import type { WeekContext } from '../data/week';
import type { Action, ServerMerge, State } from '../state/store';
import { mondayOf } from './mappers';
import { noteKey, syncableNote, type NoteSite, type SyncableNote } from './notes';
import {
  ackedTaskIds,
  drain,
  enqueue,
  pending,
  type OutboxEntry as QueueEntry,
  type OutboxOp,
  type QueueTransport,
} from './outbox';
import { diffActed, reactionKey, type Acted, type ReactionKind } from './reactions';
import { syncRealtime, stopRealtime } from './realtime';
import { reconcileTasks } from './reconcile';
import { startScheduler, stopScheduler } from './scheduler';
import { currentUserId, onSessionChange } from './session';
import { supabaseTransport, type WireOp as WireEntry, type Transport } from './transport';

/** How often the queue is offered to the network. Matches scheduler.ts's own default. */
const PUSH_MS = 5_000;
/**
 * Pulls are far rarer than pushes: the circle changes when somebody joins, your
 * own week changes when your other phone touches it, and every tick costs a
 * round trip on a phone radio. Foregrounding kicks one anyway, which is when a
 * stale directory or a week edited elsewhere is actually visible.
 */
const PULL_MS = 60_000;

export type Engine = {
  /** Called on every state change. Cheap, synchronous, and never dispatches. */
  observe(state: State): void;
  start(): void;
  stop(): void;
  /** Foreground, or a session arriving: worth an attempt now rather than in five seconds. */
  kick(): void;
};

export type EngineOptions = {
  transport?: Transport;
  pushEveryMs?: number;
  pullEveryMs?: number;
};

/**
 * The outbox classifies failure by SQLSTATE and HTTP status; the transport has
 * already made that decision. Rather than re-deriving it, a refusal is re-thrown
 * in the shape `verdictFor` reads — a permanent one as a 4xx, which it drops,
 * and a transient one as a bare message, which it retries.
 */

/**
 * The queue stores `{ task, weekStart }` rather than a finished row, so the
 * mapping to columns happens once, at send time, in the one module that knows
 * what the wire looks like. `weekStart` is resolved at enqueue time all the
 * same: a task queued on a Sunday must not drift into next week while it waits.
 */
function wireEntry(op: OutboxOp, payload: Record<string, unknown>, entry: QueueEntry): WireEntry {
  const head = { id: entry.id, at: entry.at };
  switch (op) {
    case 'task.upsert':
      return {
        ...head,
        op,
        task: payload.task as Task,
        weekStart: String(payload.weekStart),
      };
    case 'task.delete':
      return { ...head, op, taskId: String(payload.taskId) };
    case 'reaction.add':
    case 'reaction.remove':
      return { ...head, op, targetId: String(payload.targetId), kind: payload.kind as ReactionKind };
    case 'note.add':
      return { ...head, op, note: payload.note as SyncableNote };
  }
}

function queueTransport(wire: Transport): QueueTransport {
  return {
    // Asked per drain, never captured: the session can arrive long after the
    // mutations did, and ten tasks staked on a plane still have to land under
    // whoever this install turns out to be.
    ownerId: () => currentUserId(),

    async send(op, payload, entry) {
      // `drain` stamped this from the session it just resolved. Reading it back
      // keeps identity in one place rather than asking the session twice and
      // risking a different answer mid-drain.
      const owner = String(payload.owner_id ?? '');
      const result = await wire.push(wireEntry(op, payload, entry), owner);
      // A straight relabelling. The transport already decided whether another
      // attempt could ever help; this used to throw so the queue could work it
      // out again from a code, which meant the same judgement written twice.
      return result.ok ? { ok: true } : { ok: false, permanent: !result.retryable, error: result.error };
    },
  };
}

/** `task:<uuid>` — the coalescing key `observe` enqueues under. */
const TASK_KEY = 'task:';

/**
 * The rows the queue still owes the server, by id.
 *
 * `reconcileTasks` needs this to know which local rows a pull may not touch,
 * and the outbox is the only honest source for it: an entry is dirty for
 * exactly as long as it is queued. Derived on demand rather than tracked, so
 * there is never a stale second copy to disagree with the queue.
 */
export function dirtyTaskIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of pending()) {
    if (entry.key.startsWith(TASK_KEY)) ids.add(entry.key.slice(TASK_KEY.length));
  }
  return ids;
}

const index = (tasks: Task[]): Map<string, Task> => {
  const byId = new Map<string, Task>();
  for (const t of tasks) byId.set(t.id, t);
  return byId;
};

/** A note the reducer stored, and what it was stored against. */
type PlacedNote = { note: Note; site: NoteSite; targetId: string };

/**
 * Every note this device could be asked to send, with the branch it took.
 *
 * `globalNotes` is deliberately absent rather than collected and rejected: a
 * public post has no table, permanently, so walking it would be work done every
 * observation to reach the same `null` — and `syncableNote` already answers
 * `globalPost` that way if a caller ever does hand it one.
 */
function placedNotes(state: State): PlacedNote[] {
  const out: PlacedNote[] = [];
  for (const [who, notes] of Object.entries(state.personNotes) as [PersonId, Note[] | undefined][]) {
    for (const note of notes ?? []) out.push({ note, site: 'person', targetId: who });
  }
  for (const task of state.myTasks) {
    for (const note of task.cmts) out.push({ note, site: 'ownTask', targetId: task.id });
  }
  for (const moment of state.moments) {
    for (const note of moment.cmts ?? []) out.push({ note, site: 'moment', targetId: moment.id });
  }
  return out;
}

export function createEngine(
  dispatch: Dispatch<Action>,
  { transport, pushEveryMs = PUSH_MS, pullEveryMs = PULL_MS }: EngineOptions = {},
): Engine {
  const wire = transport ?? supabaseTransport();
  const queue = queueTransport(wire);

  /**
   * What the last observation saw, by id. `null` until the first one, which is
   * seeded rather than diffed: on launch every task looks new, and re-sending
   * the whole week on every cold start would be pointless traffic. Nothing is
   * lost by it — the outbox is the record of unsent work, and it is restored
   * from disk, not re-derived from the diff.
   */
  let seen: Map<string, Task> | null = null;
  let lastTasks: Task[] | null = null;
  /** `acted` as the last observation saw it. Diffed by `diffActed`, not by key. */
  let lastActed: Acted = {};
  /**
   * Every note id this device has already accounted for — sent, or judged
   * unsendable. A note is append-only and never edited, so an id that has been
   * seen once can never become news again, and this is the whole diff.
   */
  let seenNotes: Set<string> = new Set();
  /** The two note-bearing slices `myTasks` does not cover. Reference-compared. */
  let lastPersonNotes: State['personNotes'] | null = null;
  let lastMoments: State['moments'] | null = null;
  /**
   * The week the last observation was showing. A pull has to name a week, and
   * the only week it may name is the one on screen: rows for any other week,
   * reconciled into `myTasks`, would drop every visible row the server has no
   * copy of under that key.
   */
  let lastWeek: WeekContext | null = null;
  /**
   * The row ids a merge just delivered, set immediately before dispatching it.
   * See `observe`.
   */
  let merging: Set<string> | null = null;
  let pullTimer: ReturnType<typeof setInterval> | null = null;
  let pulling = false;
  let unsubscribeSession: (() => void) | null = null;

  function observe(state: State): void {
    const tasks = state.myTasks;
    const merged = merging;
    merging = null;
    // A rollover empties `acted`, and that is a week ending rather than the user
    // taking back every cheer they ever gave. Diffing across it would delete the
    // rows on the server — visibly, on other people's phones — so the new week's
    // `acted` is adopted instead. Compared by week number, because
    // `COMMIT_ROLLOVER` is the only thing that both moves the week and clears it.
    const rolled = lastWeek !== null && lastWeek.number !== state.week.number;
    lastWeek = state.week;

    if (seen === null) {
      seen = index(tasks);
      lastTasks = tasks;
      lastActed = state.acted;
      lastPersonNotes = state.personNotes;
      lastMoments = state.moments;
      for (const placed of placedNotes(state)) {
        if (placed.note.id) seenNotes.add(placed.note.id);
      }
      return;
    }

    // The blind spot of a reference diff, and the reason this flag exists: it
    // cannot tell "the user edited a title" from "a merge just applied one".
    // Unsuppressed, every merge would enqueue its own rows straight back and
    // two devices would ping-pong forever.
    //
    // So the rows the merge delivered are *adopted* rather than diffed —
    // but only those rows.
    //
    // A blanket "skip this whole observation" was the obvious version and it
    // is subtly lossy: if a tap lands in the same React commit as the merge,
    // one observation covers both, and the user's edit is adopted as though
    // the server had sent it. It is then never enqueued, and never sent until
    // that row happens to be touched again. Adopting by id instead means a tap
    // on any other row is still diffed and still queued, whatever React
    // decides to batch.
    if (merged) {
      for (const task of tasks) {
        if (merged.has(task.id)) seen.set(task.id, task);
      }
      for (const id of seen.keys()) {
        if (merged.has(id) && !tasks.some((t) => t.id === id)) seen.delete(id);
      }
    }

    const tasksMoved = tasks !== lastTasks;

    // Tasks first, and not only for tidiness: a note names a task by foreign
    // key, and the queue is strictly ordered, so an insert that arrives before
    // the row it points at is a permanent 23503.
    if (tasksMoved) {
      const weekStart = mondayOf(state.week);
      const next = index(tasks);

      for (const task of tasks) {
        // Identity, not equality: the reducer copies only the row it changed.
        if (seen.get(task.id) === task) continue;
        enqueue('task.upsert', `task:${task.id}`, { task, weekStart });
      }
      for (const id of seen.keys()) {
        if (!next.has(id)) enqueue('task.delete', `task:${id}`, { taskId: id });
      }

      seen = next;
    }

    // The same reference diff, one slice over. `acted` is replaced wholesale by
    // `ACT` and by nothing else, so an unchanged reference is proof no cheer
    // moved — and `diffActed` drops every key that does not name a real row,
    // which is most of them while the feed is still fixtures.
    if (state.acted !== lastActed) {
      if (!rolled) {
        const { added, removed } = diffActed(lastActed, state.acted);
        for (const ref of added) {
          enqueue('reaction.add', reactionKey(ref), { targetId: ref.targetId, kind: ref.kind });
        }
        for (const ref of removed) {
          enqueue('reaction.remove', reactionKey(ref), { targetId: ref.targetId, kind: ref.kind });
        }
      }
      lastActed = state.acted;
    }

    // Notes are append-only, so this is a set difference rather than a diff. The
    // walk is guarded by the three references that can carry one: a keystroke in
    // the composer moves `note`, not these, and must not cost a walk of every
    // thread on the device.
    if (tasksMoved || state.personNotes !== lastPersonNotes || state.moments !== lastMoments) {
      for (const { note, site, targetId } of placedNotes(state)) {
        // No id: a fixture, or a note restored from a payload written before the
        // id existed. It stays on screen and never becomes a row.
        if (!note.id || seenNotes.has(note.id)) continue;
        seenNotes.add(note.id);
        // Rejected here means rejected forever — a fixture target, a moment id
        // that is not yet a uuid, a public post. Recording the id above is what
        // stops that judgement from being made again on every observation.
        const row = syncableNote({ id: note.id, site, targetId, body: note.t });
        if (row) enqueue('note.add', noteKey(row), { note: row });
      }
      lastPersonNotes = state.personNotes;
      lastMoments = state.moments;
    }

    lastTasks = tasks;
  }

  /**
   * The socket is opened here rather than at `start`, because `start` runs
   * before there is a session to open it for. Idempotent, so calling it on
   * every tick and every kick is how a session that arrives late — or a
   * sign-out — is noticed without another listener to keep in step.
   */
  const attach = (): void => syncRealtime(currentUserId(), () => void pull());

  async function pull(): Promise<void> {
    attach();
    const userId = currentUserId();
    if (!userId || pulling) return;
    pulling = true;
    try {
      // The week is whatever the last observation saw. Without one there is no
      // week to ask for, and guessing is worse than waiting a cycle.
      const week = lastWeek;
      const [people, rows] = await Promise.all([
        wire.pullCircle(userId),
        week ? wire.pullTasks(userId, mondayOf(week)) : Promise.resolve(null),
      ]);

      const merge: ServerMerge = {};
      // No rows is the common answer, and a dispatch that changes nothing still
      // runs the reducer for every screen. Not dispatching is cheaper than
      // relying on SERVER_MERGE's identity bail-out.
      if (people.length > 0) merge.people = people;

      // Two questions, both answered by folding the rows here first. Would this
      // merge move `myTasks` at all — and may it? A rollover during the round
      // trip makes these rows answer for a week that is no longer on screen,
      // and reconciling them into the new one would delete it.
      //
      // Folded against `lastTasks` read now, not before the await: that is the
      // list the reducer is about to fold them into, so this asks the reducer's
      // question rather than a stale version of it.
      const local = lastTasks;
      if (rows && local && week === lastWeek) {
        if (reconcileTasks(local, rows, dirtyTaskIds(), ackedTaskIds()) !== local) merge.tasks = rows;
      }

      if (!merge.people && !merge.tasks) return;
      // Only the ids this merge actually carries. A merge the reducer then
      // bails out of by identity commits nothing and produces no observation,
      // so the set would otherwise sit armed and swallow the next real tap.
      if (merge.tasks) merging = new Set(merge.tasks.map((t) => t.id));
      dispatch({ type: 'SERVER_MERGE', merge });
    } catch {
      // Offline, or a server that will be there next minute. A pull has no
      // queue behind it and nothing to retire; the next tick asks again.
    } finally {
      pulling = false;
    }
  }

  return {
    observe,

    start(): void {
      startScheduler(queue, pushEveryMs);
      if (pullTimer) return;
      // Sign-in usually lands after `start`, and the channel is subscribed for
      // whoever the session says you are. Without this the socket would not open
      // until the poll a minute later noticed — which is a minute of the app
      // being exactly as live as it was before any of this existed.
      unsubscribeSession = onSessionChange(() => attach());
      pullTimer = setInterval(() => void pull(), pullEveryMs);
      void pull();
    },

    stop(): void {
      stopScheduler();
      if (pullTimer) clearInterval(pullTimer);
      pullTimer = null;
      unsubscribeSession?.();
      unsubscribeSession = null;
      // Unmount, or sync switching off. The channel outliving the engine would
      // be a socket firing refetches at a `pull` nothing is listening to.
      stopRealtime();
    },

    kick(): void {
      // A rejected drain on a foreground would be an unhandled rejection, which
      // on React Native is a redbox for something the user has no part in.
      void drain(queue).catch(() => {});
      void pull();
    },
  };
}
