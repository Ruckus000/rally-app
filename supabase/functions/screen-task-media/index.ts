/**
 * Ask the model about a goal photo before anybody else can fetch it.
 *
 *   POST { mediaId, taskId } -> { state: 'ready' | 'refused' | 'waiting' }
 *
 * `screen-image`'s sibling, and most of that file's reasoning is this file's
 * too: it holds the service-role key, it is the only caller of the one RPC
 * that can publish an image, and every path that is not a model saying
 * `harmful: false` ends in a refusal. Read it first. What follows is only
 * where the two differ, and each difference has a reason that is about goal
 * photos rather than about taste.
 *
 * ─── it takes an argument, which its sibling refuses to ───────────────────
 *
 * `screen-image` deliberately has no body: the subject is always the caller,
 * because a profile id in the request would let any signed-in account point
 * the one key that can publish at somebody else's row.
 *
 * A person has one avatar and many goals, so that trick is not available
 * here — this has to be told *which* photo. The property is kept a different
 * way: the row is looked up by `id` **and** `owner_id = caller`, so a
 * `mediaId` naming somebody else's photo selects nothing and comes back
 * `waiting`, exactly as an id that never existed does. The argument chooses
 * among the caller's own photos and can reach nothing else.
 *
 * `taskId` is only ever used to build a storage prefix when there is no row,
 * and the owner segment of that prefix comes from the token rather than the
 * body — so the worst a wrong `taskId` can do is make this look in one of the
 * caller's own empty folders and answer `waiting`. Where there *is* a row, its
 * own `task_id` is used instead: the row is the more authoritative of the two.
 *
 * ─── the object name is derived, never read ───────────────────────────────
 *
 * This function downloads an object and, on a refusal, deletes it — both with
 * the service role, which no policy applies to. So the string naming that
 * object is built from the verified token and the row, and `task_media.path`
 * is not consulted at all.
 *
 * That column is constrained to exactly this string by
 * `20260820020000_task_media_screened.sql`, so reading it would in fact be
 * safe today. Deriving it keeps this function safe if the constraint is ever
 * loosened — and a client-chosen name reaching a service-role `remove()` is
 * precisely how one account would delete another account's photo.
 *
 * ─── three answers, because the row may legitimately not be there yet ─────
 *
 * The client uploads the object first and writes the row second — through the
 * outbox, because the row references a task that may itself still be queued
 * (see `src/sync/media.ts`). So "no row" is an ordinary, temporary state, not
 * an error, and it must be told apart from "refused" or the client would
 * delete a photo that was merely early.
 *
 * The object is what tells them apart:
 *
 *   pending row          -> screen it now
 *   ready row            -> `ready`, no second model call
 *   no row, object there -> `waiting`; the outbox has not caught up
 *   no row, no object    -> `refused`; this function already blocked it
 *
 * ─── refusing means deleting both halves ─────────────────────────────────
 *
 * `screen-image` deletes the object and marks the row `refused`. Here the row
 * goes too, and `20260820020000_task_media_screened.sql` argues why:
 * `unique (task_id)` means a kept refusal would occupy the goal's only photo
 * slot forever, so a blocked attempt has to leave the task as it found it.
 *
 * Object first, then row — the same order and the same reason as its sibling.
 * If the delete fails, the row stays `pending`, which no one but the owner can
 * read; if the row delete fails after the object is gone, a later call finds a
 * `pending` row whose download fails and refuses it again. Both failures
 * converge on blocked rather than on published.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { complete } from '../_shared/llm.ts';
import { GOAL_IMAGE_SCREENING } from '../_shared/imageScreening.mjs';
import { imageVerdict } from '../_shared/imageVerdict.mjs';

/** Matches `imageScreening.mjs`, and matches `screen-image` exactly. */
const SCREEN_SCHEMA = {
  type: 'object',
  properties: { harmful: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['harmful', 'reason'],
} as const;

const BUCKET = 'task-media';

/** What the bucket accepts, restated for the reason `screen-image` gives. */
const SCREENABLE = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Shares `rate-goal`'s and `screen-image`'s counter, and blocks when over.
 *
 * One quota, one counter, and the same asymmetry: over the cap is a reason to
 * hold an image back, never a reason to publish one unlooked-at.
 */
const DAILY_CAP = 200;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // The explicit token, for the reason `rate-goal` and `screen-image` both
  // spell out: with no argument `getUser()` looks for a stored session an edge
  // function never has.
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '');
  const { data: auth } = await db.auth.getUser(token);
  const userId = auth?.user?.id;
  if (!userId) return json({ error: 'not signed in' }, 401);

  let mediaId = '';
  let taskId = '';
  try {
    const body = await req.json();
    mediaId = typeof body?.mediaId === 'string' ? body.mediaId : '';
    taskId = typeof body?.taskId === 'string' ? body.taskId : '';
  } catch {
    // No body, or not JSON. Falls through to the uuid checks below.
  }
  // Checked here rather than relied on downstream: an id that is not a uuid
  // would raise 22P02 inside the query rather than returning no rows, and one
  // with a slash in it would walk out of the prefix `absentMeans` builds.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID.test(mediaId) || !UUID.test(taskId)) return json({ error: 'bad ids' }, 400);

  // `owner_id` in the filter is what keeps this function pointed at the
  // caller's own photos — see the header. It is not a redundant check on top
  // of the id; it is the whole of the authorisation.
  const { data: row, error: readErr } = await db
    .from('task_media')
    .select('task_id, state')
    .eq('id', mediaId)
    .eq('owner_id', userId)
    .maybeSingle();

  if (readErr) {
    console.warn(`screen-task-media: read failed for ${mediaId} — ${readErr.message}`);
    return json({ error: 'lookup failed' }, 503);
  }

  if (!row) return json({ state: await absentMeans(db, userId, taskId, mediaId) });
  if (row.state !== 'pending') return json({ state: row.state });

  // Built here, never read from the row.
  //
  // This function holds the service role and both downloads and deletes this
  // object, so the string that names it must not be one a client chose.
  // `20260820020000` constrains `task_media.path` to exactly this, which makes
  // reading the column safe — and deriving it anyway makes the guarantee stand
  // on its own rather than on that constraint still being there.
  //
  // Every part comes from something already checked: `userId` off the verified
  // token, `task_id` off the row that the query proved belongs to that user,
  // and `mediaId` from a body that had to match a uuid to get here. The
  // `taskId` in the request is not used — only `absentMeans` reads it, where
  // there is no row to be more authoritative.
  const path = `${userId}/${row.task_id}/${mediaId}.jpg`;

  if (await overCap(db, userId)) {
    console.warn(`screen-task-media: ${userId} over the daily cap of ${DAILY_CAP} — refusing`);
    return json({ state: await refuse(db, mediaId, path) });
  }

  // Service role, because the bucket is private and — since this migration —
  // its select policy requires a `ready` row. The screener is the only reader
  // that has to see the bytes before anything says they are safe, and RLS is
  // bypassed here rather than holed for it.
  const { data: blob, error: dlErr } = await db.storage.from(BUCKET).download(path);
  if (dlErr || !blob) {
    console.warn(`screen-task-media: download failed for ${mediaId} — ${dlErr?.message ?? 'no body'}`);
    return json({ state: await refuse(db, mediaId, path) });
  }

  const mimeType = blob.type;
  if (!SCREENABLE.includes(mimeType)) {
    console.warn(`screen-task-media: ${mediaId} is an unscreenable type (${mimeType || 'none'})`);
    return json({ state: await refuse(db, mediaId, path) });
  }

  const screened = await complete<{ harmful: boolean; reason: string }>({
    system: GOAL_IMAGE_SCREENING,
    user: 'This is the photo attached to the goal. Answer the question about it.',
    schema: SCREEN_SCHEMA,
    image: { mimeType, base64: toBase64(new Uint8Array(await blob.arrayBuffer())) },
  });

  const { verdict, reason } = imageVerdict(screened);

  if (verdict === 'ok') {
    const { error } = await db.rpc('mark_task_media_ready', { p_media: mediaId });
    if (error) {
      // The row is still `pending`, which is unreadable to everyone but its
      // owner — so this fails safe, and a later call screens it again.
      console.error(`screen-task-media: mark_task_media_ready failed — ${error.message}`);
      return json({ state: 'waiting' });
    }
    return json({ state: 'ready' });
  }

  // Same as the `mark_task_media_ready` failure above, and for the same reason:
  // the row is still `pending`, which is unreadable to everyone but its owner,
  // so saying `waiting` costs a retry and keeps the photo. Deleting here would
  // destroy a picture the model never actually looked at.
  if (verdict === 'unproven') {
    console.warn(`screen-task-media: screener unreachable for ${mediaId} — left pending to retry`);
    return json({ state: 'waiting' });
  }

  // The model's words stay in the log. The client shows `IMAGE_BLOCKED_COPY`,
  // which does not explain and does not argue — see `imageVerdict.mjs`.
  console.warn(
    `screen-task-media: blocked ${mediaId} — screening ${screened.status}${reason ? `: ${reason}` : ''}`,
  );
  return json({ state: await refuse(db, mediaId, path) });
});

/**
 * What "no row owned by you with that id" means, decided by the object.
 *
 * One `list` of one prefix: no bytes, and the prefix is
 * `<owner>/<task>` with the owner taken from the verified token, so a body
 * that lies about `taskId` can only point this at another of the caller's own
 * folders.
 *
 * Both failure directions are asymmetric and the asymmetry is chosen. Saying
 * `waiting` when the truth is `refused` costs a retry that answers `refused`
 * again. Saying `refused` when the truth is `waiting` deletes a photo off
 * somebody's phone that nothing was ever wrong with. So anything unclear —
 * including the list call itself failing — answers `waiting`.
 */
async function absentMeans(
  // deno-lint-ignore no-explicit-any
  db: any,
  userId: string,
  taskId: string,
  mediaId: string,
): Promise<'waiting' | 'refused'> {
  const { data, error } = await db.storage
    .from(BUCKET)
    .list(`${userId}/${taskId}`, { limit: 100, search: mediaId });

  if (error) {
    console.warn(`screen-task-media: list failed for ${userId}/${taskId} — ${error.message}`);
    return 'waiting';
  }
  return (data ?? []).length > 0 ? 'waiting' : 'refused';
}

/**
 * Block a photo: remove the object, then the row.
 *
 * Best-effort on the object and loud about failing, exactly as `screen-image`
 * is — with the difference that a surviving object here is readable only to
 * its owner, because this bucket's select policy asks `can_see_media` rather
 * than waving through every signed-in account.
 */
async function refuse(
  // deno-lint-ignore no-explicit-any
  db: any,
  mediaId: string,
  path: string,
): Promise<'refused'> {
  const { error } = await db.storage.from(BUCKET).remove([path]);
  if (error) {
    console.error(`screen-task-media: REFUSED IMAGE NOT DELETED ${path} — ${error.message}`);
  }
  await dropRow(db, mediaId);
  return 'refused';
}

/**
 * The row, through the service role rather than an RPC.
 *
 * `mark_task_media_ready` exists because publishing is the thing clients must
 * never reach. Deleting is not: the owner already has a DELETE policy on their
 * own rows, so a function to do it would be ceremony around a permission that
 * is already granted.
 */
async function dropRow(
  // deno-lint-ignore no-explicit-any
  db: any,
  mediaId: string,
): Promise<void> {
  const { error } = await db.from('task_media').delete().eq('id', mediaId);
  if (error) {
    // Leaves a `pending` row nobody but the owner can read, over an object
    // that is already gone. The next call downloads nothing and refuses again.
    console.error(`screen-task-media: row ${mediaId} not deleted — ${error.message}`);
  }
}

/** Shared with `rate-goal` and `screen-image`: one counter, one quota. */
async function overCap(
  // deno-lint-ignore no-explicit-any
  db: any,
  userId: string,
): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const { data, error } = await db.rpc('bump_llm_usage', { u: userId, d: day });
  if (error) {
    // A broken counter is not a reason to refuse somebody's photo — the same
    // call `rate-goal` and `screen-image` both make, for the same reason.
    console.warn(`screen-task-media: usage counter failed — ${error.message}`);
    return false;
  }
  return (data ?? 0) > DAILY_CAP;
}

/** Chunked, because a spread of two million arguments is a stack overflow. */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
