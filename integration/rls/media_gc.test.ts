/**
 * What happens to the file when the row goes.
 *
 * `task_media.task_id` cascades from `tasks`, which is right for the row and
 * impossible for the object: Postgres cannot reach into a bucket. Deleting a
 * goal therefore used to leave its photo behind for good — unreadable, because
 * `can_see_media` refuses an object no `ready` row claims, and uncollectable,
 * because nothing ever looked at it again.
 *
 * The client sends `media.detach` on that path now, and that is the fast half.
 * This file is the other half, the one that does not need a client to be
 * present or correct: a trigger that records the path the moment the row goes,
 * and a query that finds objects no row ever claimed.
 *
 * Asserted against the queue rather than against the bucket ending up empty,
 * deliberately. The delete itself is an HTTP call made by `collect-media`, and
 * the nudge that starts it is Vault-gated so a local stack never calls out —
 * which is what keeps this suite off the network. The durable claim, and the
 * one that was actually missing, is that the path gets written down at all.
 */
import { asAnon, asService, asUser, idOf } from '../support/clients';
import { asRole, sql, sqlInTx } from '../support/reset';
import { CIRCLE_IDS } from '../fixtures/world';

const WEEK = '2026-08-10';
const BUCKET = 'task-media';

const uuid = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pathFor = (owner: string, task: string, media: string) => `${owner}/${task}/${media}.jpg`;

/** Four bytes that are a valid enough JPEG for the bucket to accept them. */
const pixel = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

let taskId: string;
/** Everything uploaded by a test, so it can go back out through the API. */
let uploaded: string[] = [];

const queued = async (): Promise<string[]> => {
  const rows = await sql<{ path: string }>('select path from public.media_gc order by path');
  return rows.map((r) => r.path);
};

/**
 * Put an object in the bucket and backdate it.
 *
 * Uploaded through the API rather than inserted into `storage.objects`,
 * because storage guards its own tables — `protect_objects_delete` refuses a
 * SQL delete outright, so a row put there by hand could not be cleaned up.
 * The `created_at` is then moved by hand, which storage does allow, because
 * the age bound is the thing under test and waiting an hour for it is not a
 * test.
 */
const putObject = async (name: string, age: string): Promise<string> => {
  const { error } = await asService()
    .storage.from(BUCKET)
    .upload(name, pixel(), { contentType: 'image/jpeg', upsert: true });
  expect(error).toBeNull();
  uploaded.push(name);
  await sql(
    `update storage.objects set created_at = now() - $2::interval
     where bucket_id = '${BUCKET}' and name = $1`,
    [name, age],
  );
  return name;
};

beforeEach(async () => {
  await sql('delete from public.media_gc');
  uploaded = [];

  const { data, error } = await asUser('maya')
    .from('tasks')
    .insert({
      owner_id: idOf('maya'),
      week_start: WEEK,
      category: 'move',
      points: 3,
      day: 0,
      title: 'M_friends',
      aud: 'friends',
      circle_id: CIRCLE_IDS.basement,
    })
    .select('id')
    .single();
  expect(error).toBeNull();
  taskId = (data as { id: string }).id;
});

afterEach(async () => {
  if (uploaded.length) await asService().storage.from(BUCKET).remove(uploaded);
});

/** A photo on the goal above, straight in as its owner. */
const attach = async (id = uuid(1)) => {
  const path = pathFor(idOf('maya'), taskId, id);
  const { error } = await asUser('maya')
    .from('task_media')
    .insert({ id, task_id: taskId, owner_id: idOf('maya'), path, width: 10, height: 10 });
  expect(error).toBeNull();
  return path;
};

describe('the path is written down when the row goes', () => {
  it('records a photo orphaned by deleting the goal underneath it', async () => {
    // The bug, exactly: nothing here touches `task_media`. The goal goes, the
    // cascade takes the row, and before this trigger the object's name went
    // with it — the last thing that knew which file to delete.
    const path = await attach();
    expect(await queued()).toEqual([]);

    const { error } = await asUser('maya').from('tasks').delete().eq('id', taskId);
    expect(error).toBeNull();

    expect(await queued()).toEqual([path]);
  });

  it('records one taken back directly, which is what media.detach does', async () => {
    // The client deletes the object itself on this path, so the entry is a
    // receipt rather than the only hope. Asserted because the trigger must not
    // be selective: "the row went" is the whole condition.
    const path = await attach();

    const { error } = await asUser('maya').from('task_media').delete().eq('task_id', taskId);
    expect(error).toBeNull();

    expect(await queued()).toEqual([path]);
  });

  it('survives the same path arriving twice', async () => {
    const path = await attach();
    await asUser('maya').from('task_media').delete().eq('task_id', taskId);
    await sql('insert into public.media_gc (path) values ($1) on conflict do nothing', [path]);

    expect(await queued()).toEqual([path]);
  });

  it('rolls the entry back with the delete that caused it', async () => {
    // `after delete`, not `before`, and this is the difference. A delete that
    // does not commit is not a photo anybody took back, and an entry that
    // outlived it would delete a file still hanging off a live goal.
    const path = await attach();
    await sqlInTx([`delete from public.task_media where task_id = '${taskId}'`]);

    expect(await queued()).toEqual([]);
    const still = await sql<{ path: string }>('select path from public.task_media');
    expect(still.map((r) => r.path)).toEqual([path]);
  });
});

describe('the queue is nobody’s business', () => {
  it('is not readable by a signed-in account', async () => {
    await attach();
    await asUser('maya').from('tasks').delete().eq('id', taskId);

    const { data } = await asUser('maya').from('media_gc').select('path');
    expect(data ?? []).toEqual([]);
  });

  it('is not readable anonymously', async () => {
    const { data } = await asAnon().from('media_gc').select('path');
    expect(data ?? []).toEqual([]);
  });

  it('cannot be written by a client, which would be a delete of anyone’s file', async () => {
    // The path is a client-controlled string. If a client could insert one it
    // could name somebody else's photo and have the collector delete it.
    const { error } = await asUser('maya')
      .from('media_gc')
      .insert({ path: pathFor(idOf('dre'), taskId, uuid(2)) });
    expect(error).not.toBeNull();
  });
});

describe('objects no row ever claimed', () => {
  const orphans = async (minAge = '1 hour'): Promise<string[]> => {
    const rows = await sql<{ path: string }>('select path from public.orphaned_media($1)', [
      minAge,
    ]);
    return rows.map((r) => r.path);
  };

  it('finds one old enough that its row would have arrived by now', async () => {
    // The orphan already sitting in production is exactly this shape: a file
    // whose goal was deleted long before the trigger existed, so nothing
    // recorded it and nothing since has had a reason to look.
    const stale = await putObject(pathFor(idOf('maya'), taskId, uuid(3)), '2 hours');

    expect(await orphans()).toEqual([stale]);
  });

  it('leaves a young one alone, because that is an upload in progress', async () => {
    // The failure this bound exists to prevent, and the reason the sweep is
    // not simply "delete what no row names": `src/sync/media.ts` writes the row
    // only once the bytes have landed, so between those two moments a live
    // photo is indistinguishable from garbage. Deleting it would make a photo
    // vanish while its owner watched.
    await putObject(pathFor(idOf('maya'), taskId, uuid(4)), '1 minute');

    expect(await orphans()).toEqual([]);
  });

  it('leaves an old one alone while a row still names it', async () => {
    const path = await attach(uuid(5));
    await putObject(path, '2 hours');

    expect(await orphans()).toEqual([]);
  });

  it('is not callable by any role a client can act as', async () => {
    // It reads `storage.objects`, which is why it is `security definer` and
    // why the grant is `service_role` alone. A client that could call it would
    // learn the object names of every account.
    //
    // Asserted at the grant, over `pg`, rather than through a REST call. This
    // function has to live in `public` so PostgREST can expose it to the
    // collector, which means "it is not reachable" is no longer something its
    // schema says for it — the EXECUTE grant is the whole defence, so the
    // EXECUTE grant is what gets asked.
    for (const role of ['anon', 'authenticated']) {
      const { error } = await asRole(role, "select public.orphaned_media('1 hour')");
      expect(error).toBe('42501');
    }
  });

  it('is callable by the collector', async () => {
    // The other half. A revoke that went one step too far would leave this
    // suite green and collection dead.
    const stale = await putObject(pathFor(idOf('maya'), taskId, uuid(6)), '2 hours');
    const { data, error } = await asService().rpc('orphaned_media', { p_min_age: '1 hour' });
    expect(error).toBeNull();
    expect(((data ?? []) as { path: string }[]).map((r) => r.path)).toEqual([stale]);
  });
});

describe('the collector’s own access', () => {
  it('lets service_role read and drain the queue', async () => {
    // The one role that must reach it. Asserted so a future revoke that
    // tightens this table does not silently disable collection.
    const path = await attach();
    await asUser('maya').from('tasks').delete().eq('id', taskId);

    const { data, error } = await asService().from('media_gc').select('path');
    expect(error).toBeNull();
    expect((data ?? []).map((r: { path: string }) => r.path)).toEqual([path]);

    const del = await asService().from('media_gc').delete().eq('path', path);
    expect(del.error).toBeNull();
    expect(await queued()).toEqual([]);
  });
});
