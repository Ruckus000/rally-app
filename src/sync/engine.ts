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
import type { Action, State } from '../state/store';
import { mondayOf } from './mappers';
import {
  drain,
  enqueue,
  type OutboxEntry as QueueEntry,
  type OutboxOp,
  type QueueTransport,
} from './outbox';
import { startScheduler, stopScheduler } from './scheduler';
import { currentUserId } from './session';
import { supabaseTransport, type WireOp as WireEntry, type Transport } from './transport';

/** How often the queue is offered to the network. Matches scheduler.ts's own default. */
const PUSH_MS = 5_000;
/**
 * Pulls are far rarer than pushes: the circle changes when somebody joins, and
 * every tick costs a round trip on a phone radio. Foregrounding kicks one
 * anyway, which is when a stale directory is actually visible.
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
  /** Set immediately before dispatching a merge. See `observe`. */
  let suppress = false;
  let pullTimer: ReturnType<typeof setInterval> | null = null;
  let pulling = false;

  function observe(state: State): void {
    const tasks = state.myTasks;
    const merged = suppress;
    suppress = false;

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
    // So the merge's own observation is *adopted* rather than diffed: whatever
    // it produced becomes the new baseline and nothing is sent. Exactly one
    // observation, because the flag is cleared above before anything else can
    // read it.
    //
    // The dispatch that sets this runs in its own microtask, so it does not
    // share a commit with a tap. If that ever stops being true, a tap batched
    // into the same commit would be adopted with the merge and would not reach
    // the server until that row is next touched.
    if (merged) {
      seen = index(tasks);
      lastTasks = tasks;
      return;
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
      const people = await wire.pullCircle(userId);
      // No rows is the common answer, and a dispatch that changes nothing still
      // runs the reducer for every screen. Not dispatching is cheaper than
      // relying on SERVER_MERGE's identity bail-out.
      if (people.length === 0) return;
      suppress = true;
      dispatch({ type: 'SERVER_MERGE', merge: { people } });
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
