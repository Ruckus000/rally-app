/**
 * Delete the files the database cannot reach.
 *
 *   POST {} -> { drained: number, swept: number, failed: number }
 *
 * `task_media.task_id` cascades from `tasks`, and the cascade takes the row and
 * leaves the object, because Postgres deletes rows and the bytes live in a
 * bucket. This is the thing that goes and gets them.
 *
 * Two inputs, and the difference between them is how sure they are.
 *
 * `media_gc` is certain. A trigger wrote each path the moment its row left
 * `task_media`, inside that transaction, so every entry is a file whose row is
 * definitely gone. Those are deleted with no waiting.
 *
 * `orphaned_media` is a guess, and it is what catches the objects the trigger
 * was never told about: the ones orphaned before the trigger existed, and the
 * ones whose row was never written at all because the upload landed and the
 * outbox entry did not survive. It has to be a guess, because an object no row
 * names is also exactly what a live upload looks like in the seconds between
 * its bytes landing and its row being written — `src/sync/media.ts` writes the
 * row second, deliberately, so a row never points at a file that is not there.
 * `GRACE` is the whole defence against deleting somebody's photo while they
 * are looking at it, which is why it is generous rather than tight.
 *
 * ─── no JWT, one secret ───────────────────────────────────────────────────
 *
 * Called by a trigger, which is not a user and carries no session. The
 * `x-webhook-secret` header is the entire authorisation story, exactly as it is
 * for `push`. Refusing every request when the secret is unset is deliberate:
 * an unset secret is a misconfiguration, and the safe reading of "I cannot tell
 * who is asking" is not "delete some files".
 *
 * ─── why a failure here is quiet ──────────────────────────────────────────
 *
 * Nothing upstream is waiting on the answer. The trigger's `net.http_post` is
 * fire-and-forget and its transaction has long since committed, so a 500 here
 * reaches nobody. What keeps that honest is that a path is only removed from
 * `media_gc` once storage has answered without an error — anything else leaves
 * the row where it is, with `tries` bumped, to be tried again on the next
 * nudge. The queue is the memory; this function is only the hands.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const BUCKET = 'task-media';

/**
 * How old an unclaimed object must be before it counts as garbage.
 *
 * An upload that has landed is waiting on one outbox round trip, measured in
 * seconds. An hour is far past that, and the cost of being generous is a file
 * that lingers for an hour longer — against the cost of being tight, which is
 * a photo deleted out from under the person who just took it.
 */
const GRACE = '1 hour';

/**
 * One nudge, one batch. The queue is drained by however many nudges it takes,
 * and a nudge arrives with every delete, so a backlog clears on its own. A
 * larger number here would mostly buy a longer request.
 */
const BATCH = 100;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

/** Length-first, then constant-time. Copied from `push` on purpose. */
function secretMatches(given: string | null, expected: string): boolean {
  if (!given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const expected = Deno.env.get('COLLECT_MEDIA_WEBHOOK_SECRET');
  if (!expected) {
    console.error('COLLECT_MEDIA_WEBHOOK_SECRET is not set; refusing every request.');
    return json({ error: 'unconfigured' }, 500);
  }
  if (!secretMatches(req.headers.get('x-webhook-secret'), expected)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  /**
   * Ask storage to delete these, and say whether it agreed.
   *
   * A path that is not there is not a failure. `media.detach` deletes the
   * object from the client and the trigger enqueues the same path, so the
   * common case for a queued entry is that the file has already gone — and the
   * end state we want is precisely "it is not there". Storage returns those
   * silently rather than as errors, which is the behaviour this relies on.
   */
  const removeAll = async (paths: string[]): Promise<string | null> => {
    if (!paths.length) return null;
    const { error } = await db.storage.from(BUCKET).remove(paths);
    return error ? error.message : null;
  };

  let drained = 0;
  let swept = 0;
  let failed = 0;

  // ── 1. The certain ones ────────────────────────────────────────────────
  //
  // Oldest first, so a path that keeps failing cannot be starved by newer
  // arrivals and sit at the back of the queue forever unnoticed.
  const { data: queue, error: queueError } = await db
    .from('media_gc')
    .select('path, tries')
    .order('enqueued_at', { ascending: true })
    .limit(BATCH);

  if (queueError) {
    console.error('media_gc read failed:', queueError.message);
    return json({ error: 'queue-unreadable' }, 500);
  }

  const rows = (queue ?? []) as { path: string; tries: number }[];
  if (rows.length) {
    const failure = await removeAll(rows.map((r) => r.path));
    if (failure) {
      failed = rows.length;
      // Left in the queue on purpose. The row is the only record that this
      // file needs deleting; dropping it on a failure is the original bug
      // rebuilt inside its own fix.
      console.error(`storage remove failed for ${rows.length} paths:`, failure);
      for (const r of rows) {
        await db
          .from('media_gc')
          .update({ tries: r.tries + 1, last_error: failure.slice(0, 500) })
          .eq('path', r.path);
      }
    } else {
      const { error } = await db
        .from('media_gc')
        .delete()
        .in(
          'path',
          rows.map((r) => r.path),
        );
      if (error) {
        // The files are gone and the rows are not. Harmless — the next run
        // asks storage to delete what is already deleted and tries again.
        console.error('media_gc drain failed:', error.message);
      } else {
        drained = rows.length;
      }
    }
  }

  // ── 2. The guesses ─────────────────────────────────────────────────────
  //
  // Runs on every nudge rather than on a schedule, because there is no
  // scheduler: `pg_cron` is not installed and this is not worth installing one
  // for. A nudge arrives with every photo or goal deleted anywhere in the app,
  // which is often enough for garbage that is by definition already stale.
  const { data: orphans, error: orphanError } = await db.rpc('orphaned_media', {
    p_min_age: GRACE,
  });

  if (orphanError) {
    console.error('orphaned_media failed:', orphanError.message);
  } else {
    const paths = ((orphans ?? []) as { path: string }[]).map((r) => r.path);
    if (paths.length) {
      const failure = await removeAll(paths.slice(0, BATCH));
      if (failure) {
        // Not counted as `failed`: nothing was promised about these. They have
        // no queue row, they are found by looking rather than by being told,
        // and the next nudge finds them again.
        console.error('sweep failed:', failure);
      } else {
        swept = Math.min(paths.length, BATCH);
      }
    }
  }

  return json({ drained, swept, failed });
});
