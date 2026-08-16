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
import type { Moment, Note, Task } from '../data/fixtures';
import type { Person, PersonId } from '../data/people';
import type { WeekContext } from '../data/week';
import type { Action, CircleRef, ServerMerge, State } from '../state/store';
import { batchCheers, memberStats, mondayOf, rowToNotification, taskRowToMoment } from './mappers';
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
import {
  diffActed,
  parseActedKey,
  reactionKey,
  type ReactionKind,
  type ReactionRef,
} from './reactions';
import { syncRealtime, stopRealtime } from './realtime';
import { reconcileTasks } from './reconcile';
import { startScheduler, stopScheduler } from './scheduler';
import { currentUserId, onSessionChange } from './session';
import {
  supabaseTransport,
  type PulledNote,
  type WireOp as WireEntry,
  type Transport,
} from './transport';

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
    case 'profile.update':
      return { ...head, op, name: String(payload.name) };
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

/** The bell shows a list, not a history. */
const NOTIFICATION_MAX = 50;

/**
 * Field-wise, and only over what the feed renders. Every pull mints new objects,
 * and `time` is recomputed from the clock each time — so comparing by reference
 * (or including `time`) would report a change every minute and re-render every
 * screen for nothing.
 */
const sameMoments = (a: Moment[], b: Moment[]): boolean =>
  a.length === b.length &&
  a.every((m, i) => {
    const other = b[i];
    return (
      !!other &&
      m.id === other.id &&
      m.who === other.who &&
      m.title === other.title &&
      m.pts === other.pts &&
      m.day === other.day &&
      m.cheers === other.cheers
    );
  });

/** Ids in the order first seen, each one once. */
const uniqueIds = (ids: string[]): string[] => [...new Set(ids)];

/**
 * One row per person, first answer wins.
 *
 * The circle read and the bot read are separate queries over the same table
 * and are allowed to overlap — `profiles_select` exposes a bot to everyone
 * *and* to the circles it is in — so concatenating them is not a set. Both
 * copies are the same row, which is exactly why picking one is safe and why
 * the alternative is so quiet: everything downstream is keyed by id and would
 * silently collapse it, right up until something counted or listed instead.
 */
const dedupePeople = (people: Person[]): Person[] => {
  const byId = new Map<PersonId, Person>();
  for (const p of people) if (!byId.has(p.id)) byId.set(p.id, p);
  return [...byId.values()];
};

/**
 * The members, carrying the week the feed just counted for them. Whoever the
 * rows say nothing about keeps `undefined` rather than gaining a zeroed week —
 * `ranking()` renders that as "No week synced yet", which is the truth, where
 * 0 of 0 would read as a person who staked nothing.
 */
const withStats = (people: Person[], rows: Record<string, unknown>[]): Person[] => {
  const stats = memberStats(rows);
  return people.map((p) => {
    const week = stats.get(p.id);
    return week ? { ...p, stats: week } : p;
  });
};

/** Field-wise, because every pull mints a new object for the same circle. */
const sameCircle = (a: CircleRef | null, b: CircleRef | null): boolean =>
  a === b ||
  (!!a && !!b && a.id === b.id && a.name === b.name && a.inviteCode === b.inviteCode);

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

/** `reaction:<uuid>:<kind>` — the coalescing key `reactionKey` produces. */
const REACTION_KEY = 'reaction:';

/**
 * The reactions the queue still owes the server, by coalescing key.
 *
 * The reaction half of `dirtyTaskIds`, and it exists for the same reason: a
 * cheer the user just tapped is in `acted` and is not on the server yet, so a
 * pull that predates it must not be allowed to say it never happened. Derived
 * from the queue on demand rather than tracked, so there is no second copy to
 * disagree with what actually goes out.
 */
export function dirtyReactionKeys(): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const entry of pending()) {
    if (entry.key.startsWith(REACTION_KEY)) keys.add(entry.key);
  }
  return keys;
}

/**
 * The coalescing key for your own display name. A constant, because you have
 * exactly one — which is also what makes the default coalescing in `enqueue`
 * do the right thing for free: typing a name is one pending write, not five.
 */
export const PROFILE_KEY = 'profile';

/**
 * Queue your display name for the server. Called by whoever dispatched the
 * change, in the same tick.
 *
 * This used to be derived in `observe`, from a reference diff of the directory
 * like every other slice — and that was wrong for one reason the other slices
 * do not have: `observe` runs in an effect, so between the reducer writing the
 * name and the queue hearing about it there is a window, and a `SERVER_MERGE`
 * that lands inside it overwrites the name with the signup trigger's
 * placeholder. `dirtyProfile()` cannot help, because nothing is queued yet.
 *
 * A task cannot hit this: its id is minted locally and no merge can invent one.
 * Your profile row already exists on the server, with a name you did not
 * choose, so the merge always has something to overwrite you with.
 *
 * Queueing here makes the window zero-width: the entry exists before the
 * reducer has even run, so any merge in the same commit is already too late.
 */
export function queueProfileName(name: string): void {
  const trimmed = name.trim();
  if (trimmed) enqueue('profile.update', PROFILE_KEY, { name: trimmed });
}

/**
 * True while the queue still owes the server your name.
 *
 * The `people` half of `dirtyTaskIds`, and it exists for the same reason: your
 * profile row still says whatever the trigger defaulted it to until the push
 * lands, so a pull that raced the push would otherwise merge that default back
 * over the name you just typed — and the merge is authoritative, so it would
 * stick. A boolean rather than a set because there is only ever one of you.
 */
export function dirtyProfile(): boolean {
  for (const entry of pending()) {
    if (entry.key === PROFILE_KEY) return true;
  }
  return false;
}

/** The `acted` key a reaction is stored under. The reducer's `ACT` format. */
const actedKeyOf = (ref: ReactionRef): string => `${ref.targetId}:${ref.kind}`;

/**
 * `acted`, reconciled against the reactions the server holds for this user.
 *
 * Unlike notes, this cannot be a union: a cheer withdrawn on another device is
 * an *absence* on the wire, and a merge that only ever adds would leave it lit
 * on this phone forever. So the server is authoritative — but only over the
 * keys it is able to speak for.
 *
 * `parseActedKey` draws that line, and it is the same line `diffActed` draws on
 * the way out, which is what makes the two agree. A key it refuses (`g1:cheer`,
 * `mywin:share`, a synthetic DetailSheet key) was never sent, so the server's
 * silence about it is not evidence of anything; those are copied across
 * untouched. A key it accepts names a row `pullReactions` would have returned
 * if it existed.
 *
 * Pending entries win over the server for the same reason a dirty task does:
 * the queue is the record of what the server has not been told yet, and a pull
 * that raced a tap answers for the moment before it.
 *
 * Returns `local` by identity when nothing moved, so `SERVER_MERGE` can bail out
 * of the render — see the note there.
 */
export function reconcileActed(
  local: State['acted'],
  server: readonly ReactionRef[],
  dirtyKeys: ReadonlySet<string>,
): State['acted'] {
  const next: Record<string, true> = {};
  /**
   * Canonical key → the spelling this device already uses for it. `acted` keys
   * are minted from whatever id the screen was rendering, and `parseActedKey`
   * lowercases uuids on the way in; re-adding a row under the canonical spelling
   * when the local one differs only in case would light a second key and leave
   * the one the UI actually looks up dark.
   */
  const spelling = new Map<string, string>();

  for (const key of Object.keys(local)) {
    if (!local[key]) continue;
    const ref = parseActedKey(key);
    // Not a row the server has ever heard of. Stays, permanently.
    if (!ref) {
      next[key] = true;
      continue;
    }
    spelling.set(actedKeyOf(ref), key);
    if (dirtyKeys.has(reactionKey(ref))) next[key] = true;
  }

  for (const ref of server) {
    // Queued locally: this device has already spoken about this tuple and the
    // loop above has already applied its answer. Re-adding it here would undo a
    // withdrawal that has not reached the server yet.
    if (dirtyKeys.has(reactionKey(ref))) continue;
    const canonical = actedKeyOf(ref);
    next[spelling.get(canonical) ?? canonical] = true;
  }

  const after = Object.keys(next);
  const before = Object.keys(local).filter((k) => local[k]);
  if (after.length === before.length && after.every((k) => local[k])) return local;
  return next;
}

/** A `notes` row, as a `Note` the screens can already render. */
const asNote = (row: PulledNote, nameOf: (id: PersonId) => string): Note => ({
  w: nameOf(row.authorId as PersonId),
  k: row.authorId as PersonId,
  t: row.body,
  id: row.id,
});

/** Oldest first, with the id as the tiebreaker so two devices agree on ties. */
const byTime = (a: PulledNote, b: PulledNote): number =>
  a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function group(rows: readonly PulledNote[]): {
  byTask: Map<string, PulledNote[]>;
  byPerson: Map<string, PulledNote[]>;
} {
  const byTask = new Map<string, PulledNote[]>();
  const byPerson = new Map<string, PulledNote[]>();
  for (const row of [...rows].sort(byTime)) {
    const into = 'taskId' in row.target ? byTask : byPerson;
    const key = 'taskId' in row.target ? row.target.taskId : row.target.recipientId;
    const list = into.get(key);
    if (list) list.push(row);
    else into.set(key, [row]);
  }
  return { byTask, byPerson };
}

/** The ids already on a thread. Notes written before `id` existed have none. */
const idsOf = (notes: readonly Note[]): Set<string> => {
  const ids = new Set<string>();
  for (const note of notes) if (note.id) ids.add(note.id);
  return ids;
};

/**
 * Server notes, folded into the two places the reducer puts local ones.
 *
 * Append-only, and deduplicated by id — which is exactly why `Note` grew one.
 * A note is never edited and never deleted, so the server's copy of one this
 * device already has says nothing new, and the local object is kept rather than
 * replaced so the reference diff in `observe` stays quiet.
 *
 * A local note with no id is never dropped: it predates the id field, it can
 * never have been sent, and there is nothing on the wire it could be matched
 * against. A row whose target is not on this device — a note on a task from
 * another week — simply lands nowhere, and the pull that finds it again next
 * minute is what places it once the task arrives.
 *
 * Both slices come back by identity when nothing was added.
 */
export function mergeNotes(
  local: { myTasks: Task[]; personNotes: State['personNotes'] },
  rows: readonly PulledNote[],
  nameOf: (id: PersonId) => string,
): { myTasks: Task[]; personNotes: State['personNotes'] } {
  const { byTask, byPerson } = group(rows);

  let myTasks = local.myTasks;
  if (byTask.size > 0) {
    let moved = false;
    const next = local.myTasks.map((task) => {
      const incoming = byTask.get(task.id);
      if (!incoming) return task;
      const have = idsOf(task.cmts);
      const fresh = incoming.filter((row) => !have.has(row.id));
      if (fresh.length === 0) return task;
      moved = true;
      return { ...task, cmts: [...task.cmts, ...fresh.map((row) => asNote(row, nameOf))] };
    });
    if (moved) myTasks = next;
  }

  let personNotes = local.personNotes;
  if (byPerson.size > 0) {
    let draft: State['personNotes'] | null = null;
    for (const [who, incoming] of byPerson) {
      const thread = personNotes[who as PersonId] ?? [];
      const have = idsOf(thread);
      const fresh = incoming.filter((row) => !have.has(row.id));
      if (fresh.length === 0) continue;
      if (!draft) {
        draft = { ...personNotes };
        personNotes = draft;
      }
      draft[who as PersonId] = [...thread, ...fresh.map((row) => asNote(row, nameOf))];
    }
  }

  return { myTasks, personNotes };
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
  // A bot's post is somebody's task, so a note on one is a note on a task. The
  // demo's posts never reach here: `globalPosts` is the live slice, and
  // `syncableNote` would refuse their non-uuid ids anyway.
  for (const post of state.globalPosts) {
    for (const note of post.cmts ?? []) out.push({ note, site: 'moment', targetId: post.id });
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
  let lastActed: State['acted'] = {};
  /**
   * Every note id this device has already accounted for — sent, or judged
   * unsendable. A note is append-only and never edited, so an id that has been
   * seen once can never become news again, and this is the whole diff.
   */
  let seenNotes: Set<string> = new Set();
  /** The three note-bearing slices `myTasks` does not cover. Reference-compared. */
  let lastPersonNotes: State['personNotes'] | null = null;
  let lastMoments: State['moments'] | null = null;
  let lastGlobalPosts: State['globalPosts'] | null = null;
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
  /**
   * The `acted` keys a merge just spoke for, and the note ids it just
   * delivered. The reaction and note halves of `merging`, and they exist for
   * exactly the same reason: `observe` diffs those slices too, so a cheer or a
   * note that arrived from the server would otherwise read as one made here and
   * be enqueued straight back — two devices cheering each other forever.
   *
   * Adopted by key and by id rather than by suppressing the whole observation,
   * for the reason `merging` gives: a tap batched into the same React commit as
   * the merge still has to be sent.
   */
  let mergingActed: Set<string> | null = null;
  let mergingNotes: Set<string> | null = null;
  /**
   * The circle the last pull answered with. Held here rather than read back off
   * state because the reducer is not the engine's memory — and the comparison
   * has to be field-wise anyway, since every pull builds a new object.
   */
  let lastCircle: CircleRef | null = null;
  /**
   * The feed the last pull answered with. Its own baseline rather than
   * `lastMoments`, which is `observe`'s note-diffing reference — one variable
   * doing both jobs would make a note appearing on screen look like the server
   * changing its mind about the feed.
   */
  let lastFeed: Moment[] = [];
  let lastGlobal: Moment[] = [];
  /** The cheer count the last pull answered with, so an unchanged one is silent. */
  let lastReceived = 0;
  /** The feed's ids, joined. See the comparison in `pull` for why not the rows. */
  let lastNotificationIds = '';
  let pullTimer: ReturnType<typeof setInterval> | null = null;
  let pulling = false;
  let unsubscribeSession: (() => void) | null = null;

  function observe(state: State): void {
    const tasks = state.myTasks;
    const merged = merging;
    const mergedActed = mergingActed;
    const mergedNotes = mergingNotes;
    merging = null;
    mergingActed = null;
    mergingNotes = null;
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
      lastGlobalPosts = state.globalPosts;
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
      // Adoption, one slice over from `merging`. The baseline is moved to the
      // merge's answer for the keys the merge was authoritative for, so the
      // diff below reports nothing for them — and still reports a cheer tapped
      // on any other key in the same commit.
      if (mergedActed) {
        const adjusted: Record<string, true> = {};
        for (const key of Object.keys(lastActed)) if (lastActed[key]) adjusted[key] = true;
        for (const key of mergedActed) {
          if (state.acted[key]) adjusted[key] = true;
          else delete adjusted[key];
        }
        lastActed = adjusted;
      }
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
    if (
      tasksMoved ||
      state.personNotes !== lastPersonNotes ||
      state.moments !== lastMoments ||
      // A bot's post is a task like any other, so a note left on one has a row
      // to write. Without this slice in the guard the walk never runs for it and
      // the note stays on the device — which is what a demo post's note does,
      // for a reason that does not apply here.
      state.globalPosts !== lastGlobalPosts
    ) {
      for (const { note, site, targetId } of placedNotes(state)) {
        // No id: a fixture, or a note restored from a payload written before the
        // id existed. It stays on screen and never becomes a row.
        if (!note.id || seenNotes.has(note.id)) continue;
        seenNotes.add(note.id);
        // A note the merge just delivered. Recorded above and dropped here:
        // enqueuing it would write the server's own row back to it, and the
        // next pull would hand it to us again.
        if (mergedNotes?.has(note.id)) continue;
        // Rejected here means rejected forever — a fixture target, a moment id
        // that is not yet a uuid, a public post. Recording the id above is what
        // stops that judgement from being made again on every observation.
        const row = syncableNote({ id: note.id, site, targetId, body: note.t });
        if (row) enqueue('note.add', noteKey(row), { note: row });
      }
      lastPersonNotes = state.personNotes;
      lastMoments = state.moments;
      lastGlobalPosts = state.globalPosts;
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
      const [people, bots, myCircle, notifications, rows, reactions, notes] = await Promise.all([
        wire.pullCircle(userId),
        wire.pullBots(),
        wire.pullMyCircle(userId),
        wire.pullNotifications(userId, NOTIFICATION_MAX),
        week ? wire.pullTasks(userId, mondayOf(week)) : Promise.resolve(null),
        wire.pullReactions(userId),
        wire.pullNotes(userId),
      ]);

      // The feed is a second wave rather than a fifth entry in the one above:
      // it can only ask about people `pullCircle` has just named, and asking
      // the membership question twice in parallel would cost the same round
      // trip while making the two answers able to disagree.
      const weekStart = week ? mondayOf(week) : null;
      // Deduped, because the two reads overlap by design: `pullCircle` answers
      // for everyone in your circles and `pullBots` for every bot, and a bot
      // you share a circle with is legitimately in both. Left as-is the same id
      // goes into the owners query twice and into the directory twice — the
      // second of which is the only reason a caller downstream would ever have
      // to think about duplicates at all.
      const memberIds = uniqueIds(people.map((p) => p.id).filter((id) => id !== userId));
      const botIds = uniqueIds(bots.map((b) => b.id));
      // Two feeds, one query, one round trip: `pullTasksByOwners` does not care
      // whose ids these are, and splitting them again afterwards is cheaper
      // than asking the same question twice.
      const ownerRows = weekStart
        ? await wire.pullTasksByOwners(uniqueIds([...memberIds, ...botIds]), weekStart)
        : [];
      const isBot = new Set(botIds);
      const friendRows = ownerRows.filter((row) => !isBot.has(String(row.owner_id)));
      const botRows = ownerRows.filter((row) => isBot.has(String(row.owner_id)));
      // A third wave, for the same reason the second is one: it can only ask
      // about rows the first two have just named.
      //
      // One call for both feeds' worth of ids — the tasks you can see, and your
      // own. `pullCheerCounts` excludes you either way, which is exactly right
      // in both directions: not your own cheer on a friend's row, and not your
      // own cheer on your own row, which is not a cheer you received.
      const myIds = (rows ?? []).map((t) => t.id);
      const cheers = await wire.pullCheerCounts(
        [...ownerRows.map((row) => String(row.id)), ...myIds],
        userId,
      );

      const merge: ServerMerge = {};
      // No rows is the common answer, and a dispatch that changes nothing still
      // runs the reducer for every screen. Not dispatching is cheaper than
      // relying on SERVER_MERGE's identity bail-out.
      //
      // Stats ride along on the people rows rather than arriving as a slice of
      // their own: `ranking()` already reads `Person.stats`, and a second place
      // to look would be a second thing to keep in step.
      // Bots ride in the same directory as everyone else. They have to: every
      // avatar, name and initial on the Global feed is resolved through
      // `people`, and a card whose author is missing from it renders as
      // "Someone" — which is the whole thing this replaced.
      //
      // One entry per id, and the whole directory in one payload: this is the
      // complete answer to "who is in this account's world", which is what lets
      // the reducer drop whoever is no longer in it. A half-answer would read
      // as "everybody else left".
      const directory = dedupePeople([...people, ...bots]);
      if (directory.length > 0) merge.people = withStats(directory, ownerRows);

      // Circle members only. `profiles_select` exposes the profiles of people
      // who share a circle with you, plus the bots — so a feed of `everyone`
      // rows from *human* strangers would still be a list of people all called
      // "Someone", and is still not attempted.
      const asMoment = (row: Record<string, unknown>) =>
        taskRowToMoment(row, undefined, cheers[String(row.id)] ?? 0);
      const moments = friendRows.map(asMoment);
      const globalPosts = botRows.map(asMoment);
      // Your feed. Compared on ids alone: `time` is recomputed from the clock
      // on every pull, so comparing the rendered shape would report a change
      // every minute and re-render every screen for nothing.
      // Grouped before it reaches state, so every consumer — the overlay, the
      // badge, "mark all read" — sees the same feed the user does.
      const feed = batchCheers(notifications.map((row) => rowToNotification(row)));
      const feedIds = feed.map((n) => n.id).join(',');
      if (feedIds !== lastNotificationIds) {
        merge.notifications = feed;
        lastNotificationIds = feedIds;
      }

      // Cheers landing on your week, which had no read at all: `pullCheerCounts`
      // answered for the tasks in your feed, and your own are not in it. The Me
      // screen has always rendered `profile.cheersReceived` — until now nothing
      // ever wrote it, so a live account read 0 however many people cheered.
      const received = myIds.reduce((sum, id) => sum + (cheers[id] ?? 0), 0);
      if (received !== lastReceived) {
        merge.cheersReceived = received;
        lastReceived = received;
      }

      if (!sameMoments(lastFeed, moments)) {
        merge.moments = moments;
        lastFeed = moments;
      }

      if (!sameMoments(lastGlobal, globalPosts)) {
        merge.globalPosts = globalPosts;
        lastGlobal = globalPosts;
      }

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

      // Asked against `lastActed`, which is `state.acted` as of the last
      // observation: if reconciling would leave it untouched there is nothing
      // for the reducer to do, and the same reasoning as `merge.tasks` applies —
      // a dispatch that changes nothing still runs the reducer for every screen.
      const dirtyReactions = dirtyReactionKeys();
      if (reconcileActed(lastActed, reactions, dirtyReactions) !== lastActed) {
        merge.reactions = reactions;
      }

      // A note this device has already accounted for is not news: `seenNotes`
      // holds every id it has placed, so anything in it is already on screen.
      // Notes it could not place — a note on a task from another week — stay
      // out of the ledger and are offered again next cycle, once the row they
      // point at has arrived.
      const freshNotes = notes.filter((n) => !seenNotes.has(n.id));
      if (freshNotes.length > 0) merge.notes = freshNotes;

      // Compared field-wise, not by reference: a fresh object every minute
      // saying the same thing would re-render every screen for nothing. `null`
      // is a real answer here — "you left the circle" — so the key is only set
      // when the answer actually moved.
      if (!sameCircle(lastCircle, myCircle)) {
        merge.circle = myCircle;
        lastCircle = myCircle;
      }

      if (
        !merge.people &&
        !merge.tasks &&
        !merge.reactions &&
        !merge.notes &&
        !merge.moments &&
        !merge.globalPosts &&
        !merge.notifications &&
        merge.cheersReceived === undefined &&
        merge.circle === undefined
      ) {
        return;
      }

      // Only the rows this merge actually carries. A merge the reducer then
      // bails out of by identity commits nothing and produces no observation,
      // so the sets would otherwise sit armed and swallow the next real tap.
      const touched = new Set<string>(merge.tasks?.map((t) => t.id) ?? []);
      // A note lands in its task's `cmts`, which makes a new task object — and
      // a new task object is indistinguishable from an edit to the reference
      // diff. So the tasks a merged note touches are adopted too.
      for (const note of merge.notes ?? []) {
        if ('taskId' in note.target) touched.add(note.target.taskId);
      }
      if (touched.size > 0) merging = touched;

      if (merge.reactions) {
        // Every key the reconciliation is allowed to move: the ones the server
        // named, and every syncable key already held — any of which it may
        // withdraw. Nothing else, so a tap on a fresh target in the same commit
        // is still diffed and still queued.
        const keys = new Set<string>();
        for (const ref of merge.reactions) keys.add(`${ref.targetId}:${ref.kind}`);
        for (const key of Object.keys(lastActed)) {
          if (lastActed[key] && parseActedKey(key)) keys.add(key);
        }
        mergingActed = keys;
      }
      if (merge.notes) mergingNotes = new Set(merge.notes.map((n) => n.id));
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
