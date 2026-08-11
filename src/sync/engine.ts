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
import type { Task } from '../data/fixtures';
import type { WeekContext } from '../data/week';
import type { Action, ServerMerge, State } from '../state/store';
import { mondayOf } from './mappers';
import {
  ackedTaskIds,
  drain,
  enqueue,
  pending,
  type OutboxEntry as QueueEntry,
  type OutboxOp,
  type QueueTransport,
} from './outbox';
import { reconcileTasks } from './reconcile';
import { startScheduler, stopScheduler } from './scheduler';
import { currentUserId } from './session';
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
  return op === 'task.upsert'
    ? {
        id: entry.id,
        at: entry.at,
        op: 'task.upsert',
        task: payload.task as Task,
        weekStart: String(payload.weekStart),
      }
    : { id: entry.id, at: entry.at, op: 'task.delete', taskId: String(payload.taskId) };
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

  function observe(state: State): void {
    const tasks = state.myTasks;
    const merged = merging;
    merging = null;
    lastWeek = state.week;

    if (seen === null) {
      seen = index(tasks);
      lastTasks = tasks;
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

    if (tasks === lastTasks) return;

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
    lastTasks = tasks;
  }

  async function pull(): Promise<void> {
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
      pullTimer = setInterval(() => void pull(), pullEveryMs);
      void pull();
    },

    stop(): void {
      stopScheduler();
      if (pullTimer) clearInterval(pullTimer);
      pullTimer = null;
    },

    kick(): void {
      // A rejected drain on a foreground would be an unhandled rejection, which
      // on React Native is a redbox for something the user has no part in.
      void drain(queue).catch(() => {});
      void pull();
    },
  };
}
