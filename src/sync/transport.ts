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
import type { Task } from '../data/fixtures';
import type { Person } from '../data/people';
import { getSupabase } from '../lib/supabase';
import { rowToPerson, rowToTask, taskToRow } from './mappers';
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
  | { id: string; at: number; op: 'profile.update'; name: string };

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

export type Transport = {
  push(entry: WireOp, userId: string): Promise<PushResult>;
  pullTasks(userId: string, weekStart: string): Promise<Task[]>;
  pullCircle(userId: string): Promise<Person[]>;
  pullReactions(userId: string): Promise<ReactionRef[]>;
  pullNotes(userId: string): Promise<PulledNote[]>;
};

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

/** An expired access token — recoverable exactly once, by refreshing it. */
function isAuthExpired(e: WireError): boolean {
  return e.status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303';
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
const writes = (op: WireOp['op']): boolean => op !== 'task.delete' && op !== 'reaction.remove';

const isKind = (v: string): v is ReactionKind => (REACTION_KINDS as readonly string[]).includes(v);

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
    if (circleIds.length === 0) return [];

    const members = await supabase.from('circle_members').select('profile_id').in('circle_id', circleIds);
    if (members.error) fail(members.error);
    const profileIds = [
      ...new Set((members.data ?? []).map((r) => (r as { profile_id: unknown }).profile_id)),
    ];
    if (profileIds.length === 0) return [];

    const profiles = await supabase.from('profiles').select('id,handle,name').in('id', profileIds);
    if (profiles.error) fail(profiles.error);
    return (profiles.data ?? []).map((row) => rowToPerson(row as Record<string, unknown>));
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

    return (data ?? []).flatMap((r) => {
      const row = r as { target_id: unknown; kind: unknown };
      const kind = String(row.kind);
      // A kind a newer build invented. Dropping it beats rendering it as
      // whichever kind this build would fall back to.
      return isKind(kind) ? [{ targetId: String(row.target_id), kind }] : [];
    });
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

    return [...(toMe.data ?? []), ...onMine].flatMap((r) => {
      const row = r as Record<string, unknown>;
      // The CHECK guarantees exactly one target, but a row is untrusted input
      // like any other: one that somehow names neither is dropped rather than
      // given a target the client invents for it.
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
    });
  };

  return { push, pullTasks, pullCircle, pullReactions, pullNotes };
}
