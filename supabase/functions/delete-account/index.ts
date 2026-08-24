/**
 * Finish deleting the accounts whose fortnight is up.
 *
 *   POST {} -> { purged: number, failed: number, due: number }
 *
 * `20260824090000_account_deletion.sql` marks an account and takes it out of
 * everybody's view. This is the part that cannot be written in SQL, and there
 * are exactly two reasons it cannot:
 *
 *   1. **Storage.** Deleting a row from `storage.objects` orphans the file and
 *      goes on billing for it — Supabase's own docs say so, and
 *      `protect_objects_delete` refuses the delete outright. Objects come out
 *      through the storage API or they do not come out.
 *   2. **`auth.users`.** The whole cascade hangs off that row, and the only
 *      supported way to remove it is the admin API.
 *
 * Almost nothing here does the deleting. `auth.admin.deleteUser` fires a
 * cascade the schema has spent twenty migrations describing, and the trigger
 * added beside this one takes the notifications that cascade could never
 * reach. What is left for this function is the avatar, and the order.
 *
 * ─── no JWT, one secret ───────────────────────────────────────────────────
 *
 * Called by `cron`, which is not a user and carries no session. The
 * `x-webhook-secret` header is the entire authorisation story, exactly as it
 * is for `push` and `collect-media`. Refusing every request when the secret is
 * unset is deliberate: an unset secret is a misconfiguration, and the safe
 * reading of "I cannot tell who is asking" is not "delete some accounts".
 *
 * **It takes no account id, and it must not grow one.** The list comes from
 * `accounts_due_for_purge()`, which takes no arguments either, so the worst a
 * leaked secret can do is bring forward by hours a deletion that fourteen days
 * of grace already made certain. An id in the body would turn the same leak
 * into "delete anybody" — the same reasoning `screen-image` gives for having no
 * profile parameter.
 *
 * ─── the order, and why a failure stops rather than continues ─────────────
 *
 * Avatar first, account second, and nothing else. If the avatar cannot be
 * removed, the account is left alone entirely and tried again tomorrow — so an
 * account is either wholly gone or wholly still there, never half. The
 * alternative, deleting the account and hoping the file follows, loses the
 * only handle on that file: the path is `<uid>/…`, and once the profile row is
 * gone nothing lists it and no later run knows to look. The `avatars` bucket
 * has no collector — `orphaned_media` is hardcoded to `task-media` — so an
 * orphan there is an orphan for good.
 *
 * `task-media` needs nothing from this function. The cascade deletes the rows,
 * `enqueue_media_gc` writes each path, and `nudge_media_gc` wakes
 * `collect-media`, which already knows how to empty a bucket.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

/** The one bucket nothing else collects. See the header. */
const BUCKET = 'avatars';

/**
 * One run, one batch. The schedule is daily and the population is people who
 * asked to leave a fortnight ago, so this is a ceiling nothing is expected to
 * reach — it is here so that a bad day cannot turn into a request that never
 * returns.
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

/** Length-first, then constant-time. Copied from `collect-media` on purpose. */
function secretMatches(given: string | null, expected: string): boolean {
  if (!given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const expected = Deno.env.get('DELETE_ACCOUNT_WEBHOOK_SECRET');
  if (!expected) {
    console.error('DELETE_ACCOUNT_WEBHOOK_SECRET is not set; refusing every request.');
    return json({ error: 'unconfigured' }, 500);
  }
  if (!secretMatches(req.headers.get('x-webhook-secret'), expected)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const { data: rows, error: dueError } = await db.rpc('accounts_due_for_purge');
  if (dueError) {
    console.error('accounts_due_for_purge failed:', dueError.message);
    return json({ error: 'due-unreadable' }, 500);
  }

  const due = ((rows ?? []) as { id: string }[]).map((r) => r.id);
  const batch = due.slice(0, BATCH);

  /**
   * Empty this account's folder in `avatars`.
   *
   * Listed rather than derived. The path is `<uid>/<avatar_id>.jpg` and the id
   * is in `profiles.avatar_path`, but a replaced avatar is a delete plus an
   * insert and a failed delete leaves the old object behind — so the column
   * names the current one, not everything that is there. Listing is the only
   * answer that empties the folder rather than the row.
   *
   * Nothing to remove is success. Most accounts never set a photo.
   */
  const emptyAvatarFolder = async (uid: string): Promise<string | null> => {
    const { data: files, error: listError } = await db.storage.from(BUCKET).list(uid);
    if (listError) return listError.message;

    const paths = (files ?? []).map((f) => `${uid}/${f.name}`);
    if (!paths.length) return null;

    const { error } = await db.storage.from(BUCKET).remove(paths);
    return error ? error.message : null;
  };

  let purged = 0;
  let failed = 0;

  for (const uid of batch) {
    const trouble = await emptyAvatarFolder(uid);
    if (trouble) {
      // Left whole, and tried again tomorrow. `deleted_at` is still set, so the
      // account stays invisible in the meantime and nothing about the delay is
      // visible to anybody but this log line.
      failed += 1;
      console.error('avatar removal failed; leaving the account for the next run:', trouble);
      continue;
    }

    const { error } = await db.auth.admin.deleteUser(uid);
    if (error) {
      failed += 1;
      console.error('deleteUser failed:', error.message);
      continue;
    }
    purged += 1;
  }

  // No uuid in this line, and none in any line above it. The account is gone;
  // a log that named it would be the last copy of the thing being deleted.
  console.log(`delete-account: purged ${purged}, failed ${failed}, due ${due.length}`);
  return json({ purged, failed, due: due.length });
});
