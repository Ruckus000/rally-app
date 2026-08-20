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
import type { Task, TaskMedia } from '../data/fixtures';

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
  // The photo is `task_media`'s, not `tasks`'. `rowToTask` cannot invent it any
  // more than it can invent comments, so letting the empty win would take the
  // picture off the screen on the first pull after it was attached — the same
  // failure the comment above describes, with the same cause. What replaces it
  // is `reconcileMedia`, which is answering a different question with a
  // different set of rows.
  media: local.media,
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

/**
 * Folding the pull's photos into your own week.
 *
 * A separate pass from `reconcileTasks` because it is a separate question over
 * a separate table. `adopt` above only guarantees a pull cannot *take* a photo
 * away; this decides when one arrives, changes or goes.
 *
 * ─── null is not empty ────────────────────────────────────────────────────
 *
 * `server` is null when this pull could not say anything about media — no week
 * was asked for, or the server is too old to know the key. Empty means the
 * server says these goals have no photos, which is authoritative and is how a
 * photo removed on another device disappears here. Conflating them deletes
 * every photo on the device on every pull.
 *
 * ─── the clear-branch is for devices that do not own the file ─────────────
 *
 * It is tempting to gate the removal on `localUri` — "if I hold the file, the
 * photo is mine and still uploading". That is wrong, and quietly: the local
 * file is never deleted on success (`media.ts` keeps it precisely because it is
 * what the owner's own card draws), so `localUri` stays set for the whole life
 * of the photo. Gating on it means a removal on another device *never* reaches
 * this one. Not a window — for ever.
 *
 * What guards the race is `dirtyIds`, and it must be the media dirty set rather
 * than the task one: media ops are keyed `media:<id>`, so `dirtyTaskIds` reads
 * a task with an attach in flight as perfectly clean. It also has to include
 * the upload lane, because the outbox does not learn about an attach until the
 * bytes have already landed.
 */
export function reconcileMedia(
  local: Task[],
  server: ReadonlyMap<string, TaskMedia> | null,
  dirtyIds: ReadonlySet<string>,
): Task[] {
  if (!server) return local;

  let changed = false;
  const next = local.map((task) => {
    // Something of ours is in flight for this goal: an upload part-way through,
    // an attach the server has not seen, a detach it has not processed. The
    // pull is answering about a state we are in the middle of leaving.
    if (dirtyIds.has(task.id)) return task;

    const row = server.get(task.id);

    if (!row) {
      if (!task.media) return task;
      changed = true;
      const { media: _gone, ...rest } = task;
      return rest;
    }

    // Same photo, so keep this device's object — `localUri` lives on it and the
    // server has never heard of it — and take the URL, which is the half only
    // the pull can answer for and which is re-signed as it ages.
    if (task.media?.id === row.id) {
      if (task.media.url === row.url) return task;
      changed = true;
      return { ...task, media: { ...task.media, url: row.url } };
    }

    // A different photo, or the first news of one. This is what puts the
    // owner's own picture back after a reinstall, and what carries a goal
    // staked-and-photographed on another device.
    changed = true;
    return { ...task, media: row };
  });

  return changed ? next : local;
}
