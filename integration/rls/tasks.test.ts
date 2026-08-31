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
import { sql } from '../support/reset';
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
  it('a friends task is scoped to the circle it was staked in', async () => {
    // sofia is in gym; T_friends is tagged to basement, which she is not in.
    // Sharing *a* circle with maya is no longer enough — the goal belongs to
    // one room, and this is not that room.
    //
    // This test used to assert the opposite, and said so: "if 'friends' is
    // later meant to mean 'the circle this task is tagged to', this is the test
    // that fails first, and the policy — not this file — is what should
    // change." The policy changed in
    // `20260831210000_a_goal_belongs_to_a_circle.sql`. This is the record of
    // when, and the file working exactly as it was written to.
    expect(await canSee('sofia', 'T_friends')).toBe(false);
  });

  it('and is visible to someone who shares *that* circle', async () => {
    // The other half, without which a policy that simply refused everyone
    // would pass the case above. dre is in basement, where T_friends lives.
    expect(await canSee('dre', 'T_friends')).toBe(true);
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

/**
 * The column the audience now reads.
 *
 * These stake their own rows rather than joining the shared four, because the
 * matrix above is a fixed set and every row added to it has to be accounted
 * for in six expectations. `sees` asks about one id directly, which is all
 * these cases need.
 */
describe('which circle a goal was staked in', () => {
  const stake = async (
    over: Record<string, unknown>,
  ): Promise<{ id: string; error: { code: string } | null }> => {
    const { data, error } = await asUser('maya')
      .from('tasks')
      .insert({
        owner_id: idOf('maya'),
        week_start: WEEK,
        category: 'move',
        points: 3,
        day: 4,
        title: 'T_scoped',
        aud: 'friends',
        ...over,
      })
      .select('id')
      .maybeSingle();
    return {
      id: (data as { id: string } | null)?.id ?? '',
      error: error as { code: string } | null,
    };
  };

  const sees = async (viewer: SeedHandle, id: string): Promise<boolean> => {
    const { data, error } = await asUser(viewer).from('tasks').select('id').eq('id', id);
    expect(error).toBeNull();
    return (data ?? []).length === 1;
  };

  it('reaches that circle and no other', async () => {
    // The half the inverted assertion above cannot prove on its own: a policy
    // that simply refused every non-owner would pass "sofia cannot see the
    // basement goal" and fail nobody. Staked in gym, so the answers swap.
    const { id, error } = await stake({ circle_id: CIRCLE_IDS.gym });
    expect(error).toBeNull();

    expect(await sees('sofia', id)).toBe(true);
    expect(await sees('dre', id)).toBe(false);
    expect(await sees('nana', id)).toBe(false);
  });

  it('is owner-only when it names no circle', async () => {
    // The most important assertion in this file. NULL is what a client that
    // forgets the column writes, so if NULL were permissive it would be a
    // bypass that never fails loudly — every un-updated write path would get
    // the old wide behaviour and nothing would say so.
    const { id, error } = await stake({ circle_id: null });
    expect(error).toBeNull();

    expect(await sees('maya', id)).toBe(true);
    expect(await sees('dre', id)).toBe(false);
    expect(await sees('sofia', id)).toBe(false);
  });

  it('ignores the circle entirely when the audience is everyone', async () => {
    // A goal can be staked in a room *and* published. The circle is still
    // recorded — that is what lets a per-circle board count it — but it stops
    // being what decides who may read.
    const { id, error } = await stake({
      aud: 'everyone',
      circle_id: CIRCLE_IDS.basement,
    });
    expect(error).toBeNull();

    expect(await sees('jordan', id)).toBe(true);
  });

  it('refuses a circle the owner is not in', async () => {
    // maya is in basement and gym, not outsiders. `tasks_insert` is data
    // hygiene rather than the boundary — a goal tagged to a room its owner is
    // not in is readable by nobody, because the predicate checks the owner too
    // — but a column that can hold a lie is a column the next reader trusts.
    const { error } = await stake({ circle_id: CIRCLE_IDS.outsiders });

    expect(error?.code).toBe('42501');
  });

  it('lets a goal move rooms, and the audience moves with it', async () => {
    const { id } = await stake({ circle_id: CIRCLE_IDS.basement });
    expect(await sees('dre', id)).toBe(true);
    expect(await sees('sofia', id)).toBe(false);

    const { error } = await asUser('maya')
      .from('tasks')
      .update({ circle_id: CIRCLE_IDS.gym })
      .eq('id', id);
    expect(error).toBeNull();

    expect(await sees('dre', id)).toBe(false);
    expect(await sees('sofia', id)).toBe(true);
  });

  it('lets an owner tag a goal into a room they are not in, and it reaches nobody', async () => {
    // `tasks_update` deliberately carries no circle clause: `WITH CHECK` sees
    // only NEW, so it could not tell a moved circle from a ticked box, and
    // adding one would make every goal in a circle you left un-tickable — a
    // permanent 42501 at the head of the outbox.
    //
    // This is what that costs, and why it costs nothing that matters: the
    // update succeeds, and the goal is then visible to its owner alone,
    // because `shares_circle_on` checks the owner's membership too. Delete
    // this test and somebody will "fix" the policy.
    const { id } = await stake({ circle_id: CIRCLE_IDS.basement });

    const { error } = await asUser('maya')
      .from('tasks')
      .update({ circle_id: CIRCLE_IDS.outsiders })
      .eq('id', id);
    expect(error).toBeNull();

    expect(await sees('maya', id)).toBe(true);
    expect(await sees('dre', id)).toBe(false);
    expect(await sees('jordan', id)).toBe(false);
    expect(await sees('tomas', id)).toBe(false);
  });
});

/**
 * The predicate is two-sided, and this is the half that says so.
 *
 * `is_circle_member(circle_id)` would have been the obvious spelling and would
 * have asked only about the viewer — so an owner who left a circle would keep
 * publishing into it forever. `shares_circle_on` asks about both, which is the
 * property `shares_circle_with` had and which this change had to keep.
 */
describe('when the owner leaves the circle', () => {
  /**
   * The seeded `joined_at`, put back exactly as it was.
   *
   * Re-inserting with a fresh `now()` is the obvious restore and it is wrong:
   * maya is in basement *and* gym, seeded in one statement so both timestamps
   * tie, and `pull_world` breaks that tie on circle id. A basement row rewritten
   * with a later timestamp makes gym her oldest membership — so the two
   * ordering tests in `pull_world.test.ts` start failing, in a different file,
   * for a reason nothing in either file mentions. Cost an hour once.
   */
  let seededJoinedAt: string | null = null;

  afterEach(async () => {
    if (seededJoinedAt === null) return;
    await sql(
      `insert into public.circle_members (circle_id, profile_id, joined_at)
         values ($1, $2, $3::timestamptz)
       on conflict (circle_id, profile_id) do nothing`,
      [CIRCLE_IDS.basement, idOf('maya'), seededJoinedAt],
    );
    seededJoinedAt = null;
  });

  it('her basement goal stops reaching basement', async () => {
    expect(await canSee('dre', 'T_friends')).toBe(true);

    const held = await sql<{ joined_at: string }>(
      'select joined_at from public.circle_members where circle_id = $1 and profile_id = $2',
      [CIRCLE_IDS.basement, idOf('maya')],
    );
    seededJoinedAt = held[0].joined_at;

    await sql('delete from public.circle_members where circle_id = $1 and profile_id = $2', [
      CIRCLE_IDS.basement,
      idOf('maya'),
    ]);

    expect(await canSee('dre', 'T_friends')).toBe(false);
    // And it has not merely become invisible to everyone: she still has it.
    expect(await canSee('maya', 'T_friends')).toBe(true);
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
    // sofia shares gym with maya, not basement — so the everyone goal and
    // nothing else. This row is the whole change, stated as a set.
    ['sofia', ['T_everyone']],
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

const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

const readUpdatedAt = async (id: string) => {
  const { data } = await asService().from('tasks').select('updated_at').eq('id', id).single();
  return Date.parse((data as { updated_at: string }).updated_at);
};

/**
 * A task of maya's with a chosen `updated_at`, seeded through her own client so
 * the insert path is exercised too. An INSERT has no stored row to lose to, so
 * this is the only way to plant a row whose clock is genuinely in the past.
 */
const stake = async (fields: Record<string, unknown>): Promise<string> => {
  const { data, error } = await asUser('maya')
    .from('tasks')
    .insert({
      owner_id: idOf('maya'),
      week_start: WEEK,
      day: 0,
      title: 'staked',
      category: 'move',
      points: 3,
      ...fields,
    })
    .select('id')
    .single();
  expect(error).toBeNull();
  return (data as { id: string }).id;
};

describe('the updated_at clamp', () => {

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
    //
    // Staged against a row stamped older still. `T_everyone` was inserted with
    // the default `now()`, and since the last-write-wins guard landed, a write
    // dated 90 minutes ago no longer beats it — see the tests below. What is
    // being pinned here is that a *winning* past stamp is stored verbatim
    // rather than being rewritten to arrival time.
    const id = await stake({ day: 5, title: 'staked offline', updated_at: minutesFromNow(-180) });
    const tapped = minutesFromNow(-90);

    const { error } = await asUser('maya')
      .from('tasks')
      .update({ title: 'edited offline', updated_at: tapped })
      .eq('id', id);
    expect(error).toBeNull();

    expect(await readUpdatedAt(id)).toBe(Date.parse(tapped));
  });

  it('bounds a backdated updated_at to 90 days ago', async () => {
    // Backdating is clamped for a different reason than post-dating. Once the
    // guard below exists, a 1970 stamp mostly loses — but the row still
    // *exists*, sorting before every plausible "changed since" cursor, so it
    // would be invisible to future pulls rather than merely stale.
    const id = await stake({ day: 6, title: 'from 1970', updated_at: '1970-01-01T00:00:00Z' });

    const stored = await readUpdatedAt(id);
    const floor = Date.now() - 90 * 24 * 60 * 60_000;
    expect(stored).toBeGreaterThan(floor - 60_000);
    expect(stored).toBeLessThan(floor + 60_000);
  });

  it('leaves a plausibly old offline stamp alone', async () => {
    // The floor has to sit past any credible offline stretch, or it would eat
    // the exact case the column exists for. A week is well inside it.
    const tapped = minutesFromNow(-60 * 24 * 7);
    const id = await stake({ day: 4, title: 'a week in the outbox', updated_at: tapped });

    expect(await readUpdatedAt(id)).toBe(Date.parse(tapped));
  });
});

/**
 * last-write-wins, which until now was a column nobody compared.
 *
 * The client upserts a whole row with `onConflict: 'id'`, so a losing write
 * arrives as a full-row UPDATE — every column, not just the changed ones. That
 * is why "the older write loses" has to be checked on the row's *other* fields
 * and not only on its timestamp.
 */
describe('last-write-wins', () => {
  /** The shape the client actually sends: a full row, upserted on id. */
  const upsert = (id: string, at: string, fields: Record<string, unknown>) =>
    asUser('maya')
      .from('tasks')
      .upsert(
        {
          id,
          owner_id: idOf('maya'),
          week_start: WEEK,
          day: 0,
          category: 'move',
          points: 3,
          aud: 'friends',
          updated_at: at,
          ...fields,
        },
        { onConflict: 'id' },
      );

  const readTask = async (id: string) => {
    const { data } = await asService()
      .from('tasks')
      .select('title,points,done_at,updated_at')
      .eq('id', id)
      .single();
    return data as { title: string; points: number; done_at: string | null; updated_at: string };
  };

  it('a newer write replaces an older row', async () => {
    const id = await stake({ day: 0, title: 'monday', updated_at: minutesFromNow(-120) });

    const { error } = await upsert(id, minutesFromNow(-10), { title: 'wednesday', points: 7 });
    expect(error).toBeNull();

    const row = await readTask(id);
    expect(row.title).toBe('wednesday');
    expect(row.points).toBe(7);
  });

  it('an older write does not clobber a newer row', async () => {
    // The scenario the clamp comment always claimed to cover: a stake queued
    // offline on Monday, drained on Friday, arriving after a Wednesday edit
    // made on another device.
    const edited = minutesFromNow(-10);
    const id = await stake({ day: 0, title: 'wednesday', points: 7, updated_at: edited });

    const { error } = await upsert(id, minutesFromNow(-120), { title: 'monday', points: 1 });
    // A loss is not an error. The write was well-formed and permitted; it was
    // simply superseded, and there is nothing for the outbox to retry.
    expect(error).toBeNull();

    const row = await readTask(id);
    expect(row.title).toBe('wednesday');
    expect(row.points).toBe(7);
    expect(Date.parse(row.updated_at)).toBe(Date.parse(edited));
  });

  it('hands the winning row back to the write that lost', async () => {
    // The deliberate half of the design. A skipped row (`return null`) would
    // come back as `[]`, which in this schema already means "RLS refused you"
    // — see the refused-update tests above. Returning the stored row keeps
    // losing a race distinguishable from being denied, and gives the loser the
    // values it needs to reconcile against.
    const id = await stake({ day: 0, title: 'wednesday', updated_at: minutesFromNow(-10) });

    const { data, error } = await asUser('maya')
      .from('tasks')
      .update({ title: 'monday', updated_at: minutesFromNow(-120) })
      .eq('id', id)
      .select('title');
    expect(error).toBeNull();
    expect(data).toEqual([{ title: 'wednesday' }]);
  });

  it('is stable when two writes carry the same updated_at', async () => {
    // Same millisecond, no recoverable ordering. Refusing both would lose a
    // tap, and an equal stamp is also what a retry of a write that already
    // landed looks like — so the later arrival applies, without an error.
    const at = minutesFromNow(-30);
    const id = await stake({ day: 0, title: 'first', updated_at: at });

    const again = await upsert(id, at, { title: 'second', points: 5 });
    expect(again.error).toBeNull();

    const row = await readTask(id);
    expect(row.title).toBe('second');
    expect(row.points).toBe(5);
    expect(Date.parse(row.updated_at)).toBe(Date.parse(at));
  });

  it('does not block an update that leaves updated_at alone', async () => {
    // Changing a column against the row as it stands is not a competing write.
    // The audience flip above takes this path, as does anything server-side.
    const staked = minutesFromNow(-120);
    const id = await stake({ day: 0, title: 'untouched clock', updated_at: staked });

    const { error } = await asUser('maya').from('tasks').update({ points: 9 }).eq('id', id);
    expect(error).toBeNull();

    const row = await readTask(id);
    expect(row.points).toBe(9);
    expect(Date.parse(row.updated_at)).toBe(Date.parse(staked));
  });

  it('still lets a task be closed, and reopened', async () => {
    // The commonest write in the app, end to end and in the client's own
    // shape: `done_at` is the boolean the UI toggles, and each toggle carries
    // a fresh clock, so it must never be the losing side.
    const id = await stake({ day: 0, title: 'run', updated_at: minutesFromNow(-60) });
    expect((await readTask(id)).done_at).toBeNull();

    const closedAt = minutesFromNow(0);
    const closed = await upsert(id, closedAt, { title: 'run', done_at: closedAt });
    expect(closed.error).toBeNull();
    expect((await readTask(id)).done_at).not.toBeNull();

    const reopenedAt = minutesFromNow(1);
    const reopened = await upsert(id, reopenedAt, { title: 'run', done_at: null });
    expect(reopened.error).toBeNull();
    expect((await readTask(id)).done_at).toBeNull();
  });

  it('a stale close cannot reopen a task that was closed later', async () => {
    const id = await stake({ day: 0, title: 'run', updated_at: minutesFromNow(-60) });

    const closedAt = minutesFromNow(-5);
    expect((await upsert(id, closedAt, { title: 'run', done_at: closedAt })).error).toBeNull();

    // A queued edit from before the close drains and would otherwise clear it.
    const late = await upsert(id, minutesFromNow(-30), { title: 'run', done_at: null });
    expect(late.error).toBeNull();
    expect((await readTask(id)).done_at).not.toBeNull();
  });
});

/**
 * The feed read, against real RLS. The client scopes *whose* tasks to ask
 * about; the database decides *what* of theirs is visible — and that half is
 * only honest here, since the in-memory fake models no policies at all.
 */
describe('reading a circle-mate’s week', () => {
  const feed = async (handle: SeedHandle, owners: SeedHandle[]) => {
    const { data } = await asUser(handle)
      .from('tasks')
      .select('title,aud,owner_id')
      .in(
        'owner_id',
        owners.map((h) => idOf(h)),
      );
    return data ?? [];
  };

  // Still deliberately no "sofia cannot see it" case here, for the reason it
  // always gave: the rule is pinned above at the `canSee` matrix, and a second
  // copy would mean two places to change. The rule itself has since been
  // revisited — `friends` now resolves through `shares_circle_on(circle_id,
  // owner_id)`, so sharing *any* circle is no longer enough — and the matrix
  // moved with it.
  it('shows dre what maya put on the line for her circle', async () => {
    const rows = await feed('dre', ['maya']);

    expect(rows.length).toBeGreaterThan(0);
    // Never her private ones, whoever asked and however the client queried.
    expect(rows.every((r) => r.aud !== 'private')).toBe(true);
  });

  it('shows jordan only what maya made public', async () => {
    const rows = await feed('jordan', ['maya']);

    expect(rows.every((r) => r.aud === 'everyone')).toBe(true);
  });

  it('does not let naming someone in the query grant anything — the control', async () => {
    // Proof the filter is a scope and not a capability: jordan asking about
    // maya by id gets exactly what RLS already allowed him.
    const named = await feed('jordan', ['maya']);
    const { data: all } = await asUser('jordan').from('tasks').select('owner_id');
    const mayaRows = (all ?? []).filter((r) => r.owner_id === idOf('maya'));

    expect(named).toHaveLength(mayaRows.length);
  });
});
