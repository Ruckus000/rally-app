/**
 * reactions: a cheer is visible with whatever it hangs off, and is only ever
 * yours to place or withdraw.
 *
 * The `unique (actor_id, target_type, target_id, kind)` constraint is the
 * toggle itself — the client's cheer/un-cheer is an insert and a delete
 * against that one index, so most of this file is about what it guarantees.
 */
import { asAnon, asService, asUser, idOf } from '../support/clients';
import { CIRCLE_IDS, SEED_USERS, type SeedHandle } from '../fixtures/world';

const MONDAY = '2026-08-10';
const KINDS = ['cheer', 'in', 'cosign', 'nod', 'share'] as const;

type Aud = 'friends' | 'everyone' | 'private';

/** A task owned by someone, created out of band so the test is about reactions. */
async function makeTask(
  owner: SeedHandle,
  aud: Aud,
  circle: keyof typeof CIRCLE_IDS | null = 'basement',
): Promise<string> {
  const { data, error } = await asService()
    .from('tasks')
    .insert({
      owner_id: idOf(owner),
      circle_id: circle ? CIRCLE_IDS[circle] : null,
      week_start: MONDAY,
      day: 0,
      title: 'stake something',
      category: 'move',
      points: 3,
      aud,
      source: 'staked',
    })
    .select('id')
    .single();

  if (error) throw new Error(`could not seed a task: ${error.message}`);
  return (data as { id: string }).id;
}

const react = (
  actor: SeedHandle,
  targetId: string,
  kind: (typeof KINDS)[number] | string = 'cheer',
  targetType: 'task' | 'post' = 'task',
) =>
  asUser(actor)
    .from('reactions')
    .insert({ actor_id: idOf(actor), target_type: targetType, target_id: targetId, kind })
    .select();

const reactionsSeenBy = async (viewer: SeedHandle, targetId: string) => {
  const { data, error } = await asUser(viewer)
    .from('reactions')
    .select('id,actor_id,kind')
    .eq('target_id', targetId);
  expect(error).toBeNull();
  return data ?? [];
};

describe('a reaction is as visible as the thing it hangs off', () => {
  it('a cheer on a friends task is readable by everyone else in that circle', async () => {
    const task = await makeTask('maya', 'friends');
    const { error } = await react('dre', task);
    expect(error).toBeNull();

    const seen = await reactionsSeenBy('nana', task);
    expect(seen).toHaveLength(1);
    expect(seen[0].actor_id).toBe(idOf('dre'));
  });

  it('a cheer on maya private task is invisible to someone who shares nothing', async () => {
    const task = await makeTask('maya', 'private', null);
    await react('maya', task);

    expect(await reactionsSeenBy('jordan', task)).toEqual([]);
  });

  it('a cheer on a friends task is invisible to someone who shares no circle', async () => {
    // jordan shares nothing with maya, so he cannot see the task and therefore
    // cannot see reactions on it — reactions_select defers to can_see_task.
    const task = await makeTask('maya', 'friends');
    await react('dre', task);

    expect(await reactionsSeenBy('jordan', task)).toEqual([]);
  });

  it('a cheer on a friends task IS visible to someone who shares a different circle', async () => {
    // sofia shares gym with maya, not basement. She still sees it, because
    // `friends` resolves through shares_circle_with(owner_id) and never reads
    // tasks.circle_id. Asserted deliberately: if the product ever decides
    // `friends` should mean *that* circle, this is the test that fails.
    const task = await makeTask('maya', 'friends');
    await react('dre', task);

    expect(await reactionsSeenBy('sofia', task)).toHaveLength(1);
  });

  it('cannot be placed on a target the actor cannot see', async () => {
    // reactions_insert used to check actor_id alone, so anyone could cheer any
    // uuid they guessed — a write oracle for whether a row existed.
    const task = await makeTask('maya', 'private', null);

    const { error } = await react('tomas', task);

    expect(error?.code).toBe('42501');
  });

  it('stays readable to its actor after the target goes out of view', () =>
    // Seeded past the policy on purpose: this is the row you legitimately made
    // while the task was visible, and then the owner made it private. The
    // `actor_id = auth.uid()` branch of reactions_select still hands it back to
    // you, and to nobody else.
    (async () => {
      const task = await makeTask('maya', 'private', null);
      const { error } = await asService()
        .from('reactions')
        .insert({
          actor_id: idOf('tomas'),
          target_type: 'task',
          target_id: task,
          kind: 'cheer',
        });
      expect(error).toBeNull();

      expect(await reactionsSeenBy('tomas', task)).toHaveLength(1);
      expect(await reactionsSeenBy('jordan', task)).toEqual([]);
    })());

  it('a signed-out client cannot reach the table at all', async () => {
    const { error } = await asAnon().from('reactions').select('id');
    // `anon` holds no grant on reactions, so this is refused before RLS is
    // consulted — a 42501, not an empty result.
    expect(error?.code).toBe('42501');
  });
});

describe('the unique constraint is the cheer toggle', () => {
  it('rejects a second identical cheer with 23505', async () => {
    const task = await makeTask('maya', 'friends');
    expect((await react('dre', task)).error).toBeNull();

    const { error } = await react('dre', task);
    expect(error?.code).toBe('23505');
  });

  it('lets the same cheer be placed again once it has been withdrawn', async () => {
    // This exact sequence is the client's un-cheer: delete the row, and the
    // next tap inserts it back. If the delete were a no-op the re-cheer would
    // fail with 23505 and the button would appear stuck.
    const task = await makeTask('maya', 'friends');
    await react('dre', task);

    const { error: deleteError } = await asUser('dre')
      .from('reactions')
      .delete()
      .eq('actor_id', idOf('dre'))
      .eq('target_id', task);
    expect(deleteError).toBeNull();

    expect((await react('dre', task)).error).toBeNull();
    expect(await reactionsSeenBy('dre', task)).toHaveLength(1);
  });

  it('does not collide across kinds on the same target', async () => {
    const task = await makeTask('maya', 'friends');
    expect((await react('dre', task, 'cheer')).error).toBeNull();
    expect((await react('dre', task, 'nod')).error).toBeNull();

    expect(await reactionsSeenBy('dre', task)).toHaveLength(2);
  });

  it('does not collide across actors on the same target and kind', async () => {
    const task = await makeTask('maya', 'friends');
    expect((await react('dre', task)).error).toBeNull();
    expect((await react('nana', task)).error).toBeNull();

    expect(await reactionsSeenBy('maya', task)).toHaveLength(2);
  });
});

describe('reaction writes', () => {
  it('cannot be placed on behalf of somebody else', async () => {
    const task = await makeTask('maya', 'friends');
    const { error } = await asUser('dre')
      .from('reactions')
      .insert({ actor_id: idOf('nana'), target_type: 'task', target_id: task, kind: 'cheer' })
      .select();

    // An INSERT refused by RLS *is* a 42501, unlike an update or a delete.
    expect(error?.code).toBe('42501');
  });

  it('cannot withdraw somebody elses cheer', async () => {
    const task = await makeTask('maya', 'friends');
    await react('nana', task);

    const { data, error } = await asUser('dre')
      .from('reactions')
      .delete()
      .eq('target_id', task)
      .select();

    // A DELETE refused by RLS is a silent no-op in PostgREST: no error, no
    // rows. Only a service-role re-read proves the cheer survived.
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: still } = await asService().from('reactions').select('id').eq('target_id', task);
    expect(still).toHaveLength(1);
  });

  it('cannot be edited at all, not even your own', async () => {
    const task = await makeTask('maya', 'friends');
    await react('dre', task);

    const { error } = await asUser('dre')
      .from('reactions')
      .update({ kind: 'nod' })
      .eq('actor_id', idOf('dre'))
      .eq('target_id', task)
      .select();

    // Deliberate, not an oversight: a reaction has no editable field — you
    // withdraw it and place a different one. `authenticated` is granted only
    // select/insert/delete on the table, so UPDATE is refused by the grant
    // before RLS is reached, which is why this is a 42501 rather than the
    // usual silent no-op.
    expect(error?.code).toBe('42501');

    const { data: unchanged } = await asService()
      .from('reactions')
      .select('kind')
      .eq('target_id', task);
    expect(unchanged?.[0]?.kind).toBe('cheer');
  });
});

describe('every kind in the enum, and nothing outside it', () => {
  it.each(KINDS)('%s is a placeable reaction', async (kind) => {
    const task = await makeTask('maya', 'friends');
    const { data, error } = await react('dre', task, kind);

    expect(error).toBeNull();
    expect(data?.[0]?.kind).toBe(kind);
  });

  it('rejects a kind outside the enum', async () => {
    const task = await makeTask('maya', 'friends');
    const { error } = await react('dre', task, 'a');

    // 22P02, invalid input value for enum reaction_kind. DetailSheet currently
    // dispatches `kind: 'a'` for the acknowledge action, which this schema will
    // refuse outright — a real client bug, to be fixed separately.
    expect(error?.code).toBe('22P02');
  });
});

describe('post reactions are knowingly unguarded', () => {
  it('are readable by any authenticated user, whoever placed them', async () => {
    // reactions_select allows `target_type = 'post'` unconditionally: the
    // global feed has no backing table yet, so there is nothing to check
    // visibility against. Pinned here so that adding a posts table has to come
    // back and tighten this branch.
    const post = '44444444-4444-4444-8444-444444444444';
    expect((await react('maya', post, 'cheer', 'post')).error).toBeNull();

    for (const viewer of ['jordan', 'tomas', 'sofia'] as SeedHandle[]) {
      const { data, error } = await asUser(viewer)
        .from('reactions')
        .select('id')
        .eq('target_type', 'post')
        .eq('target_id', post);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }
  });

  it('does not leak task reactions through the post branch', async () => {
    const task = await makeTask('maya', 'private', null);
    await react('maya', task);

    const { data } = await asUser('jordan').from('reactions').select('id,target_type');
    expect(data).toEqual([]);
  });
});

/**
 * The notification a cheer leaves behind.
 *
 * Written by a trigger rather than the client, because `notifications` is
 * granted `select, update` only and has no INSERT policy — a table one account
 * can write into another's feed is a spam surface. These assert the row appears
 * for the right person, carries what the screen renders, and goes away again.
 */
describe('cheering someone notifies them', () => {
  let task: string;

  beforeEach(async () => {
    task = await makeTask('maya', 'friends');
  });

  const cheer = (from: SeedHandle) =>
    asUser(from)
      .from('reactions')
      .insert({ actor_id: idOf(from), target_type: 'task', target_id: task, kind: 'cheer' });

  const inbox = async (handle: SeedHandle) => {
    const { data } = await asUser(handle)
      .from('notifications')
      .select('kind,tier,payload,read_at')
      .order('created_at', { ascending: false });
    return data ?? [];
  };

  it('lands on the task owner, carrying what the row renders', async () => {
    await cheer('dre');

    const [note] = await inbox('maya');
    expect(note).toMatchObject({ kind: 'cheer', tier: 'circle', read_at: null });
    // The payload is self-contained on purpose: a cheer can come from an
    // `everyone` task, where the recipient may share no circle with the actor
    // and so cannot read their profile at all.
    expect(note.payload).toMatchObject({
      actor_id: idOf('dre'),
      actor_name: SEED_USERS.dre.name,
      task_id: task,
    });
  });

  it('does not notify you about your own cheer', async () => {
    await cheer('maya');

    expect(await inbox('maya')).toHaveLength(0);
  });

  it('goes away when the cheer is taken back', async () => {
    await cheer('dre');
    expect(await inbox('maya')).toHaveLength(1);

    await asUser('dre').from('reactions').delete().match({
      actor_id: idOf('dre'),
      target_type: 'task',
      target_id: task,
      kind: 'cheer',
    });

    // A notification that outlives the cheer is a claim the ledger no longer
    // supports.
    expect(await inbox('maya')).toHaveLength(0);
  });

  it('is nobody else\u2019s to read', async () => {
    await cheer('dre');

    // `notifications_select` is scoped to the recipient — not to the circle.
    expect(await inbox('dre')).toHaveLength(0);
    expect(await inbox('nana')).toHaveLength(0);
  });

  it('cannot be written by a client — the whole reason it is a trigger', async () => {
    const { error } = await asUser('dre').from('notifications').insert({
      recipient_id: idOf('maya'),
      tier: 'needs',
      kind: 'cheer',
      payload: {},
    });

    // 42501 specifically: refused by policy, not by a malformed payload that
    // would have been refused whatever the policies said.
    expect(error?.code).toBe('42501');
  });
});
