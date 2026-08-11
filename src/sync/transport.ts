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

/**
 * One pending mutation. Defined here, with the code that puts it on the wire,
 * because the wire is what constrains it: `at` is the `updated_at` that
 * last-write-wins compares, and `weekStart` is resolved at enqueue time so a
 * queued task cannot drift into a different week while it waits offline.
 *
 * `owner_id` is conspicuously absent. It is stamped from the session at push
 * time — see `push` — and a payload that could name its own owner is a payload
 * that can write to someone else's account.
 */
export type WireOp =
  | { id: string; at: number; op: 'task.upsert'; task: Task; weekStart: string }
  | { id: string; at: number; op: 'task.delete'; taskId: string };

export type PushResult =
  | { ok: true }
  | { ok: false; retryable: true; error: string }
  | { ok: false; retryable: false; code: string; error: string };

export type Transport = {
  push(entry: WireOp, userId: string): Promise<PushResult>;
  pullTasks(userId: string, weekStart: string): Promise<Task[]>;
  pullCircle(userId: string): Promise<Person[]>;
};

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
      const row = { ...taskToRow(entry.task, entry.weekStart, entry.at), owner_id: userId };
      const { error } = await supabase.from('tasks').upsert(row, { onConflict: 'id' });
      if (error) throw error;
      return;
    }

    // Deleting a row that isn't there is a no-op that answers 200. That is what
    // makes a retry after a timeout harmless: the first attempt may well have
    // landed, and the second must not be able to fail because of it.
    const { error } = await supabase.from('tasks').delete().eq('id', entry.taskId);
    if (error) throw error;
  };

  const push = async (entry: WireOp, userId: string): Promise<PushResult> => {
    try {
      await send(entry, userId);
      return { ok: true };
    } catch (err) {
      if (entry.op === 'task.upsert' && isAlreadyDone(err)) return { ok: true };
      if (!isAuthExpired(asWireError(err))) return classify(err);

      await forceRefresh();
      try {
        await send(entry, userId);
        return { ok: true };
      } catch (again) {
        if (entry.op === 'task.upsert' && isAlreadyDone(again)) return { ok: true };
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

  return { push, pullTasks, pullCircle };
}
