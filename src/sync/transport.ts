/**
 * The only place in the app that knows what a Supabase call looks like.
 *
 * It exists so the rest of the sync layer — the outbox, the worker, their tests
 * — can be written and tested against three functions instead of against a
 * query builder. A fake transport is four lines; faking `from().upsert()` is
 * not, and a test that spends its effort on the double is a test that stops
 * describing the behaviour it was written for.
 *
 * The other half of its job is turning failure into a decision. `push` never
 * throws and never asks the caller to read a SQLSTATE: it answers *retry this*
 * or *this will never work*, because those are the only two things an outbox can
 * do. Getting that split wrong is the expensive bug in a sync layer — a
 * permanent failure classed retryable is an entry that jams the queue forever,
 * and a retryable one classed permanent is a tap the user made and lost.
 */
import type { Task, TaskMedia } from '../data/fixtures';
import type { Person } from '../data/people';
import type { CircleRef } from '../state/store';
import { getSupabase } from '../lib/supabase';
import { avatarStateOf } from '../data/people';
import { rowToPerson, rowToPulledMedia, rowToTask, taskToRow } from './mappers';
import type { ScreenOutcome } from './media';
import type { NoteTarget, SyncableNote } from './notes';
import { REACTION_KINDS, type ReactionKind, type ReactionRef } from './reactions';

/**
 * One pending mutation. Defined here, with the code that puts it on the wire,
 * because the wire is what constrains it: `at` is the `updated_at` that
 * last-write-wins compares, and `weekStart` is resolved at enqueue time so a
 * queued task cannot drift into a different week while it waits offline.
 *
 * `owner_id` is conspicuously absent, and so are `actor_id` and `author_id`.
 * They are stamped from the session at push time — see `push` — and a payload
 * that could name its own owner is a payload that can write to someone else's
 * account, or cheer as them.
 */
export type WireOp =
  | { id: string; at: number; op: 'task.upsert'; task: Task; weekStart: string }
  | { id: string; at: number; op: 'task.delete'; taskId: string }
  | { id: string; at: number; op: 'reaction.add'; targetId: string; kind: ReactionKind }
  | { id: string; at: number; op: 'reaction.remove'; targetId: string; kind: ReactionKind }
  | { id: string; at: number; op: 'note.add'; note: SyncableNote }
  | { id: string; at: number; op: 'profile.update'; name: string }
  // No `profile_id`, for the same reason nothing above carries `owner_id`:
  // `register_device` reads `auth.uid()` itself, so there is no owner for a
  // payload to name and therefore none to forge.
  | { id: string; at: number; op: 'device.register'; token: string; platform: string }
  // No `profile_id`, for the reason every other payload here lacks an owner: it
  // is stamped from the session at push time, and a rollup that could name its
  // own owner could write a week into somebody else's history.
  // No `owner_id`, for the reason nothing else here carries one. The row is
  // written only after the object it names is in the bucket — see `media.ts`.
  | {
      id: string;
      at: number;
      op: 'media.attach';
      mediaId: string;
      taskId: string;
      path: string;
      width: number;
      height: number;
    }
  // Taking a photo back, and the only op that removes one. No `path`: the one
  // string that decides which file gets deleted is derived at send time from
  // the session, for the reason `20260820020000_task_media_screened.sql`
  // gives about the column the screener reads — a payload that can name an
  // object is a payload that can name somebody else's.
  | { id: string; at: number; op: 'media.detach'; mediaId: string; taskId: string }
  | {
      id: string;
      at: number;
      op: 'rollup.add';
      weekStart: string;
      points: number;
      done: number;
      total: number;
      perfect: boolean;
      streakHeld: boolean;
    }
  // No reporter or blocker id, for the same reason `device.register` carries no
  // `profile_id`: the RPC reads `auth.uid()` itself, so there is no owner for a
  // payload to name and therefore none to forge.
  | { id: string; at: number; op: 'report.file'; subjectKind: ReportSubject; subjectId: string; reason: ReportReason }
  | { id: string; at: number; op: 'block.add'; blockedId: string }
  | { id: string; at: number; op: 'block.remove'; blockedId: string };

/** Matches `reports_kind_known` in the migration — kept in lockstep by hand. */
export type ReportSubject = 'task' | 'note' | 'profile';

/** Matches `reports_reason_known` in the migration — kept in lockstep by hand. */
export type ReportReason = 'harassment' | 'spam' | 'sexual' | 'violence' | 'self_harm' | 'other';

/** A `notes` row on the way back, narrowed into the shape the client can place. */
export type PulledNote = {
  id: string;
  authorId: string;
  body: string;
  target: NoteTarget;
  at: string;
};

export type PushResult =
  | { ok: true }
  | { ok: false; retryable: true; error: string }
  | { ok: false; retryable: false; code: string; error: string };

/**
 * Everything one pull cycle reads, in one payload — the answer `pull_world`
 * gives. The keys mirror the per-table pulls one-for-one, because the engine
 * has to be able to take either answer: a server older than the function
 * cannot give this one, and the per-table pulls are the fallback.
 *
 * `myTasks` is null when no week was asked for — "no week on screen yet" and
 * "a week with nothing staked" are different answers, exactly as `pullTasks`'s
 * absence vs its empty array has always distinguished them.
 *
 * `media` is null for the same reason and one more. Empty means "the server
 * says these goals have no photos", which is how a photo removed on another
 * device disappears from this one; null means "this pull cannot say", which
 * must never remove anything. A server too old to know the key answers
 * `undefined`, which maps to null here — otherwise every client on that build
 * would read silence as a removal and delete every photo it had.
 */
export type World = {
  people: Person[];
  bots: Person[];
  circle: CircleRef | null;
  notifications: Record<string, unknown>[];
  myTasks: Task[] | null;
  ownerTasks: Record<string, unknown>[];
  media: PulledMedia[] | null;
  reactions: ReactionRef[];
  notes: PulledNote[];
  rollups: PulledRollup[];
  cheerCounts: Record<string, number>;
};

export type Transport = {
  push(entry: WireOp, userId: string): Promise<PushResult>;
  /**
   * The whole pull in one round trip, or `null` from a server that does not
   * have the function yet — the caller falls back to the per-table pulls
   * below, which remain the contract's floor. Null is a fact about the
   * *server*, so the caller may remember it rather than asking every cycle.
   */
  pullWorld(weekStart: string | null, notifLimit: number): Promise<World | null>;
  pullTasks(userId: string, weekStart: string): Promise<Task[]>;
  pullCircle(userId: string): Promise<Person[]>;
  pullMyCircle(userId: string): Promise<CircleRef | null>;
  pullNotifications(userId: string, limit: number): Promise<Record<string, unknown>[]>;
  pullTasksByOwners(ownerIds: string[], weekStart: string): Promise<Record<string, unknown>[]>;
  pullBots(): Promise<Person[]>;
  pullCheerCounts(taskIds: string[], userId: string): Promise<Record<string, number>>;
  pullReactions(userId: string): Promise<ReactionRef[]>;
  pullNotes(userId: string): Promise<PulledNote[]>;
  /**
   * Kept separate from `pullTasks`, which answers a different question: this one
   * is "what did my closed weeks score", that one is "what is on my week now".
   * Folding them would fail the *describe it without "and"* test, the same way
   * `pullCircle` and `pullMyCircle` are two functions rather than one.
   */
  pullRollups(userId: string): Promise<PulledRollup[]>;
  /**
   * Who this account has blocked. `userId` is not used to build the query —
   * `blocks_select` already scopes the row to `blocker_id = auth.uid()`, so a
   * `.eq('blocker_id', userId)` here would be redundant at best and, on a
   * session whose `userId` argument ever drifted from the actual caller, would
   * silently narrow to nothing instead of surfacing the mismatch. Kept as a
   * parameter anyway, for the same signature every other pull in this type has.
   */
  pullBlocks(userId: string): Promise<string[]>;
  /**
   * Finish a screening that was interrupted, if there is one.
   *
   * The leak it closes: `pickAndUploadAvatar` writes `pending` over a live
   * object and *then* asks the screener, so an app killed in between leaves a
   * row nothing on the client ever revisits and bytes in a bucket every
   * signed-in account can read. Nobody would report it — the owner sees
   * initials, which is exactly what `pending` is supposed to look like.
   *
   * Safe to call whenever, which is why it needs no bookkeeping of its own:
   * `mark_avatar_screened` moves only rows that are still `pending`, so a
   * verdict arriving twice cannot republish something the owner has since
   * removed, and an account with nothing pending pays one `select`.
   *
   * Answers nothing and never throws. There is no screen waiting on it and no
   * queue behind it; the next launch asks again.
   */
  resumePendingAvatar(userId: string): Promise<void>;
};

/** A `week_rollups` row on the way back, before it becomes a `HistoryWeek`. */
/**
 * A photo as the pull hands it over: the goal it belongs to, and the photo.
 *
 * `taskId` rides alongside rather than inside `TaskMedia` because a `TaskMedia`
 * is always *already* on the task it belongs to once it reaches state — the id
 * would be a field that is redundant everywhere except the few lines between
 * the wire and the merge. Same shape as `PulledNote` and `PulledRollup`, and
 * for the same reason.
 */
export type PulledMedia = {
  taskId: string;
  media: TaskMedia;
};

export type PulledRollup = {
  weekStart: string;
  points: number;
  done: number;
  total: number;
  perfect: boolean;
  streakHeld: boolean;
};

/**
 * The profile columns every directory read asks for.
 *
 * Named in one place because there are two reads — the circle and the bots —
 * and a column added to one of them only is a photo that renders for your
 * friends and not for the Oz bots, or the other way round.
 */
const PROFILE_COLUMNS = 'id,handle,name,avatar_path,avatar_state';

/**
 * Every reaction this client writes or reads is on a task. The only other member
 * of the enum is `post`, and the global feed has no backing table — so a `post`
 * row coming back is from a future build and is filtered out rather than shown
 * against whatever task happens to share its id.
 */
const TARGET_TYPE = 'task';

/** The PostgREST envelope, plus the fields a thrown fetch failure carries. */
type WireError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
  name?: string;
  status?: number;
};

const asWireError = (err: unknown): WireError =>
  err && typeof err === 'object' ? (err as WireError) : { message: String(err) };

const describe = (e: WireError): string => e.message ?? e.code ?? 'unknown error';

/**
 * A `fetch` that never reached a server. supabase-js only converts what the
 * server actually answered into an `{ error }` envelope, so a dead network
 * arrives as a thrown TypeError instead — which is why the throw path is the
 * offline path and is always retryable.
 */
function isNetwork(e: WireError): boolean {
  if (e.name === 'AbortError' || e.name === 'TypeError') return true;
  if (e.status === 0) return true;
  return /network request failed|failed to fetch|timeout|socket hang up/i.test(e.message ?? '');
}

/**
 * The server is up but cannot answer right now: connection classes (08xxx),
 * resource exhaustion (53xxx), admin shutdown and query cancellation (57xxx),
 * serialization failures under concurrency (40001/40P01), plus 5xx and the rate
 * limiter. Everything in here will plausibly succeed unchanged in a minute.
 */
function isTransient(e: WireError): boolean {
  const status = e.status ?? 0;
  if (status === 429 || status >= 500) return true;

  const code = e.code ?? '';
  if (/^5\d\d$/.test(code) || code === '429') return true;
  if (/^(08|53|57)/.test(code)) return true;
  return code === '40001' || code === '40P01';
}

/**
 * An expired access token — recoverable exactly once, by refreshing it.
 *
 * Exported because the pull path has to ask the same question and there must not
 * be a second list: a read that 401s and a write that 401s are the same fact
 * about the session, and the engine reports both to the same place.
 */
export function isAuthExpired(err: unknown): boolean {
  const e = asWireError(err);
  // `'401'` is this module's own sentinel, set below when a 401 arrives with no
  // SQLSTATE to name it. Recognised here so that re-reading a `PushResult` gives
  // the same answer as reading the wire error it came from — otherwise the one
  // failure with no Postgres code behind it is the one that slips through.
  return (
    e.status === 401 || e.code === '401' || e.code === 'PGRST301' || e.code === 'PGRST303'
  );
}

function classify(err: unknown): PushResult {
  // Checked before anything else: a Malformed is a TypeError by ancestry and
  // isNetwork() would wave it through as a dead fetch.
  if (err instanceof Malformed) {
    return { ok: false, retryable: false, code: 'malformed', error: err.message };
  }
  const e = asWireError(err);
  if (isNetwork(e) || isTransient(e)) return { ok: false, retryable: true, error: describe(e) };
  // The server answered, and it will answer the same way to the same request.
  // 42501 (RLS), 23514 (check), 23503 (FK), 22P02 (enum) and every other 4xx
  // land here: retrying them is a loop that never terminates.
  return { ok: false, retryable: false, code: e.code ?? 'unknown', error: describe(e) };
}

/**
 * The unique constraint IS the intent. A replay that collides with a row already
 * carrying the same primary key has already achieved what it was queued to do —
 * reporting that as a failure would make an at-least-once outbox unable to
 * finish, which is the whole reason ids are client-minted.
 */
const isAlreadyDone = (err: unknown): boolean => asWireError(err).code === '23505';

/** A delete cannot collide, so a 23505 back from one is not the same good news. */
const writes = (op: WireOp['op']): boolean =>
  op !== 'task.delete' && op !== 'reaction.remove' && op !== 'media.detach';

const isKind = (v: string): v is ReactionKind => (REACTION_KINDS as readonly string[]).includes(v);

/**
 * A `reactions` row into a ref, or nothing for a kind a newer build invented —
 * dropping it beats rendering it as whichever kind this build would fall back
 * to. Shared by `pullReactions` and `pullWorld`, whose rows must read the same.
 */
const rowToReactionRef = (r: unknown): ReactionRef[] => {
  const row = r as { target_id: unknown; kind: unknown };
  const kind = String(row.kind);
  return isKind(kind) ? [{ targetId: String(row.target_id), kind }] : [];
};

/**
 * A `notes` row into the shape the client can place, or nothing for a row that
 * somehow names no target: the CHECK guarantees exactly one, but a row is
 * untrusted input like any other, and one naming neither must not be given a
 * target the client invents for it. Shared by `pullNotes` and `pullWorld`.
 */
const rowToPulledNote = (r: unknown): PulledNote[] => {
  const row = r as Record<string, unknown>;
  const target: NoteTarget | null =
    typeof row.task_id === 'string'
      ? { taskId: row.task_id }
      : typeof row.recipient_id === 'string'
        ? { recipientId: row.recipient_id }
        : null;
  if (!target) return [];
  return [
    {
      id: String(row.id),
      authorId: String(row.author_id),
      body: String(row.body ?? ''),
      target,
      at: String(row.created_at ?? ''),
    },
  ];
};

/** A `week_rollups` row into the pulled shape. Shared by `pullRollups` and `pullWorld`. */
const rowToPulledRollup = (row: Record<string, unknown>): PulledRollup => ({
  weekStart: String(row.week_start),
  points: Number(row.points ?? 0),
  done: Number(row.done ?? 0),
  total: Number(row.total ?? 0),
  perfect: !!row.perfect,
  streakHeld: !!row.streak_held,
});

/**
 * `notes_exactly_one_target` is a CHECK over both columns, so the one that is
 * not the target is written as an explicit null rather than omitted: an upsert
 * that leaves a column out leaves whatever was there before, which on a replay
 * against an edited row is how you get two targets and a permanent 23514.
 */
function noteToRow(note: SyncableNote): Record<string, unknown> {
  const target = note.target;
  return {
    id: note.id,
    body: note.body,
    task_id: 'taskId' in target ? target.taskId : null,
    recipient_id: 'recipientId' in target ? target.recipientId : null,
  };
}

/**
 * We could not even build the request. No network will ever fix that, and it
 * must not be mistaken for one: a plain TypeError out of the mappers looks
 * exactly like a failed fetch, and a retryable entry that can never succeed
 * sits at the head of a strictly ordered queue forever.
 */
class Malformed extends Error {
  readonly permanent = true;
  constructor(message: string) {
    super(message);
    this.name = 'Malformed';
  }
}

/**
 * gotrue's refresh, called only on a 401 and only once per push.
 *
 * Optional because not every client can refresh — the unit double has no
 * `refreshSession`, and a client that cannot refresh should still get its single
 * retry rather than throwing on the way to it.
 */
async function forceRefresh(): Promise<void> {
  const auth = getSupabase().auth as { refreshSession?: () => Promise<unknown> };
  try {
    await auth.refreshSession?.();
  } catch {
    // A refresh that failed is not itself news: the retry below will produce the
    // real classification, from the real request.
  }
}

/**
 * Pulls throw where pushes classify. A read has no queue behind it and nothing
 * to retire — the worker either got rows or it will ask again on the next tick,
 * and there is no third outcome worth encoding.
 */
/**
 * Only `code` is carried, and that is not an oversight.
 *
 * postgrest-js puts the HTTP status on the *response*, not on the error object,
 * and no call site here destructures it — so `err.status` is always undefined
 * on this path and copying it would be a line that reads like insurance while
 * doing nothing. A rejected JWT is what this needs to survive, and PostgREST
 * names that one in the body: `PGRST301` expired, `PGRST303` not yet valid.
 *
 * What that leaves out: a 401 from the gateway rather than from PostgREST — a
 * wrong API key, say — whose body carries no code at all. That is a build that
 * was never going to work rather than a session that stopped working, and
 * catching it would mean threading `status` through every read here.
 */
function fail(err: WireError): never {
  const e = new Error(describe(err)) as Error & { code?: string };
  e.code = err.code;
  throw e;
}

/**
 * The two circle calls, and why they are not outbox ops.
 *
 * Everything else this client writes is a fact the reducer has already applied
 * and the queue merely owes the server. These are the opposite: the answer is
 * the point. A code is either real or it isn't, and only the server knows —
 * queueing a join would mean telling someone they were in a circle and finding
 * out minutes later that they never were. They are also not replayable in the
 * way an idempotent upsert is: `create_circle` mints a new circle every call.
 *
 * So: direct, online, awaited, with the failure shown on the screen that asked.
 */

/** A code that names no circle. Its own type because it is the one failure the user can fix. */
export class UnknownInviteCode extends Error {
  constructor() {
    super('That code didn’t work.');
    this.name = 'UnknownInviteCode';
  }
}

/**
 * `P0002` is what `join_circle_by_code` raises for a code that matches nothing.
 * Deliberately the same answer for "no such circle" as for a typo — the function
 * is an oracle for guessing codes, so it must not confirm that one exists.
 */
const NO_SUCH_CODE = 'P0002';

export async function createCircle(name: string): Promise<{ id: string; inviteCode: string }> {
  const { data, error } = await getSupabase().rpc('create_circle', { circle_name: name });
  if (error) fail(error);
  // `returns table(...)`, so PostgREST answers with an array of one row.
  const row = (Array.isArray(data) ? data[0] : data) as
    | { id?: unknown; invite_code?: unknown }
    | undefined;
  if (!row?.id) throw new Error('create_circle returned no circle');
  return { id: String(row.id), inviteCode: String(row.invite_code ?? '') };
}

export async function joinCircleByCode(code: string): Promise<string> {
  // Every generated code is lowercase — a slug from `lower(name)` and lowercase
  // hex — but the field that takes it is a shouty one, and the match is exact.
  // Without this a correctly-typed code fails every time, and the error sends
  // the user hunting for a typo that is not there.
  const normalised = code.trim().toLowerCase();
  const { data, error } = await getSupabase().rpc('join_circle_by_code', { code: normalised });
  if (error) {
    if ((error as WireError).code === NO_SUCH_CODE) throw new UnknownInviteCode();
    fail(error);
  }
  if (!data) throw new UnknownInviteCode();
  return String(data);
}

/** The bucket photos live in. Private; reads are signed. See the migration. */
export const MEDIA_BUCKET = 'task-media';

/**
 * Put a photo in the bucket.
 *
 * Kept out of `Transport` on purpose: everything there is JSON on a strictly
 * ordered queue, and this is bytes on an unordered one — see `media.ts` for
 * why those cannot share a lane. It reports rather than throws, like `push`,
 * because the queue behind it can only do two things with the answer.
 *
 * The bytes come from `fetch` on the local `file://` URI rather than from a
 * filesystem module, which keeps this slice free of a native dependency. If
 * that proves unreliable on a real device, this function is the only place
 * that has to change.
 *
 * `upsert` is what makes a retry after a timeout harmless: the first attempt
 * may well have landed, and the second must not fail because of it.
 */
export async function uploadMedia(entry: {
  localUri: string;
  path: string;
}): Promise<{ ok: true } | { ok: false; permanent: boolean; error: string }> {
  let body: ArrayBuffer;
  try {
    const file = await fetch(entry.localUri);
    body = await file.arrayBuffer();
  } catch (err) {
    // The file is gone — evicted from the cache, or the pick never completed.
    // No retry can conjure it back, so this is permanent rather than a
    // network failure that happens to look like one.
    return { ok: false, permanent: true, error: `unreadable: ${describe(asWireError(err))}` };
  }

  try {
    const { error } = await getSupabase()
      .storage.from(MEDIA_BUCKET)
      .upload(entry.path, body, { contentType: 'image/jpeg', upsert: true });
    if (!error) return { ok: true };

    const e = asWireError(error);
    // A refusal from storage is the same two-way decision push makes, and is
    // classified by the same rules: a 413 or a 403 will say the same thing
    // next minute, a dead network will not.
    if (isNetwork(e) || isTransient(e)) return { ok: false, permanent: false, error: describe(e) };
    return { ok: false, permanent: true, error: describe(e) };
  } catch (err) {
    const e = asWireError(err);
    return { ok: false, permanent: !isNetwork(e) && !isTransient(e), error: describe(e) };
  }
}

/**
 * Ask the screener for a verdict on a photo already in the bucket.
 *
 * The other half of `uploadMedia`, and out of `Transport` for the same reason.
 * Until this answers `ready` the row is `pending`, which the storage policy
 * and the table policy both refuse to everyone but the owner — so this call
 * is what makes a photo visible at all, not an afterthought to it.
 *
 * ─── everything unclear is a retry ────────────────────────────────────────
 *
 * Only the literal string `refused` deletes somebody's photo, and only the
 * literal string `ready` publishes it. A network failure, a 500, a body that
 * did not parse, the server's own `waiting`, and any answer this client does
 * not recognise all come back `retry`.
 *
 * That is the opposite polarity to the *server's* fail-closed rule, and the
 * two are not in tension: the server refuses when it cannot judge an image,
 * because the cost there is publishing something unlooked-at. Here the image
 * has already been withheld by the policy, so the cost of guessing is
 * throwing away a photo that nothing was ever wrong with. Each side fails
 * towards the thing it can still take back.
 */
export async function screenMedia(entry: {
  id: string;
  taskId: string;
}): Promise<ScreenOutcome> {
  try {
    const { data, error } = await getSupabase().functions.invoke('screen-task-media', {
      body: { mediaId: entry.id, taskId: entry.taskId },
    });
    if (error) return { state: 'retry', error: describe(asWireError(error)) };

    const state = (data as { state?: unknown } | null)?.state;
    if (state === 'ready') return { state: 'ready' };
    if (state === 'refused') return { state: 'refused' };
    // `waiting` — the outbox has not written the row yet — and anything else.
    return { state: 'retry', error: typeof state === 'string' ? state : 'unreadable reply' };
  } catch (err) {
    return { state: 'retry', error: describe(asWireError(err)) };
  }
}

/** `<owner>/<task>/<media>.jpg` — the shape both storage policies read. */
export const mediaPath = (ownerId: string, taskId: string, mediaId: string): string =>
  `${ownerId}/${taskId}/${mediaId}.jpg`;

/**
 * A readable URL for a photo, for as long as the caller asks.
 *
 * The bucket is private, so this is the only way to draw one — and signing
 * requires the select policy to pass, which is what makes the audience rule
 * reach the file rather than only the row pointing at it. Batched because a
 * pull can carry a whole feed's worth.
 *
 * `seconds` is deliberately not optional. It defaulted to a week, which is the
 * wrong answer for the only caller there is: a URL that long outlives the photo
 * it names — `media.detach` removes the row and the object, and a minted URL
 * goes on resolving regardless — and `moments` is persisted, so it would reach
 * the disk. `lib/mediaUrl.ts` owns the number and the cache in front of it.
 */
export async function signMedia(paths: string[], seconds: number): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await getSupabase()
    .storage.from(MEDIA_BUCKET)
    .createSignedUrls(paths, seconds);
  // A pull that cannot sign is a pull with no pictures in it, not a failed
  // pull: the rows are still worth having, and the next cycle tries again.
  if (error) return {};

  const urls: Record<string, string> = {};
  for (const row of data ?? []) {
    const r = row as { path?: string | null; signedUrl?: string | null };
    if (r.path && r.signedUrl) urls[r.path] = r.signedUrl;
  }
  return urls;
}

export function supabaseTransport(): Transport {
  /**
   * `owner_id` comes from `userId`, which comes from the session. Never from the
   * entry: RLS would refuse a mismatched owner anyway, but a client that even
   * *tries* to name an owner is one payload-shape bug away from writing to
   * someone else's rows.
   */
  const send = async (entry: WireOp, userId: string): Promise<void> => {
    const supabase = getSupabase();

    if (entry.op === 'task.upsert') {
      // Built before the request, so a malformed entry fails as a Malformed
      // rather than as whatever TypeError the mapper happens to raise. Those
      // are indistinguishable from a dead fetch, which is retryable — and a
      // retryable entry that can never succeed blocks every entry behind it
      // for the life of the install.
      let row: Record<string, unknown>;
      try {
        row = { ...taskToRow(entry.task, entry.weekStart, entry.at), owner_id: userId };
      } catch (err) {
        throw new Malformed(err instanceof Error ? err.message : String(err));
      }
      const { error } = await supabase.from('tasks').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      return;
    }

    if (entry.op === 'task.delete') {
      // Deleting a row that isn't there is a no-op that answers 200. That is what
      // makes a retry after a timeout harmless: the first attempt may well have
      // landed, and the second must not be able to fail because of it.
      const { error } = await supabase.from('tasks').delete().eq('id', entry.taskId);
      if (error) throw error;
      return;
    }

    if (entry.op === 'reaction.add') {
      // `ignoreDuplicates` because the unique tuple IS the toggle: a replay that
      // collides has already achieved its intent, and there is nothing on the row
      // worth updating — `created_at` should stay the moment of the first cheer.
      const { error } = await supabase.from('reactions').upsert(
        {
          actor_id: userId,
          target_type: TARGET_TYPE,
          target_id: entry.targetId,
          kind: entry.kind,
        },
        { onConflict: 'actor_id,target_type,target_id,kind', ignoreDuplicates: true },
      );
      if (error) throw error;
      return;
    }

    if (entry.op === 'reaction.remove') {
      // Matched on the natural key, never on `reactions.id`: the id is server-
      // generated and the client is never told its own. The unique tuple names
      // the row exactly as precisely, and it is the only name this device has.
      const { error } = await supabase.from('reactions').delete().match({
        actor_id: userId,
        target_type: TARGET_TYPE,
        target_id: entry.targetId,
        kind: entry.kind,
      });
      if (error) throw error;
      return;
    }

    if (entry.op === 'device.register') {
      // An RPC rather than a table write, because `device_tokens` is granted to
      // nobody: an upsert needs SELECT to resolve `on conflict`, so a client
      // writing the table directly would have to be granted the read that keeps
      // everyone's device list private. This is the client half of that.
      //
      // No profile id in the payload — the function reads `auth.uid()`, which
      // `drain` has already resolved for this send.
      const { error } = await supabase.rpc('register_device', {
        p_token: entry.token,
        p_platform: entry.platform,
      });
      if (error) throw error;
      return;
    }

    if (entry.op === 'report.file') {
      // An RPC, like `register_device`, and for the same reason: `reports` is
      // readable by nobody, and a client granted only INSERT could not resolve
      // its own row back to check it, which upsert-style dedupe would need.
      // `report_content` does not dedupe anyway — see the migration — so this
      // is a plain fire-and-forget call.
      const { error } = await supabase.rpc('report_content', {
        p_subject_kind: entry.subjectKind,
        p_subject_id: entry.subjectId,
        p_reason: entry.reason,
      });
      if (error) throw error;
      return;
    }

    if (entry.op === 'block.add') {
      // `block_person` is `on conflict do nothing` inside the function itself,
      // so a replay of an already-applied block returns cleanly with no error
      // to classify — unlike `reaction.add`, there is no 23505 path here at
      // all. What it does raise: 22023 for a bot (`invalid_parameter_value`)
      // and 23514 for yourself (`blocks_not_self`). Neither is in `isNetwork`
      // or `isTransient`, so `classify` already falls them through to its
      // default branch — permanent — which is what they must be: no retry
      // turns a bot into a person or turns you into someone else.
      const { error } = await supabase.rpc('block_person', { p_blocked: entry.blockedId });
      if (error) throw error;
      return;
    }

    if (entry.op === 'block.remove') {
      // `unblock_person` deletes-if-present and never errors on "not found",
      // the same shape as `task.delete` and for the same reason: a retry after
      // a timeout must not be able to fail because the first attempt landed.
      const { error } = await supabase.rpc('unblock_person', { p_blocked: entry.blockedId });
      if (error) throw error;
      return;
    }

    if (entry.op === 'rollup.add') {
      // `ignoreDuplicates` for the reason `reaction.add` uses it: a replay has
      // already achieved its intent. A week closes once, so there is nothing on
      // the row worth updating — and the table grants insert only, so an upsert
      // that fell back to updating would be a permanent 42501 at the head of the
      // queue. Measured against the real policy before it was written: the
      // second insert answers `INSERT 0 0` and leaves the first row alone.
      const { error } = await supabase.from('week_rollups').upsert(
        {
          profile_id: userId,
          week_start: entry.weekStart,
          points: entry.points,
          done: entry.done,
          total: entry.total,
          perfect: entry.perfect,
          streak_held: entry.streakHeld,
        },
        { onConflict: 'profile_id,week_start', ignoreDuplicates: true },
      );
      if (error) throw error;
      return;
    }

    if (entry.op === 'media.attach') {
      // `ignoreDuplicates` for the reason `reaction.add` uses it: a replay has
      // already achieved its intent. The pk is client-minted, so a second
      // delivery collides with itself rather than attaching the same photo
      // twice — and `unique (task_id)` would refuse it anyway.
      const { error } = await supabase.from('task_media').upsert(
        {
          id: entry.mediaId,
          task_id: entry.taskId,
          owner_id: userId,
          path: entry.path,
          width: entry.width,
          height: entry.height,
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );
      if (error) throw error;
      return;
    }

    if (entry.op === 'media.detach') {
      // Row first, then object — the opposite order to `clearAvatar`, and the
      // inversion is the whole reason this is worth a comment.
      //
      // There, the bucket's select policy is `bucket_id = 'avatars'` for every
      // signed-in account, so an object that outlives its row stays readable to
      // anyone who learns the name: the bytes have to go first. Here
      // `private.can_see_media` refuses an object no `ready` row claims, so
      // deleting the row is itself what makes the file unreadable. The storage
      // delete that follows is reclaiming space, not closing a hole — and if it
      // fails, what is left is an orphan nobody can address.
      const { error } = await supabase.from('task_media').delete().eq('id', entry.mediaId);
      if (error) throw error;

      // Derived from the session, never carried. See the op's own comment.
      const path = mediaPath(userId, entry.taskId, entry.mediaId);
      const { error: objErr } = await supabase.storage.from(MEDIA_BUCKET).remove([path]);
      if (objErr) throw objErr;
      return;
    }

    if (entry.op === 'profile.update') {
      // An UPDATE, never an upsert. `profiles` is granted `select, update` only
      // and has no INSERT policy — the row is made by the `on_auth_user_created`
      // trigger — so an upsert that had to fall back to inserting would be a
      // permanent 42501 sitting at the head of the queue forever.
      //
      // `handle` is deliberately not written. It is unique, so a collision is a
      // 23505 that no retry can clear, and the generated one is already valid.
      const { error } = await supabase
        .from('profiles')
        .update({ name: entry.name })
        .eq('id', userId);
      if (error) throw error;
      return;
    }

    // Built before the request, for the same reason task.upsert's row is.
    let row: Record<string, unknown>;
    try {
      row = { ...noteToRow(entry.note), author_id: userId };
    } catch (err) {
      throw new Malformed(err instanceof Error ? err.message : String(err));
    }
    // The client-minted pk is what makes an append-only table replayable: a
    // second delivery collides with itself instead of saying the same thing
    // twice on someone's screen.
    const { error } = await supabase.from('notes').upsert(row, { onConflict: 'id' });
    if (error) throw error;
  };

  const push = async (entry: WireOp, userId: string): Promise<PushResult> => {
    try {
      await send(entry, userId);
      return { ok: true };
    } catch (err) {
      if (writes(entry.op) && isAlreadyDone(err)) return { ok: true };
      if (!isAuthExpired(asWireError(err))) return classify(err);

      await forceRefresh();
      try {
        await send(entry, userId);
        return { ok: true };
      } catch (again) {
        if (writes(entry.op) && isAlreadyDone(again)) return { ok: true };
        // Still 401 with a fresh token means the token was never the problem —
        // retrying it further is a loop, so it stops being retryable here.
        const e = asWireError(again);
        if (isAuthExpired(e)) {
          return { ok: false, retryable: false, code: e.code ?? '401', error: describe(e) };
        }
        return classify(again);
      }
    }
  };

  const resumePendingAvatar = async (userId: string): Promise<void> => {
    try {
      const { data, error } = await getSupabase()
        .from('profiles')
        .select('avatar_state')
        .eq('id', userId);
      if (error) return;
      const state = (data ?? [])[0] as { avatar_state?: unknown } | undefined;
      if (avatarStateOf(state?.avatar_state) !== 'pending') return;
      // The same call `pickAndUploadAvatar` makes, and it reads `auth.uid()`
      // itself — there is no path or profile in the body for this device to get
      // wrong about which photo it is finishing.
      await getSupabase().functions.invoke('screen-image', { body: {} });
    } catch {
      // Offline, or a screener having a bad day. Both are "not today": the row
      // stays `pending`, which renders initials, and the next launch tries again.
    }
  };

  const pullTasks = async (userId: string, weekStart: string): Promise<Task[]> => {
    const { data, error } = await getSupabase()
      .from('tasks')
      .select('*')
      .eq('owner_id', userId)
      .eq('week_start', weekStart);
    if (error) fail(error);
    return (data ?? []).map((row) => rowToTask(row as Record<string, unknown>));
  };

  /**
   * Three round trips rather than one embedded select: `select('*, profiles(*)')`
   * is a PostgREST-only shape that no test double can honestly reproduce, and the
   * membership hop has to be explicit anyway — you can only see the profiles of
   * people who share a circle with you, and that is a join RLS enforces per row.
   */
  const pullCircle = async (userId: string): Promise<Person[]> => {
    const supabase = getSupabase();

    const mine = await supabase.from('circle_members').select('circle_id').eq('profile_id', userId);
    if (mine.error) fail(mine.error);
    const circleIds = (mine.data ?? []).map((r) => (r as { circle_id: unknown }).circle_id);

    const members = circleIds.length
      ? await supabase.from('circle_members').select('profile_id').in('circle_id', circleIds)
      : { data: [] as unknown[], error: null };
    if (members.error) fail(members.error);
    // Your own row, always, whether or not you are in a circle with anybody.
    // It used to arrive only as a by-product of sharing a circle — fine while
    // a profile was a name you had typed yourself, and wrong the moment it
    // carries a column only the server can write: an account on its own would
    // never learn that its own photo had been screened, and Settings would
    // offer to add one over a photo that was already there.
    const profileIds = [
      userId,
      ...new Set((members.data ?? []).map((r) => (r as { profile_id: unknown }).profile_id)),
    ];

    const profiles = await supabase.from('profiles').select(PROFILE_COLUMNS).in('id', profileIds);
    if (profiles.error) fail(profiles.error);
    return (profiles.data ?? []).map((row) => rowToPerson(row as Record<string, unknown>));
  };

  /**
   * Other people's weeks — the read that makes this a circle rather than a
   * synced private tracker, and the same read the Global feed needs.
   *
   * Scoped to ids the caller has just been given rather than to "everything the
   * week holds". RLS decides *what* of theirs is visible — the audience rule
   * lives there and is not restated here — and this decides *whose* to ask
   * about, which is the part the client legitimately owns. Whose changes with
   * the feed: circle-mates for Friends, bots for Global. The query does not.
   */
  const pullTasksByOwners = async (
    ownerIds: string[],
    weekStart: string,
  ): Promise<Record<string, unknown>[]> => {
    if (ownerIds.length === 0) return [];
    const { data, error } = await getSupabase()
      .from('tasks')
      .select('*')
      .in('owner_id', ownerIds)
      .eq('week_start', weekStart);
    if (error) fail(error);
    return (data ?? []) as Record<string, unknown>[];
  };

  /**
   * The Oz bots, who are openly not people.
   *
   * `profiles_select` names `is_bot` explicitly, so these are the only rows
   * anybody can read without sharing a circle — which is what lets a brand-new
   * account render a name instead of "Someone". Asked for as its own hop for
   * the reason `pullCircle` is three: an embedded select is a PostgREST-only
   * shape no test double can honestly reproduce.
   */
  const pullBots = async (): Promise<Person[]> => {
    const { data, error } = await getSupabase()
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('is_bot', true);
    if (error) fail(error);
    // Deliberately unflagged. `circleMembers` needs to know which of these are
    // bots, but the engine derives that from this query's *id set* after it
    // dedupes the directory — stamping it here would be lost the moment the
    // circle read returned the same row first. See `engine.ts`.
    return (data ?? []).map((row) => rowToPerson(row as Record<string, unknown>));
  };

  /**
   * How many *other* people have cheered each of these tasks.
   *
   * Deliberately excludes you. The obvious shape — a total including your own
   * cheer — forces every caller to work out whether the server has heard about
   * your tap yet, and to add one when it hasn't; get that wrong in either
   * direction and the number is off by one for exactly as long as the queue is
   * busy. Asking for everyone else's makes the screen's job addition: this,
   * plus the cheer it already knows you made.
   */
  const pullCheerCounts = async (
    taskIds: string[],
    userId: string,
  ): Promise<Record<string, number>> => {
    if (taskIds.length === 0) return {};
    const { data, error } = await getSupabase()
      .from('reactions')
      .select('target_id')
      .eq('target_type', TARGET_TYPE)
      .eq('kind', 'cheer')
      .neq('actor_id', userId)
      .in('target_id', taskIds);
    if (error) fail(error);

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const id = String((row as { target_id: unknown }).target_id);
      counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  };

  /**
   * Your notification feed. Yours alone — `notifications_select` is scoped to
   * the recipient, not to the circle — and capped, because the bell shows a
   * list rather than a history.
   */
  const pullNotifications = async (
    userId: string,
    limit: number,
  ): Promise<Record<string, unknown>[]> => {
    const { data, error } = await getSupabase()
      .from('notifications')
      .select('id,tier,kind,payload,read_at,created_at')
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) fail(error);
    return (data ?? []) as Record<string, unknown>[];
  };

  /**
   * The circle you are in — deliberately a different question from `pullCircle`,
   * which answers "who shares a circle with me". Same first hop, different shape
   * and different consumers, and one function that answered both would be one
   * you could not describe without an "and".
   *
   * First circle only. The schema allows several; the UI has always shown one.
   */
  /**
   * Every week this account has closed, oldest first.
   *
   * Unbounded on purpose, and safe to be: one row per person per week, so a year
   * is 52 and the table cannot grow faster than the calendar. A limit here would
   * silently truncate somebody's history at exactly the moment they were trying
   * to get it back.
   */
  const pullRollups = async (userId: string): Promise<PulledRollup[]> => {
    const { data, error } = await getSupabase()
      .from('week_rollups')
      .select('week_start,points,done,total,perfect,streak_held')
      .eq('profile_id', userId)
      .order('week_start', { ascending: true });
    if (error) fail(error);

    return (data ?? []).map((row) => rowToPulledRollup(row as Record<string, unknown>));
  };

  /**
   * The block list. `userId` names nobody in the query — `blocks_select`
   * already reads it off `auth.uid()`, and a `.eq('blocker_id', userId)` here
   * would be pure restatement, not narrowing. Present in the signature only
   * because every other pull in `Transport` takes it.
   */
  const pullBlocks = async (userId: string): Promise<string[]> => {
    const { data, error } = await getSupabase().from('blocks').select('blocked_id');
    if (error) fail(error);
    return (data ?? []).map((row) => String((row as { blocked_id: unknown }).blocked_id));
  };

  const pullMyCircle = async (userId: string): Promise<CircleRef | null> => {
    const supabase = getSupabase();

    const mine = await supabase
      .from('circle_members')
      .select('circle_id')
      .eq('profile_id', userId)
      .limit(1);
    if (mine.error) fail(mine.error);
    const circleId = (mine.data ?? [])[0]?.circle_id;
    if (!circleId) return null;

    // `circles_select` is membership-scoped, so this can only ever answer for a
    // circle the caller is in — the id above is not a capability on its own.
    const row = await supabase
      .from('circles')
      .select('id,name,invite_code')
      .eq('id', circleId)
      .limit(1);
    if (row.error) fail(row.error);
    const circle = (row.data ?? [])[0];
    if (!circle) return null;

    return {
      id: String(circle.id),
      name: String(circle.name ?? ''),
      inviteCode: String(circle.invite_code ?? ''),
    };
  };

  /**
   * Your own reactions, which is all `acted` can hold: it is a set of taps *this*
   * user made, with no room for whose they were. Other people's cheers arrive as
   * counts on a moment, which is a different read.
   */
  const pullReactions = async (userId: string): Promise<ReactionRef[]> => {
    const { data, error } = await getSupabase()
      .from('reactions')
      .select('target_id,kind')
      .eq('actor_id', userId)
      .eq('target_type', TARGET_TYPE);
    if (error) fail(error);

    return (data ?? []).flatMap(rowToReactionRef);
  };

  /**
   * Notes on your tasks, and notes addressed to you — the two the client has
   * somewhere to put. Notes you wrote on someone else's task are deliberately
   * not here: this device already has them, and a second device would need the
   * feed's task ids to place them, which it does not have yet.
   *
   * Three round trips and no `or()`, for the reason `pullCircle` gives: the shape
   * has to be one a test double can honestly reproduce. `notes_exactly_one_target`
   * makes the two sets disjoint, so there is nothing to deduplicate.
   */
  const pullNotes = async (userId: string): Promise<PulledNote[]> => {
    const supabase = getSupabase();

    const mine = await supabase.from('tasks').select('id').eq('owner_id', userId);
    if (mine.error) fail(mine.error);
    const taskIds = (mine.data ?? []).map((r) => (r as { id: unknown }).id);

    const toMe = await supabase.from('notes').select('*').eq('recipient_id', userId);
    if (toMe.error) fail(toMe.error);

    let onMine: unknown[] = [];
    if (taskIds.length > 0) {
      const res = await supabase.from('notes').select('*').in('task_id', taskIds);
      if (res.error) fail(res.error);
      onMine = res.data ?? [];
    }

    return [...(toMe.data ?? []), ...onMine].flatMap(rowToPulledNote);
  };

  /**
   * The whole pull in one round trip — `pull_world` on the server, which runs
   * the same queries the per-table pulls make, as the caller, under the same
   * RLS, inside one statement. See the migration for why SECURITY INVOKER is
   * the load-bearing part.
   *
   * `null` means the server does not have the function: `PGRST202` is
   * PostgREST's "not in my schema cache", `42883` is Postgres's "no such
   * function" — both are facts about the deployment, not about this request,
   * so the caller is right to remember the answer and stop asking. Every other
   * failure throws, exactly as the per-table pulls do.
   */
  const pullWorld = async (
    weekStart: string | null,
    notifLimit: number,
  ): Promise<World | null> => {
    const { data, error } = await getSupabase().rpc('pull_world', {
      p_week_start: weekStart,
      p_notif_limit: notifLimit,
    });
    if (error) {
      const code = (error as WireError).code ?? '';
      if (code === 'PGRST202' || code === '42883') return null;
      fail(error as WireError);
    }

    const w = (data ?? {}) as Record<string, unknown>;
    const rows = (v: unknown): Record<string, unknown>[] =>
      Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

    const circleRow = (w.circle ?? null) as Record<string, unknown> | null;
    const circle: CircleRef | null = circleRow?.id
      ? {
          id: String(circleRow.id),
          name: String(circleRow.name ?? ''),
          inviteCode: String(circleRow.invite_code ?? ''),
        }
      : null;

    // Counted server-side, but still narrowed here: a count is untrusted input
    // like any row, and NaN in a cheer chip is worse than no chip.
    const cheerCounts: Record<string, number> = {};
    if (w.cheer_counts && typeof w.cheer_counts === 'object' && !Array.isArray(w.cheer_counts)) {
      for (const [id, n] of Object.entries(w.cheer_counts as Record<string, unknown>)) {
        const count = Number(n);
        if (Number.isFinite(count)) cheerCounts[id] = count;
      }
    }

    return {
      people: rows(w.people).map(rowToPerson),
      bots: rows(w.bots).map(rowToPerson),
      circle,
      notifications: rows(w.notifications),
      // Null and empty stay distinct across the wire — see `World.myTasks`.
      myTasks: w.my_tasks == null ? null : rows(w.my_tasks).map(rowToTask),
      ownerTasks: rows(w.owner_tasks),
      // `== null` on purpose: it catches the null a week-less pull sends *and*
      // the `undefined` a server that predates this key sends. Those mean the
      // same thing — this pull cannot say — and the alternative is a client
      // deleting every photo it has because an older server said nothing.
      media: w.media == null ? null : rows(w.media).flatMap(rowToPulledMedia),
      reactions: rows(w.reactions).flatMap(rowToReactionRef),
      notes: rows(w.notes).flatMap(rowToPulledNote),
      rollups: rows(w.rollups).map(rowToPulledRollup),
      cheerCounts,
    };
  };

  return {
    push,
    pullWorld,
    pullTasks,
    pullCircle,
    pullMyCircle,
    pullRollups,
    pullNotifications,
    pullTasksByOwners,
    pullBots,
    pullCheerCounts,
    pullReactions,
    pullNotes,
    pullBlocks,
    resumePendingAvatar,
  };
}
