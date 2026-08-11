/**
 * Which of `SEND_NOTE`'s four outcomes is a row in `notes`, and what that row is.
 *
 * The reducer branches on the open sheet and lands a note in one of four places:
 * `personNotes[who]`, the task's own `cmts`, a moment's `cmts`, or
 * `globalNotes[postId]`. The table has room for exactly two of them —
 * `notes_exactly_one_target` forces a row to name either a task or a recipient —
 * and the fourth has no table at all, because a genuinely public post is not
 * something this schema attempts.
 *
 * So the four-way branch is expressed here as a site plus a target, and the
 * mapping is the whole point of the file:
 *
 * | reducer branch | site | goes to |
 * |---|---|---|
 * | `sheet.type === 'person'` | `person` | `notes.recipient_id` |
 * | id is in `myTasks` | `ownTask` | `notes.task_id` |
 * | id is in `moments` | `moment` | `notes.task_id`, once moments carry real task uuids |
 * | neither | `globalPost` | nowhere, permanently |
 *
 * `moment` and `globalPost` both produce no row today — moment ids are fixtures
 * like `f1` and fail the uuid gate. The difference is that `moment` is waiting on
 * the moments feed to become a view over other members' `tasks`, and `globalPost`
 * is waiting on nothing. Collapsing them into one "not syncable" answer would
 * lose that, and would mean re-deriving it at the call site later.
 *
 * `author_id` is deliberately absent from every shape below: it is stamped from
 * the session at send time, like `owner_id` on a task and `actor_id` on a
 * reaction.
 */
import { isUuid } from './reactions';

/** Where the reducer put the note. One of these per `SEND_NOTE` branch. */
export type NoteSite = 'person' | 'ownTask' | 'moment' | 'globalPost';

/**
 * The one target a row is allowed to have. Modelled as a union rather than two
 * nullable columns so `num_nonnulls(task_id, recipient_id) = 1` cannot be
 * violated by a shape that type-checks.
 */
export type NoteTarget = { recipientId: string } | { taskId: string };

/**
 * A note that can be inserted.
 *
 * `id` is client-minted and is the row's primary key. **The `Note` type
 * (`{ w, k, t }`) has no id today, and needs one** — a name, an author key and a
 * body do not identify a row, so a retry after an ambiguous failure appends a
 * second copy of the comment, and a pull cannot tell the echo of your own note
 * from a new one. Reactions do not have this problem because their unique tuple
 * dedupes them; `notes` has no such constraint and cannot have one, since saying
 * the same thing twice is legitimate.
 *
 * The proposal for whoever owns the store: add an optional `id?: string` to
 * `Note`, set to `randomUUID()` where `SEND_NOTE` builds `mine`, left undefined
 * on notes restored from disk or from fixtures. Optional rather than required
 * keeps every existing `Note` literal — fixtures, tests, persisted state — valid,
 * and an id-less note simply never becomes syncable, which is already true of
 * fixture notes for other reasons. The insert then carries the id as the pk, so
 * a duplicate delivery collides on the pk instead of writing a second row.
 *
 * `body` is pre-trimmed here because the column's
 * `CHECK (length(btrim(body)) > 0)` rejects whitespace with a permanent 23514,
 * and the reducer has already trimmed it to decide whether to store it at all.
 */
export type SyncableNote = {
  id: string;
  body: string;
  target: NoteTarget;
};

/** Just enough of `SheetRef` to answer the question, without importing the store. */
export type NoteSheet = { type: 'task' | 'person' | 'invite'; id: string | null } | null;

/**
 * Which branch a note would take, given the open sheet and what the id names.
 *
 * The precedence matches the reducer exactly — own task first, then moment,
 * then global post — so this cannot disagree with where the note actually
 * landed. An `invite` sheet is not a note target at all; `SEND_NOTE` bails on
 * `sh.type !== 'task'` after the person branch, so it stores nothing.
 */
export function noteSiteOf(
  sheet: NoteSheet,
  ids: { myTasks: ReadonlySet<string>; moments: ReadonlySet<string> },
): NoteSite | null {
  if (!sheet || !sheet.id) return null;
  if (sheet.type === 'person') return 'person';
  if (sheet.type !== 'task') return null;
  if (ids.myTasks.has(sheet.id)) return 'ownTask';
  if (ids.moments.has(sheet.id)) return 'moment';
  return 'globalPost';
}

/**
 * The row for a note, or `null` if there is no row to write.
 *
 * Every rejection here is a note that is already on screen and stays there. The
 * gate is strict for the same reason the reaction one is: a target that is not a
 * uuid is a permanent 22P02 that jams the queue behind it, and a body the CHECK
 * refuses is a permanent 23514.
 */
export function syncableNote(input: {
  id: string;
  site: NoteSite;
  targetId: string;
  body: string;
}): SyncableNote | null {
  const body = input.body.trim();
  if (!body) return null;
  if (!isUuid(input.id) || !isUuid(input.targetId)) return null;

  const targetId = input.targetId.toLowerCase();

  switch (input.site) {
    case 'person':
      return { id: input.id.toLowerCase(), body, target: { recipientId: targetId } };
    // A moment is another member's task, so it is the same column. It only
    // survives the uuid gate above once the feed stops being fixtures.
    case 'ownTask':
    case 'moment':
      return { id: input.id.toLowerCase(), body, target: { taskId: targetId } };
    case 'globalPost':
      return null;
  }
}

/** The outbox coalescing key. The pk is the identity, so nothing else can be. */
export const noteKey = (note: SyncableNote): string => `note:${note.id}`;
