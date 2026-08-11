/**
 * task_pairs: who may pair whom, whose tick is whose, and the one place where
 * a pair row changes what someone can see.
 *
 * The init migration shipped task_pairs with SELECT and UPDATE policies and no
 * INSERT, so pairing — the feature the table exists for — was unwritable. The
 * repair migration added task_pairs_insert and task_pairs_delete; most of this
 * file is the regression test for that.
 */
import { asService, asUser, idOf } from '../support/clients';
import { CIRCLE_IDS, type SeedHandle } from '../fixtures/world';

/** 2026-08-10 is a Monday, which is what tasks.week_start must be. */
const WEEK = '2026-08-10';

type TaskOverrides = Partial<{
  circle_id: string | null;
  aud: 'friends' | 'everyone' | 'private';
  title: string;
}>;

/** Setup only — the task's own insert path is tasks.test.ts's subject, not ours. */
const makeTask = async (owner: SeedHandle, over: TaskOverrides = {}): Promise<string> => {
  const { data, error } = await asService()
    .from('tasks')
    .insert({
      owner_id: idOf(owner),
      circle_id: CIRCLE_IDS.basement,
      week_start: WEEK,
      day: 0,
      title: 'Deadlift',
      category: 'gym',
      points: 3,
      ...over,
    })
    .select('id')
    .single();

  if (error) throw new Error(`could not seed a task for "${owner}": ${error.message}`);
  return data.id as string;
};

const pairViaService = async (taskId: string, handle: SeedHandle): Promise<void> => {
  const { error } = await asService()
    .from('task_pairs')
    .insert({ task_id: taskId, profile_id: idOf(handle) });
  if (error) throw new Error(`could not seed a pair for "${handle}": ${error.message}`);
};

/** The truth about a pair row, read past RLS. Verification only. */
const pairOnRecord = async (taskId: string, handle: SeedHandle) => {
  const { data } = await asService()
    .from('task_pairs')
    .select('profile_id,done_at')
    .eq('task_id', taskId)
    .eq('profile_id', idOf(handle))
    .maybeSingle();
  return data as { profile_id: string; done_at: string | null } | null;
};

describe('creating a pair', () => {
  it('lets the task owner pair someone on their own task', async () => {
    const task = await makeTask('maya');

    const { data, error } = await asUser('maya')
      .from('task_pairs')
      .insert({ task_id: task, profile_id: idOf('dre') })
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('lets the owner pair someone who shares no circle with them', async () => {
    // task_pairs_insert asks only "do you own the task?" — pairing is how you
    // reach outside your circles on purpose.
    const task = await makeTask('maya');

    const { error } = await asUser('maya')
      .from('task_pairs')
      .insert({ task_id: task, profile_id: idOf('tomas') });

    expect(error).toBeNull();
  });

  it.each<[string, SeedHandle]>([
    ['a circle-mate who can see the task', 'dre'],
    ['a stranger who cannot', 'jordan'],
  ])('refuses a pair created by a non-owner — %s', async (_label, actor) => {
    const task = await makeTask('maya');

    const { error } = await asUser(actor)
      .from('task_pairs')
      .insert({ task_id: task, profile_id: idOf(actor) });

    // Unlike UPDATE and DELETE, an INSERT refused by RLS is a real 42501.
    expect(error?.code).toBe('42501');
  });

  it('leaves no row behind when a non-owner is refused', async () => {
    const task = await makeTask('maya');
    await asUser('dre').from('task_pairs').insert({ task_id: task, profile_id: idOf('dre') });

    expect(await pairOnRecord(task, 'dre')).toBeNull();
  });
});

describe('seeing a pair', () => {
  it('shows the pair row to the person who was paired', async () => {
    const task = await makeTask('maya', { aud: 'private', circle_id: null });
    await pairViaService(task, 'dre');

    const { data, error } = await asUser('dre').from('task_pairs').select('task_id');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('shows the pair rows to anyone who can already see the task', async () => {
    // nana is in basement and is not paired herself; the task is 'friends', so
    // can_see_task carries her to the pair rows on it.
    const task = await makeTask('maya', { aud: 'friends' });
    await pairViaService(task, 'dre');

    const { data, error } = await asUser('nana').from('task_pairs').select('profile_id');
    expect(error).toBeNull();
    expect(data?.map((r: { profile_id: string }) => r.profile_id)).toEqual([idOf('dre')]);
  });

  it('shows a stranger no pair rows on a private task', async () => {
    const task = await makeTask('maya', { aud: 'private', circle_id: null });
    await pairViaService(task, 'dre');

    const { data, error } = await asUser('jordan').from('task_pairs').select('profile_id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe('ticking a pair', () => {
  it('lets a paired user set their own done_at', async () => {
    const task = await makeTask('maya');
    await pairViaService(task, 'dre');

    const { data, error } = await asUser('dre')
      .from('task_pairs')
      .update({ done_at: new Date().toISOString() })
      .eq('task_id', task)
      .eq('profile_id', idOf('dre'))
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.done_at).not.toBeNull();
  });

  it('refuses a paired user ticking another participants row', async () => {
    const task = await makeTask('maya');
    await pairViaService(task, 'dre');
    await pairViaService(task, 'nana');

    const { data, error } = await asUser('dre')
      .from('task_pairs')
      .update({ done_at: new Date().toISOString() })
      .eq('task_id', task)
      .eq('profile_id', idOf('nana'))
      .select();

    // An UPDATE filtered out by a USING clause is a silent no-op, not a 42501.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('leaves the other participants row genuinely unticked', async () => {
    const task = await makeTask('maya');
    await pairViaService(task, 'dre');
    await pairViaService(task, 'nana');

    await asUser('dre')
      .from('task_pairs')
      .update({ done_at: new Date().toISOString() })
      .eq('task_id', task)
      .eq('profile_id', idOf('nana'));

    expect((await pairOnRecord(task, 'nana'))?.done_at).toBeNull();
  });

  it('refuses even the task owner ticking a partners row', async () => {
    // Owning the task buys you pairing and unpairing, never someone else's tick.
    const task = await makeTask('maya');
    await pairViaService(task, 'dre');

    const { data, error } = await asUser('maya')
      .from('task_pairs')
      .update({ done_at: new Date().toISOString() })
      .eq('task_id', task)
      .eq('profile_id', idOf('dre'))
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect((await pairOnRecord(task, 'dre'))?.done_at).toBeNull();
  });

  it('refuses a paired user reassigning their row to someone else', async () => {
    const task = await makeTask('maya');
    await pairViaService(task, 'dre');

    const { error } = await asUser('dre')
      .from('task_pairs')
      .update({ profile_id: idOf('sofia') })
      .eq('task_id', task)
      .eq('profile_id', idOf('dre'));

    // The USING clause admits the row, so this reaches WITH CHECK — and a
    // WITH CHECK violation *is* raised, unlike a USING mismatch.
    expect(error?.code).toBe('42501');
    expect(await pairOnRecord(task, 'sofia')).toBeNull();
    expect(await pairOnRecord(task, 'dre')).not.toBeNull();
  });
});

describe('removing a pair', () => {
  it('lets a participant remove themselves', async () => {
    const task = await makeTask('maya');
    await pairViaService(task, 'dre');

    const { data, error } = await asUser('dre')
      .from('task_pairs')
      .delete()
      .eq('task_id', task)
      .eq('profile_id', idOf('dre'))
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await pairOnRecord(task, 'dre')).toBeNull();
  });

  it('lets the task owner remove a pair they created', async () => {
    const task = await makeTask('maya');
    await pairViaService(task, 'dre');

    const { data, error } = await asUser('maya')
      .from('task_pairs')
      .delete()
      .eq('task_id', task)
      .eq('profile_id', idOf('dre'))
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(await pairOnRecord(task, 'dre')).toBeNull();
  });

  it('refuses an unrelated user, and the row survives', async () => {
    const task = await makeTask('maya');
    await pairViaService(task, 'dre');

    const { data, error } = await asUser('jordan')
      .from('task_pairs')
      .delete()
      .eq('task_id', task)
      .eq('profile_id', idOf('dre'))
      .select();

    // A DELETE refused by RLS is the same silent no-op an UPDATE is.
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await pairOnRecord(task, 'dre')).not.toBeNull();
  });

  it('refuses someone who can see the task but neither owns it nor is on it', async () => {
    // nana reads this pair row perfectly well. Reading is not unpairing.
    const task = await makeTask('maya', { aud: 'friends' });
    await pairViaService(task, 'dre');

    const { data } = await asUser('nana')
      .from('task_pairs')
      .delete()
      .eq('task_id', task)
      .eq('profile_id', idOf('dre'))
      .select();

    expect(data).toEqual([]);
    expect(await pairOnRecord(task, 'dre')).not.toBeNull();
  });
});

describe('a pair is what makes a private task visible', () => {
  const seeTask = async (actor: SeedHandle, task: string) => {
    const { data, error } = await asUser(actor).from('tasks').select('id').eq('id', task);
    expect(error).toBeNull();
    return (data ?? []).length === 1;
  };

  it('flips a strangers view of a private task as the pair is added and removed', async () => {
    // tomas shares no circle with maya, so tasks_select can only reach him
    // through the aud = 'private' and is_paired_on branch.
    const task = await makeTask('maya', { aud: 'private', circle_id: null, title: 'Therapy' });
    expect(await seeTask('tomas', task)).toBe(false);

    const { error: pairError } = await asUser('maya')
      .from('task_pairs')
      .insert({ task_id: task, profile_id: idOf('tomas') });
    expect(pairError).toBeNull();
    expect(await seeTask('tomas', task)).toBe(true);

    await asUser('maya')
      .from('task_pairs')
      .delete()
      .eq('task_id', task)
      .eq('profile_id', idOf('tomas'));
    expect(await seeTask('tomas', task)).toBe(false);
  });

  it('does not leak the task to the paired persons circle-mates', async () => {
    // jordan is in outsiders with tomas. The pair is tomas's, not his circle's.
    const task = await makeTask('maya', { aud: 'private', circle_id: null });
    await pairViaService(task, 'tomas');

    expect(await seeTask('jordan', task)).toBe(false);
  });

  it('stops showing the pair row itself once the pair is gone', async () => {
    const task = await makeTask('maya', { aud: 'private', circle_id: null });
    await pairViaService(task, 'tomas');
    await asUser('tomas')
      .from('task_pairs')
      .delete()
      .eq('task_id', task)
      .eq('profile_id', idOf('tomas'));

    const { data } = await asUser('tomas').from('task_pairs').select('task_id');
    expect(data).toEqual([]);
  });
});
