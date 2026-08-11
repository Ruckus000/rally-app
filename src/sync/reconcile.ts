/**
 * Folding a pull into the local list, as a pure function.
 *
 * Everything here exists to protect two things the rest of the app assumes:
 * the outbox is authoritative for rows it still has to send, and a merge that
 * changed nothing must be *indistinguishable* from no merge at all — same array
 * reference, same element references. `SERVER_MERGE` bails out on the first,
 * and `engine.observe` reference-diffs `state.myTasks` to decide what to
 * enqueue, so a freshly-built copy of an unchanged task would read as a local
 * edit and be pushed straight back to the server that just sent it.
 */
import type { Task } from '../data/fixtures';

/**
 * The fields a `tasks` row can actually answer for — the ones `taskToRow`
 * writes and `rowToTask` reads back.
 *
 * The rest of `Task` (pairs, comments, and the suggestion a task came from)
 * lives in other tables or only on this device, and `rowToTask` fills it with
 * empties because a task row has nothing to say about it. Letting those empties
 * win would delete every comment on the screen on the first successful pull, so
 * they are carried over from the local row instead and left to their own sync.
 */
const sameServerFields = (a: Task, b: Task): boolean =>
  a.day === b.day &&
  a.title === b.title &&
  a.cat === b.cat &&
  a.pts === b.pts &&
  a.done === b.done &&
  a.aud === b.aud &&
  a.source === b.source;

/** The server's version of a row, wearing the local row's companion fields. */
const adopt = (local: Task, server: Task): Task => ({
  ...server,
  pair: local.pair,
  pairKind: local.pairKind,
  pairStatus: local.pairStatus,
  cmts: local.cmts,
  fromSuggestion: local.fromSuggestion,
});

/**
 * `Task` has no `created_at`; ids are random UUIDs, so they sort arbitrarily.
 * `day` is the only field with a meaning the user can see, and it is the order
 * the week reads in — the id is just the tiebreaker that makes two devices
 * agree. Without an imposed order a merge would reshuffle the list under a
 * finger that is mid-tap, because insertion order differs per device.
 */
const byDayThenId = (a: Task, b: Task): number => (a.day - b.day) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function reconcileTasks(
  local: Task[],
  server: Task[],
  dirtyIds: ReadonlySet<string>,
  ackedIds: ReadonlySet<string>,
): Task[] {
  const serverById = new Map<string, Task>();
  for (const row of server) serverById.set(row.id, row);

  const seen = new Set<string>();
  const next: Task[] = [];

  for (const task of local) {
    seen.add(task.id);
    const row = serverById.get(task.id);

    // A pending upsert is about to overwrite the server with exactly this row.
    // Taking the server's copy here would flash the old values on screen and
    // then undo itself a moment later — the queue exists so it doesn't have to.
    if (dirtyIds.has(task.id)) {
      next.push(task);
      continue;
    }

    // Gone from the server, nothing of ours is in flight for it, and this
    // device has seen the server hold it before: another device deleted it.
    //
    // `acked` is what makes that inference safe. Without it, "absent from the
    // server" also covers a row that never reached the server at all — one
    // whose upsert was permanently refused and dead-lettered, or one belonging
    // to a session that has since been replaced by a new anonymous id, whose
    // pull then legitimately returns nothing. Deleting on that evidence turns
    // a sync failure into data loss, and the outbox's own header promises the
    // opposite: two copies quietly disagreeing beats erasing the user's work.
    if (!row) {
      if (ackedIds.has(task.id)) continue;
      next.push(task);
      continue;
    }

    next.push(sameServerFields(task, row) ? task : adopt(task, row));
  }

  for (const row of server) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    // A row the user just deleted is absent from `local`, so the loop above
    // never saw it — but the server has not processed the delete yet and the
    // pull still returns it. Folding it back in resurrects a task the user
    // explicitly removed, and `observe` then re-enqueues an upsert for it,
    // undoing the delete outright. `kick()` runs drain and pull in parallel
    // with no ordering, so this is an ordinary race, not a rare one.
    if (dirtyIds.has(row.id)) continue;
    next.push(row);
  }

  next.sort(byDayThenId);

  // Identity when nothing moved, so `useReducer` skips the render and the
  // engine sees no change to enqueue.
  if (next.length === local.length && next.every((task, i) => task === local[i])) return local;
  return next;
}
