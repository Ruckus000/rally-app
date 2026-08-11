/**
 * tasks: the audience model.
 *
 * Four tasks owned by maya cover every branch of `tasks_select` — 'friends',
 * 'everyone', a 'private' one tomas is paired on, and a 'private' one nobody
 * is. Six viewers are then run against them, plus the signed-out case.
 *
 * Everything is seeded through `asUser('maya')`, not the service key, so the
 * write paths are exercised by the same tests that depend on them: if
 * `tasks_insert` or `task_pairs_insert` regress, this file fails at setup.
 */
import { asAnon, asService, asUser, idOf } from '../support/clients';
import { CIRCLE_IDS, type SeedHandle } from '../fixtures/world';

/** 2026-08-10 is a Monday, which is what `week_start` means. */
const WEEK = '2026-08-10';

type Label = 'T_friends' | 'T_everyone' | 'T_private_paired' | 'T_private_alone';

let ids: Record<Label, string>;
let labelOf: Map<string, Label>;

beforeEach(async () => {
  const maya = asUser('maya');
  const base = { owner_id: idOf('maya'), week_start: WEEK, category: 'move', points: 3 };

  const { data, error } = await maya
    .from('tasks')
    .insert([
      { ...base, day: 0, title: 'T_friends', aud: 'friends', circle_id: CIRCLE_IDS.basement },
      { ...base, day: 1, title: 'T_everyone', aud: 'everyone' },
      { ...base, day: 2, title: 'T_private_paired', aud: 'private' },
      { ...base, day: 3, title: 'T_private_alone', aud: 'private' },
    ])
    .select('id,title');

  expect(error).toBeNull();
  expect(data).toHaveLength(4);

  const rows = (data ?? []) as { id: string; title: Label }[];
  ids = Object.fromEntries(rows.map((r) => [r.title, r.id])) as Record<Label, string>;
  labelOf = new Map(rows.map((r) => [r.id, r.title]));

  // The owner pairs someone in — the only route to a private task for a
  // person who shares no circle at all.
  const paired = await maya
    .from('task_pairs')
    .insert({ task_id: ids.T_private_paired, profile_id: idOf('tomas') });
  expect(paired.error).toBeNull();
});

const canSee = async (viewer: SeedHandle, label: Label): Promise<boolean> => {
  const { data, error } = await asUser(viewer).from('tasks').select('id').eq('id', ids[label]);
  expect(error).toBeNull();
  return (data ?? []).length === 1;
};

const visibleTo = async (viewer: SeedHandle): Promise<Label[]> => {
  const { data, error } = await asUser(viewer).from('tasks').select('id');
  expect(error).toBeNull();
  return (data ?? [])
    .map((r: { id: string }) => labelOf.get(r.id) as Label)
    .sort();
};

describe('the owner', () => {
  it.each<Label>(['T_friends', 'T_everyone', 'T_private_paired', 'T_private_alone'])(
    'maya can see her own %s whatever its audience',
    async (label) => {
      expect(await canSee('maya', label)).toBe(true);
    },
  );
});

describe('someone who shares the circle the task is tagged to', () => {
  it.each<SeedHandle>(['dre', 'nana'])('%s sees the friends task', async (viewer) => {
    expect(await canSee(viewer, 'T_friends')).toBe(true);
  });

  it.each<SeedHandle>(['dre', 'nana'])('%s sees the everyone task', async (viewer) => {
    expect(await canSee(viewer, 'T_everyone')).toBe(true);
  });

  it.each<SeedHandle>(['dre', 'nana'])(
    '%s cannot see a private task they are not paired on',
    async (viewer) => {
      // Sharing a circle buys nothing at aud='private'; only pairing does.
      expect(await canSee(viewer, 'T_private_paired')).toBe(false);
      expect(await canSee(viewer, 'T_private_alone')).toBe(false);
    },
  );
});

describe('someone who shares a different circle', () => {
  it('a friends task is visible to someone who shares a different circle — the audience is not scoped to circle_id', async () => {
    // sofia is in gym; T_friends is tagged to basement, which she is not in.
    // `tasks_select` resolves 'friends' with private.shares_circle_with(owner_id)
    // and never reads tasks.circle_id, so any circle-mate of maya's qualifies.
    //
    // This is a consequence of how the policy is written, not a product
    // decision anyone has stated. If "friends" is later meant to mean "the
    // circle this task is tagged to", this is the test that fails first, and
    // the policy — not this file — is what should change.
    expect(await canSee('sofia', 'T_friends')).toBe(true);
  });

  it('sofia sees the everyone task', async () => {
    expect(await canSee('sofia', 'T_everyone')).toBe(true);
  });

  it('sofia sees neither private task', async () => {
    expect(await canSee('sofia', 'T_private_paired')).toBe(false);
    expect(await canSee('sofia', 'T_private_alone')).toBe(false);
  });
});

describe('someone who shares nothing', () => {
  it('jordan cannot see the friends task', async () => {
    expect(await canSee('jordan', 'T_friends')).toBe(false);
  });

  it('jordan can still see the everyone task', async () => {
    // 'everyone' really is everyone signed in — not "everyone in your circles".
    expect(await canSee('jordan', 'T_everyone')).toBe(true);
  });

  it('jordan sees neither private task', async () => {
    expect(await canSee('jordan', 'T_private_paired')).toBe(false);
    expect(await canSee('jordan', 'T_private_alone')).toBe(false);
  });
});

describe('a pair', () => {
  it('tomas sees the private task he is paired on, despite sharing no circle with maya', async () => {
    expect(await canSee('tomas', 'T_private_paired')).toBe(true);
  });

  it('tomas does not see the other private task', async () => {
    // Pairing is per task, not a standing relationship with the owner.
    expect(await canSee('tomas', 'T_private_alone')).toBe(false);
  });

  it('being paired on one task does not make tomas a friend', async () => {
    expect(await canSee('tomas', 'T_friends')).toBe(false);
  });
});

describe('the visible set as a whole', () => {
  // A per-row lookup can only prove a row is reachable; it cannot catch a
  // policy that also hands back rows nobody asked about. One unfiltered select
  // per viewer does.
  it.each<[SeedHandle, Label[]]>([
    ['maya', ['T_everyone', 'T_friends', 'T_private_alone', 'T_private_paired']],
    ['dre', ['T_everyone', 'T_friends']],
    ['nana', ['T_everyone', 'T_friends']],
    ['sofia', ['T_everyone', 'T_friends']],
    ['jordan', ['T_everyone']],
    ['tomas', ['T_everyone', 'T_private_paired']],
  ])('%s sees exactly %p and nothing else', async (viewer, expected) => {
    expect(await visibleTo(viewer)).toEqual(expected);
  });

  it('a signed-out client cannot reach tasks at all', async () => {
    const { error } = await asAnon().from('tasks').select('id');
    // `anon` holds no grant on the table, so this is refused before RLS is
    // consulted — 42501, not an empty list.
    expect(error?.code).toBe('42501');
  });
});

describe('changing an audience changes who sees the task', () => {
  it('flipping the friends task to private takes it away from dre', async () => {
    expect(await canSee('dre', 'T_friends')).toBe(true);

    const { error } = await asUser('maya')
      .from('tasks')
      .update({ aud: 'private' })
      .eq('id', ids.T_friends);
    expect(error).toBeNull();

    expect(await canSee('dre', 'T_friends')).toBe(false);
    expect(await canSee('maya', 'T_friends')).toBe(true);
  });
});

describe('tasks writes', () => {
  it('cannot insert a task owned by someone else', async () => {
    const { error } = await asUser('dre').from('tasks').insert({
      owner_id: idOf('maya'),
      week_start: WEEK,
      day: 4,
      title: 'planted by dre',
      category: 'move',
      points: 1,
    });

    // An INSERT refused by RLS *is* 42501 — unlike UPDATE and DELETE.
    expect(error?.code).toBe('42501');
  });

  it('cannot update another persons task', async () => {
    const { data, error } = await asUser('dre')
      .from('tasks')
      .update({ title: 'retitled by dre' })
      .eq('id', ids.T_friends)
      .select();

    // Refused by USING, which PostgREST reports as "matched no rows".
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('leaves the row genuinely unchanged after a refused update', async () => {
    await asUser('dre')
      .from('tasks')
      .update({ title: 'retitled by dre', points: 999 })
      .eq('id', ids.T_friends);

    const { data } = await asService()
      .from('tasks')
      .select('title,points')
      .eq('id', ids.T_friends)
      .single();
    expect(data?.title).toBe('T_friends');
    expect(data?.points).toBe(3);
  });

  it('cannot hand its own task to someone else', async () => {
    const { error } = await asUser('maya')
      .from('tasks')
      .update({ owner_id: idOf('dre') })
      .eq('id', ids.T_everyone);

    // USING passes (maya owns the row) but WITH CHECK rejects the new one, and
    // a WITH CHECK failure is raised rather than silently skipped.
    expect(error?.code).toBe('42501');

    const { data } = await asService()
      .from('tasks')
      .select('owner_id')
      .eq('id', ids.T_everyone)
      .single();
    expect(data?.owner_id).toBe(idOf('maya'));
  });

  it('cannot delete another persons task', async () => {
    const { data, error } = await asUser('dre')
      .from('tasks')
      .delete()
      .eq('id', ids.T_friends)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: still } = await asService().from('tasks').select('id').eq('id', ids.T_friends);
    expect(still).toHaveLength(1);
  });

  it('can delete its own task', async () => {
    const { error } = await asUser('maya').from('tasks').delete().eq('id', ids.T_private_alone);
    expect(error).toBeNull();

    const { data } = await asService().from('tasks').select('id').eq('id', ids.T_private_alone);
    expect(data).toEqual([]);
  });
});

describe('the updated_at clamp', () => {
  const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
  const readUpdatedAt = async (id: string) => {
    const { data } = await asService().from('tasks').select('updated_at').eq('id', id).single();
    return Date.parse((data as { updated_at: string }).updated_at);
  };

  it('clamps an updated_at far in the future to about now', async () => {
    const { data, error } = await asUser('maya')
      .from('tasks')
      .insert({
        owner_id: idOf('maya'),
        week_start: WEEK,
        day: 5,
        title: 'from a device with a broken clock',
        category: 'move',
        points: 1,
        updated_at: minutesFromNow(60 * 24 * 365),
      })
      .select('id')
      .single();
    expect(error).toBeNull();

    const stored = await readUpdatedAt((data as { id: string }).id);
    // The trigger caps at now() + 5 minutes; allow a little slack for the
    // round trip in both directions.
    expect(stored).toBeLessThanOrEqual(Date.now() + 6 * 60_000);
    expect(stored).toBeGreaterThan(Date.now() - 60_000);
  });

  it('preserves a client-supplied updated_at that is not in the future', async () => {
    // The point of the column: a stake queued offline keeps the moment the
    // user tapped, not the moment it happened to reach the server.
    const tapped = minutesFromNow(-90);

    const { error } = await asUser('maya')
      .from('tasks')
      .update({ title: 'edited offline', updated_at: tapped })
      .eq('id', ids.T_everyone);
    expect(error).toBeNull();

    expect(await readUpdatedAt(ids.T_everyone)).toBe(Date.parse(tapped));
  });
});
