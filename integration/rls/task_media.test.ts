/**
 * task_media: a photo is exactly as visible as the goal it hangs off.
 *
 * The feature's whole security claim is that it adds no rule of its own — the
 * row policy and the storage policy both call `private.can_see_task`, so the
 * audience model stays stated once, in init.sql. That claim can only be
 * tested where the policies are real, which is here.
 *
 * The negatives are the point. A photo on a `private` task reaching the
 * circle, or a photo outliving a change of audience, is the failure this
 * design exists to make impossible — and it is the exact failure a
 * hand-copied audience rule in a storage policy would eventually produce.
 */
import { asAnon, asUser, idOf } from '../support/clients';
import { sql } from '../support/reset';
import { CIRCLE_IDS, type SeedHandle } from '../fixtures/world';

/** 2026-08-10 is a Monday, which is what `week_start` means. */
const WEEK = '2026-08-10';

type Aud = 'friends' | 'everyone' | 'private';

let taskOf: Record<Aud, string>;

/** `<owner>/<task>/<media>.jpg` — the shape both policies read. */
const pathFor = (owner: string, task: string, media: string) => `${owner}/${task}/${media}.jpg`;

const uuid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;

beforeEach(async () => {
  const maya = asUser('maya');
  const base = { owner_id: idOf('maya'), week_start: WEEK, category: 'move', points: 3 };
  const { data, error } = await maya
    .from('tasks')
    .insert([
      { ...base, day: 0, title: 'M_friends', aud: 'friends', circle_id: CIRCLE_IDS.basement },
      { ...base, day: 1, title: 'M_everyone', aud: 'everyone' },
      { ...base, day: 2, title: 'M_private', aud: 'private' },
    ])
    .select('id,title');
  expect(error).toBeNull();
  const rows = (data ?? []) as { id: string; title: string }[];
  taskOf = {
    friends: rows.find((r) => r.title === 'M_friends')!.id,
    everyone: rows.find((r) => r.title === 'M_everyone')!.id,
    private: rows.find((r) => r.title === 'M_private')!.id,
  };
});

/**
 * Put a photo through the screener, without one.
 *
 * `mark_task_media_ready` is revoked from `authenticated` and granted only to
 * `service_role`, so there is no client that can do this — which is the point
 * of it. Going in over `pg` is the honest way to stand in for the edge
 * function: it exercises the same function the real screener calls, rather
 * than a test-only door in the schema.
 */
const markReady = (id: string) => sql('select public.mark_task_media_ready($1)', [id]);

/**
 * Attach a photo and, unless a test is about the gate, put it through.
 *
 * Every test here that predates screening is about the audience model, and
 * `state` is not what any of them is asking about. Leaving them all `pending`
 * would turn this file into thirty assertions that an unscreened photo is
 * invisible — true, worth one test, and not what these are for.
 */
const attach = async (
  aud: Aud,
  as: SeedHandle = 'maya',
  id = uuid(1),
  { screened = true }: { screened?: boolean } = {},
) => {
  const result = await asUser(as)
    .from('task_media')
    .insert({
      id,
      task_id: taskOf[aud],
      owner_id: idOf(as),
      path: pathFor(idOf(as), taskOf[aud], id),
      width: 1600,
      height: 1200,
    });
  if (screened && !result.error) await markReady(id);
  return result;
};

const BUCKET = 'task-media';
/** A one-pixel JPEG is enough: what is under test is the policy, not the codec. */
const pixel = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });

/**
 * Put both halves of a photo on the server: the object, and the screened row
 * the storage policy now insists on.
 *
 * Before screening, an object alone was readable by whoever could see its
 * task — `can_see_media` read the task out of the name and asked nothing
 * else. It now also asks whether a `ready` row claims that exact path, so a
 * test that uploads bytes and stops is testing a photo no reader can reach.
 * That is the correct answer, and it is one test rather than the premise of
 * every other one.
 */
const publishObject = async (aud: Aud, id: string, as: SeedHandle = 'maya') => {
  const name = pathFor(idOf(as), taskOf[aud], id);
  const up = await asUser(as)
    .storage.from(BUCKET)
    .upload(name, pixel(), { contentType: 'image/jpeg', upsert: true });
  expect(up.error).toBeNull();
  const row = await asUser(as).from('task_media').insert({
    id,
    task_id: taskOf[aud],
    owner_id: idOf(as),
    path: name,
    width: 1,
    height: 1,
  });
  expect(row.error).toBeNull();
  await markReady(id);
  return name;
};

const canSee = async (viewer: SeedHandle, aud: Aud): Promise<boolean> => {
  const { data, error } = await asUser(viewer)
    .from('task_media')
    .select('id')
    .eq('task_id', taskOf[aud]);
  expect(error).toBeNull();
  return (data ?? []).length === 1;
};

describe('the row', () => {
  it('lets the owner attach a photo to their own task', async () => {
    const { error } = await attach('friends');
    expect(error).toBeNull();
  });

  it('refuses a photo attached to someone else’s task', async () => {
    // dre naming maya's task, as himself. The `with check` requires the task
    // to be his — this is the payload-shape attack the policy exists for.
    const { error } = await asUser('dre').from('task_media').insert({
      id: uuid(2),
      task_id: taskOf.friends,
      owner_id: idOf('dre'),
      path: pathFor(idOf('dre'), taskOf.friends, uuid(2)),
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('refuses a photo that names someone else as its owner', async () => {
    const { error } = await asUser('maya').from('task_media').insert({
      id: uuid(3),
      task_id: taskOf.friends,
      owner_id: idOf('dre'),
      path: pathFor(idOf('dre'), taskOf.friends, uuid(3)),
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('holds one photo per task, so a replay collides instead of duplicating', async () => {
    expect((await attach('friends')).error).toBeNull();
    const second = await asUser('maya').from('task_media').insert({
      id: uuid(9),
      task_id: taskOf.friends,
      owner_id: idOf('maya'),
      path: pathFor(idOf('maya'), taskOf.friends, uuid(9)),
    });
    expect(second.error).not.toBeNull();
    expect(second.error!.code).toBe('23505');
  });

  it('goes when the task goes', async () => {
    expect((await attach('friends')).error).toBeNull();
    expect((await asUser('maya').from('tasks').delete().eq('id', taskOf.friends)).error).toBeNull();
    // Asked over the direct connection, not through PostgREST: a cascade is a
    // fact about the database, and reading it back through a policy-bearing
    // API would be asking two questions and reporting one answer.
    const left = await sql<{ n: string }>('select count(*) as n from public.task_media where task_id = $1', [
      taskOf.friends,
    ]);
    expect(left[0]!.n).toBe('0');
  });
});

describe('who can see it — the audience model, not a copy of it', () => {
  it('shows a friends photo to the circle', async () => {
    expect((await attach('friends')).error).toBeNull();
    expect(await canSee('dre', 'friends')).toBe(true);
  });

  it('hides a friends photo from someone outside the circle', async () => {
    expect((await attach('friends')).error).toBeNull();
    expect(await canSee('jordan', 'friends')).toBe(false);
  });

  it('hides a private photo from the circle', async () => {
    // The one that matters. A circle-mate can see maya's other tasks and
    // their photos; this one is hers alone.
    expect((await attach('private')).error).toBeNull();
    expect(await canSee('dre', 'private')).toBe(false);
  });

  it('shows a private photo to someone paired on the task', async () => {
    expect((await attach('private')).error).toBeNull();
    const paired = await asUser('maya')
      .from('task_pairs')
      .insert({ task_id: taskOf.private, profile_id: idOf('tomas') });
    expect(paired.error).toBeNull();
    expect(await canSee('tomas', 'private')).toBe(true);
  });

  it('shows an everyone photo to a stranger', async () => {
    expect((await attach('everyone')).error).toBeNull();
    expect(await canSee('jordan', 'everyone')).toBe(true);
  });

  it('follows the task when its audience changes, with no second write', async () => {
    // The claim the whole design rests on: nothing about the photo is
    // updated here, and yet what it is worth changes with the task.
    expect((await attach('friends')).error).toBeNull();
    expect(await canSee('dre', 'friends')).toBe(true);

    const narrowed = await asUser('maya')
      .from('tasks')
      .update({ aud: 'private' })
      .eq('id', taskOf.friends);
    expect(narrowed.error).toBeNull();

    expect(await canSee('dre', 'friends')).toBe(false);
    // …and the owner still has it.
    expect(await canSee('maya', 'friends')).toBe(true);
  });

  it('shows nothing to a signed-out reader', async () => {
    expect((await attach('everyone')).error).toBeNull();
    const { data } = await asAnon().from('task_media').select('id');
    expect(data ?? []).toEqual([]);
  });
});

/**
 * The screening gate.
 *
 * The claim is that a photo reaches nobody else until a model has looked at
 * it, and that no client can say it has. Both halves matter: a gate a client
 * can open is decoration.
 */
describe('until a model has looked at it', () => {
  it('hides a photo from the circle while it is pending', async () => {
    expect((await attach('friends', 'maya', uuid(30), { screened: false })).error).toBeNull();
    expect(await canSee('dre', 'friends')).toBe(false);
  });

  it('shows it to them once it is screened', async () => {
    expect((await attach('friends', 'maya', uuid(31), { screened: false })).error).toBeNull();
    expect(await canSee('dre', 'friends')).toBe(false);

    await markReady(uuid(31));

    expect(await canSee('dre', 'friends')).toBe(true);
  });

  it('leaves the owner their own photo while it waits', async () => {
    // The one place this deliberately differs from the avatar gate. The owner
    // chose the picture and saw it in the picker; refusing it back to them
    // protects nobody, and their own screen draws it off local disk anyway.
    expect((await attach('friends', 'maya', uuid(32), { screened: false })).error).toBeNull();
    expect(await canSee('maya', 'friends')).toBe(true);
  });

  it('refuses a client that tries to insert itself as ready', async () => {
    // `state` is outside the INSERT column grant, so this is refused before
    // any policy is consulted.
    const id = uuid(33);
    const { error } = await asUser('maya')
      .from('task_media')
      .insert({
        id,
        task_id: taskOf.friends,
        owner_id: idOf('maya'),
        path: pathFor(idOf('maya'), taskOf.friends, id),
        width: 1,
        height: 1,
        state: 'ready',
      });
    expect(error).not.toBeNull();
  });

  it('refuses a client that tries to promote its own photo afterwards', async () => {
    expect((await attach('friends', 'maya', uuid(34), { screened: false })).error).toBeNull();

    // No UPDATE grant on the table at all, so there is no second route.
    const { error } = await asUser('maya')
      .from('task_media')
      .update({ state: 'ready' })
      .eq('id', uuid(34));
    expect(error).not.toBeNull();
    expect(await canSee('dre', 'friends')).toBe(false);
  });

  it('refuses a client that calls the publishing function directly', async () => {
    expect((await attach('friends', 'maya', uuid(35), { screened: false })).error).toBeNull();

    const { error } = await asUser('maya').rpc('mark_task_media_ready', { p_media: uuid(35) });
    expect(error).not.toBeNull();
    expect(await canSee('dre', 'friends')).toBe(false);
  });

  it('will not republish a photo whose owner has taken it down', async () => {
    // The screener can arrive late. `mark_task_media_ready` moves rows that
    // are `pending` and no others, so a verdict for a deleted photo lands on
    // nothing rather than resurrecting it.
    expect((await attach('friends', 'maya', uuid(36), { screened: false })).error).toBeNull();
    expect((await asUser('maya').from('task_media').delete().eq('id', uuid(36))).error).toBeNull();

    await markReady(uuid(36));

    expect(await canSee('dre', 'friends')).toBe(false);
  });
});

describe('a block reaches the photo too', () => {
  /**
   * The gap this suite exists to keep closed. `reports_and_blocks` taught
   * every select policy about blocks by pairing a guard with `can_see_task`
   * at each call site; the media policies were written before that convention
   * and called the helper alone. Without the follow-up migration, blocking
   * someone would take away their week and leave them the photograph of it.
   */
  const block = async (who: SeedHandle, target: SeedHandle) => {
    const { error } = await asUser(who).rpc('block_person', { p_blocked: idOf(target) });
    expect(error).toBeNull();
  };

  afterEach(async () => {
    await sql('delete from public.blocks');
  });

  it('hides a circle-mate’s photo once they are blocked', async () => {
    expect((await attach('friends')).error).toBeNull();
    expect(await canSee('dre', 'friends')).toBe(true);

    await block('dre', 'maya');

    expect(await canSee('dre', 'friends')).toBe(false);
  });

  it('hides it in the other direction too — a block is not one-sided', async () => {
    expect((await attach('friends')).error).toBeNull();
    await block('maya', 'dre');
    expect(await canSee('dre', 'friends')).toBe(false);
  });

  it('leaves the owner their own photo', async () => {
    expect((await attach('friends')).error).toBeNull();
    await block('dre', 'maya');
    expect(await canSee('maya', 'friends')).toBe(true);
  });

  it('refuses to sign the file for a blocked reader', async () => {
    // Checked separately on purpose: a signed URL is minted against
    // storage.objects, not against task_media, so a guard on only the row
    // would leave the file readable to somebody who cannot read its row.
    const name = await publishObject('friends', uuid(20));
    expect((await asUser('dre').storage.from(BUCKET).createSignedUrl(name, 60)).error).toBeNull();

    await block('dre', 'maya');

    expect((await asUser('dre').storage.from(BUCKET).createSignedUrl(name, 60)).error).not.toBeNull();
  });
});

describe('the file itself', () => {
  it('lets the owner upload into their own folder', async () => {
    const name = pathFor(idOf('maya'), taskOf.friends, uuid(4));
    const { error } = await asUser('maya')
      .storage.from(BUCKET)
      .upload(name, pixel(), { contentType: 'image/jpeg', upsert: true });
    expect(error).toBeNull();
  });

  it('refuses an upload into someone else’s folder', async () => {
    // The first path segment is the owner, which is what makes this
    // checkable without reading any other table.
    const name = pathFor(idOf('maya'), taskOf.friends, uuid(5));
    const { error } = await asUser('dre')
      .storage.from(BUCKET)
      .upload(name, pixel(), { contentType: 'image/jpeg', upsert: true });
    expect(error).not.toBeNull();
  });

  it('lets a retry overwrite its own object rather than duplicating it', async () => {
    const name = pathFor(idOf('maya'), taskOf.friends, uuid(6));
    const first = await asUser('maya')
      .storage.from(BUCKET)
      .upload(name, pixel(), { contentType: 'image/jpeg', upsert: true });
    expect(first.error).toBeNull();
    const replay = await asUser('maya')
      .storage.from(BUCKET)
      .upload(name, pixel(), { contentType: 'image/jpeg', upsert: true });
    expect(replay.error).toBeNull();
  });

  it('signs a URL for a circle-mate on a friends task', async () => {
    const name = await publishObject('friends', uuid(7));

    const { data, error } = await asUser('dre').storage.from(BUCKET).createSignedUrl(name, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toContain(name);
  });

  it('refuses to sign a private task’s object for the circle', async () => {
    const name = await publishObject('private', uuid(8));

    // Signing requires select on the object, so the audience rule reaches the
    // file and not only the row that points at it.
    const { error } = await asUser('dre').storage.from(BUCKET).createSignedUrl(name, 60);
    expect(error).not.toBeNull();
  });

  it('answers false for a malformed name rather than raising inside a policy', async () => {
    // `can_see_media` casts the second path segment to uuid, and the cast is
    // guarded: a name with no such segment must answer *false* rather than
    // raise 22P02 — an exception inside a policy is an error on somebody
    // else's read, not a refusal of this one.
    const rows = await sql<{ ok: boolean }>(
      'select private.can_see_media($1) as ok',
      [`${idOf('maya')}/not-a-uuid/x.jpg`],
    );
    expect(rows[0]!.ok).toBe(false);
  });

  it('will not sign an object no screened row claims', async () => {
    // The upload half of the pipeline runs before the row exists, so bytes in
    // the bucket with nothing pointing at them is an ordinary intermediate
    // state — and it must not be a readable one for anybody else.
    const name = pathFor(idOf('maya'), taskOf.friends, uuid(9));
    expect(
      (await asUser('maya').storage.from(BUCKET).upload(name, pixel(), { upsert: true })).error,
    ).toBeNull();

    expect((await asUser('dre').storage.from(BUCKET).createSignedUrl(name, 60)).error).not.toBeNull();
    // The owner is the exception, which is what lets the upload itself succeed
    // — `upload` returns the created row, so the select policy runs on it.
    expect((await asUser('maya').storage.from(BUCKET).createSignedUrl(name, 60)).error).toBeNull();
  });

  it('will not take an upload whose name names no task', async () => {
    // A consequence of the above worth pinning: `upload` returns the created
    // row, so the *select* policy runs too — and a name that resolves to no
    // task cannot be seen, so it cannot be written either. A malformed object
    // never reaches the bucket rather than sitting there unreadable.
    const { error } = await asUser('maya')
      .storage.from(BUCKET)
      .upload(`${idOf('maya')}/not-a-uuid/x.jpg`, pixel(), { upsert: true });
    expect(error).not.toBeNull();
  });
});
