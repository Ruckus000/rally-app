/**
 * pull_world: the one-round-trip pull, against real RLS.
 *
 * The function is SECURITY INVOKER on purpose — its whole claim is that it
 * restates no visibility rule, and that claim can only be tested where the
 * policies are real. The unit suite proves the engine reads the payload; this
 * file proves the payload contains exactly what the caller's own thirteen
 * queries would have contained, and nothing more.
 *
 * The negative cases matter most: a SECURITY DEFINER slip, or a CTE that
 * forgets a scope, fails *here* — as maya's private task appearing in dre's
 * world, or maya appearing in jordan's — not in any unit test.
 */
import { randomUUID } from 'node:crypto';
import { asAnon, asService, asUser, idOf } from '../support/clients';
import { sql } from '../support/reset';
import { CIRCLE_IDS, SEED_BOTS, type SeedHandle } from '../fixtures/world';

/** 2026-08-10 is a Monday, which is what `week_start` means. */
const WEEK = '2026-08-10';

type Person = {
  id: string;
  handle: string;
  name: string;
  avatar_path: string | null;
  avatar_state: string;
};

type World = {
  people: Person[];
  bots: Person[];
  circle: { id: string; name: string; invite_code: string } | null;
  circles: { id: string; name: string; invite_code: string; joined_at: string }[];
  memberships: { circle_id: string; profile_id: string }[];
  notifications: unknown[];
  my_tasks: { id: string; title: string }[] | null;
  owner_tasks: { id: string; title: string; owner_id: string }[];
  reactions: { target_id: string; kind: string }[];
  notes: { id: string; body: string }[];
  rollups: { week_start: string; points: number }[];
  circle_shares:
    | { profile_id: string; week_start: string; points: number; done: number; total: number; streak: number }[]
    | null;
  my_share: { week_start: string; shared_at: string } | null;
  media:
    | { id: string; task_id: string; owner_id: string; path: string; state: string }[]
    | null;
  cheer_counts: Record<string, number>;
};

const worldOf = async (
  handle: Parameters<typeof asUser>[0],
  weekStart: string | null = WEEK,
): Promise<World> => {
  const { data, error } = await asUser(handle).rpc('pull_world', {
    p_week_start: weekStart,
    p_notif_limit: 30,
  });
  expect(error).toBeNull();
  return data as World;
};

const titlesOf = (rows: { title: string }[] | null): string[] =>
  (rows ?? []).map((r) => r.title).sort();

let taskIds: Record<'friends' | 'everyone' | 'privateAlone', string>;

beforeEach(async () => {
  // Maya stakes one task per audience, through her own client, so the write
  // policies stay on the hook for this file's setup too.
  const maya = asUser('maya');
  const base = { owner_id: idOf('maya'), week_start: WEEK, category: 'move', points: 3 };
  const { data, error } = await maya
    .from('tasks')
    .insert([
      { ...base, day: 0, title: 'W_friends', aud: 'friends', circle_id: CIRCLE_IDS.basement },
      { ...base, day: 1, title: 'W_everyone', aud: 'everyone' },
      { ...base, day: 2, title: 'W_private', aud: 'private' },
    ])
    .select('id,title');
  expect(error).toBeNull();
  const rows = (data ?? []) as { id: string; title: string }[];
  taskIds = {
    friends: rows.find((r) => r.title === 'W_friends')!.id,
    everyone: rows.find((r) => r.title === 'W_everyone')!.id,
    privateAlone: rows.find((r) => r.title === 'W_private')!.id,
  };
});

describe('for a circle-mate (dre shares basement with maya)', () => {
  it('carries the circle, its people, and the visible half of maya’s week', async () => {
    const world = await worldOf('dre');

    // The directory holds everyone dre shares a circle with — including
    // himself, exactly as pullCircle answered.
    const ids = world.people.map((p) => p.id);
    expect(ids).toContain(idOf('maya'));
    expect(ids).toContain(idOf('dre'));
    // …and not jordan, who shares nothing with him.
    expect(ids).not.toContain(idOf('jordan'));

    expect(world.circle).not.toBeNull();

    // The feed: friends and everyone cross; private does not. This is
    // `tasks_select` speaking through the function, not a rule of its own.
    expect(titlesOf(world.owner_tasks)).toEqual(['W_everyone', 'W_friends']);
  });

  it('answers my_tasks as null when no week is asked for, never as empty', async () => {
    const world = await worldOf('dre', null);
    expect(world.my_tasks).toBeNull();
    expect(world.owner_tasks).toEqual([]);
  });

  it('names the bots for everyone, which is what lets a new account draw the feed', async () => {
    const world = await worldOf('jordan');
    const botIds = world.bots.map((b) => b.id).sort();
    expect(botIds).toEqual(SEED_BOTS.map((b) => b.id).sort());
  });
});

describe('the circle it names, for someone in two', () => {
  /**
   * maya is in basement *and* gym (`integration/fixtures/world.ts`), which
   * makes her the only seeded account this can be asked of — and the reason
   * the fixtures put her in two in the first place.
   *
   * `my_circle` used to be `limit 1` with no `order by`: an arbitrary row, and
   * Postgres is free to pick a different one on the next call. The client does
   * not treat it as arbitrary — it is the Me header's subtitle, the Circle
   * tab's roster, and the invite code the share sheet hands out.
   */
  it('answers with the same circle twice', async () => {
    const first = await worldOf('maya');
    const second = await worldOf('maya');

    expect(first.circle).not.toBeNull();
    // Two calls, because one cannot catch a plan that is free to change its
    // mind. This is the whole assertion; the value itself is below.
    expect(second.circle).toEqual(first.circle);
  });

  /**
   * The assertion with teeth.
   *
   * The two above pin the intent but cannot fail against the old code: with
   * `limit 1` and no `order by`, Postgres on tables this small answers in
   * insertion order, which is basement — the same circle the new rule names.
   * You cannot write a test that reliably fails against nondeterminism.
   *
   * So this pins the *rule* instead, in the one case where the two candidate
   * orderings disagree: a circle joined later whose id sorts earlier. `joined_at`
   * says basement, `id` says the newcomer. If anyone ever "simplifies" the
   * ordering to `order by c.id`, this is what stops them.
   */
  /**
   * Cleanup in `afterEach`, not at the end of the test body.
   *
   * It was at the end, and when the assertion below failed the circle it
   * creates outlived the file — `circles.test.ts` then reported maya in three
   * circles, in a different file, for a reason neither file mentioned. A
   * fixture a failing test leaves behind turns one red test into two.
   */
  const SORTS_FIRST = '00000000-0000-4000-8000-000000000000';

  afterEach(async () => {
    await sql('delete from public.circle_members where circle_id = $1', [SORTS_FIRST]);
    await sql('delete from public.circles where id = $1', [SORTS_FIRST]);
  });

  it('prefers the older membership over the smaller id', async () => {
    const earlierId = SORTS_FIRST;
    await sql(
      `insert into public.circles (id, name, invite_code, created_by)
       values ($1, 'Sorts First', 'sorts-first-0123456789abcdef', $2)`,
      [earlierId, idOf('maya')],
    );
    // Joined now, so `joined_at` is unambiguously later than the seeded rows —
    // this is the one membership in the suite whose timestamp does not tie.
    await sql('insert into public.circle_members (circle_id, profile_id) values ($1, $2)', [
      earlierId,
      idOf('maya'),
    ]);

    const world = await worldOf('maya');

    expect(world.circle?.id).toBe(CIRCLE_IDS.basement);
    expect(world.circle?.id).not.toBe(earlierId);
  });

  it('answers with the membership she has held longest', async () => {
    const world = await worldOf('maya');

    // `seed.sql` writes every membership in one statement, so `joined_at` ties
    // to the microsecond and the circle id is what actually breaks it. That
    // makes this assertion a fact about the tiebreak rather than about time,
    // which is the honest way to pin it: whichever circle sorts first by id is
    // the one the pull must keep naming.
    const expected = [CIRCLE_IDS.basement, CIRCLE_IDS.gym].sort()[0];
    expect(world.circle?.id).toBe(expected);
  });
});

describe('every circle you are in, and who is in each', () => {
  it('lists them all, oldest first', async () => {
    const world = await worldOf('maya');

    expect(world.circles.map((c) => c.name)).toEqual(['The Basement', 'Gym']);
    // Same ordering rule as the singular key, which is what lets the client
    // treat `circle` as `circles[0]` while it still reads it.
    expect(world.circle?.id).toBe(world.circles[0].id);
  });

  it('lists one for someone in one, and none for someone in none', async () => {
    expect((await worldOf('dre')).circles.map((c) => c.name)).toEqual(['The Basement']);
    // `you` is the seeded account in no circle. `[]` is a real answer and has
    // to be distinguishable from the key being absent — the client reads a
    // missing key as "this pull cannot say" and an empty array as "none".
    expect((await worldOf('you')).circles).toEqual([]);
    expect((await worldOf('you')).circle).toBeNull();
  });

  it('names who is in which, without naming anyone twice in the directory', async () => {
    const world = await worldOf('maya');

    // maya is in both circles, so she appears in `memberships` twice — that is
    // what an edge list is for, and it is the only key here allowed to repeat
    // a person.
    const mine = world.memberships.filter((m) => m.profile_id === idOf('maya'));
    expect(mine.map((m) => m.circle_id).sort()).toEqual(
      [CIRCLE_IDS.basement, CIRCLE_IDS.gym].sort(),
    );

    // …and exactly once in `people`. This pair is the regression test for the
    // optimisation the migration header warns about: rewriting `owner_tasks`
    // or `people` as a join to `memberships` returns a shared member twice,
    // and the duplicate propagates into `cheer_counts` and `media`.
    const ids = world.people.map((p) => p.id);
    expect(ids.filter((id) => id === idOf('maya'))).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not name a circle you are not in', async () => {
    // `memberships` is bounded by *your* circles, so outsiders — which maya is
    // not in — must not appear at all, nor its members.
    const world = await worldOf('maya');

    expect(world.memberships.some((m) => m.circle_id === CIRCLE_IDS.outsiders)).toBe(false);
    expect(world.memberships.some((m) => m.profile_id === idOf('jordan'))).toBe(false);
  });
});

describe('for someone in a different circle (sofia shares gym, not basement)', () => {
  it('carries the public half of maya’s week and not the circle half', async () => {
    // The scoping reaching the *pull*, not just the table. `owner_tasks` names
    // whose rows to ask about and leaves what is visible to `tasks_select` —
    // so this passing is the function's central claim holding under a policy
    // that changed underneath it, without the function being touched.
    //
    // `W_friends` is tagged to basement in the `beforeEach` above; sofia is in
    // gym. Before
    // `20260831210000_a_goal_belongs_to_a_circle.sql` she saw both.
    const world = await worldOf('sofia');

    expect(titlesOf(world.owner_tasks)).toEqual(['W_everyone']);
    // She is still in the directory — `profiles_select` keeps
    // `shares_circle_with`, deliberately. Sharing any circle is the right
    // reason to know who somebody is; only a goal belongs to one room.
    expect(world.people.map((p) => p.id)).toContain(idOf('maya'));
  });
});

describe('for a stranger (jordan shares no circle with maya)', () => {
  it('shows none of maya — not her profile, not even her everyone-audience task', async () => {
    const world = await worldOf('jordan');

    expect(world.people.map((p) => p.id)).not.toContain(idOf('maya'));
    // `owner_tasks` scopes to circle-mates and bots, exactly as the client's
    // own query always has: an 'everyone' task from a human stranger is
    // readable in principle but has no name to render, so it is not asked for.
    expect(titlesOf(world.owner_tasks)).toEqual([]);
  });
});

describe('cheer counts', () => {
  beforeEach(async () => {
    // dre and nana both cheer maya's friends task.
    for (const handle of ['dre', 'nana'] as const) {
      const { error } = await asUser(handle).from('reactions').insert({
        actor_id: idOf(handle),
        target_type: 'task',
        target_id: taskIds.friends,
        kind: 'cheer',
      });
      expect(error).toBeNull();
    }
  });

  it('counts everyone else’s cheers on the owner’s own week', async () => {
    const world = await worldOf('maya');
    expect(world.cheer_counts[taskIds.friends]).toBe(2);
  });

  it('excludes the caller’s own cheer, so the screen can add it exactly once', async () => {
    const world = await worldOf('dre');
    expect(world.cheer_counts[taskIds.friends]).toBe(1);
    // …and his own tap comes back in `reactions`, which is the other half of
    // the contract: the count plus the tap the client already knows about.
    expect(world.reactions).toContainEqual({ target_id: taskIds.friends, kind: 'cheer' });
  });
});

/**
 * The case the whole avatar column exists for, and the one no unit test can
 * reach: `avatar_state` moves to `ready` only inside `mark_avatar_screened`,
 * which is revoked from every role a client can hold. So the *only* way an
 * account ever learns its own photo was approved is by reading its own
 * profile row back out of a pull — and `alex` (you_rally) is in no circle, so
 * before this the `people` CTE returned nothing about her at all.
 */
describe('your own row, for an account in no circle', () => {
  const SOLO = 'you' as const;

  afterEach(async () => {
    const { error } = await asUser(SOLO).rpc('set_avatar', { p_path: null });
    expect(error).toBeNull();
  });

  it('is in `people` at all, with no circle to arrive as a by-product of', async () => {
    const world = await worldOf(SOLO);
    expect(world.circle).toBeNull();
    expect(world.people.map((p) => p.id)).toEqual([idOf(SOLO)]);
  });

  it('carries the screening verdict, which arrives nowhere else', async () => {
    const path = `${idOf(SOLO)}/${randomUUID()}.jpg`;

    // What the client can do for itself: point at the object, land on pending.
    expect((await asUser(SOLO).rpc('set_avatar', { p_path: path })).error).toBeNull();
    const pending = (await worldOf(SOLO)).people.find((p) => p.id === idOf(SOLO));
    expect(pending).toMatchObject({ avatar_path: path, avatar_state: 'pending' });

    // What only the screener can do, holding the service key.
    const verdict = await asService().rpc('mark_avatar_screened', {
      p_profile: idOf(SOLO),
      p_state: 'ready',
    });
    expect(verdict.error).toBeNull();

    const ready = (await worldOf(SOLO)).people.find((p) => p.id === idOf(SOLO));
    expect(ready).toMatchObject({ avatar_path: path, avatar_state: 'ready' });
  });

  it('carries the columns for circle-mates and bots too, so one mapper reads all three', async () => {
    const world = await worldOf('dre');
    for (const row of [...world.people, ...world.bots]) {
      expect(row).toHaveProperty('avatar_path');
      expect(row.avatar_state).toBe('none');
    }
  });
});

describe('signed out', () => {
  it('is refused at the function, not three joins later at a table', async () => {
    // This test passed before EXECUTE was revoked from PUBLIC, and passed for
    // the wrong reason: `anon` could call the function perfectly well and died
    // at the first table it has no SELECT on. Same 42501, entirely different
    // guarantee — one that would quietly stop holding the day somebody granted
    // `anon` a read on any table these CTEs touch. So the message is asserted
    // too, because the message is the part that says which layer refused.
    const { error } = await asAnon().rpc('pull_world', { p_week_start: WEEK });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
    expect(error!.message).toContain('pull_world');
  });

  it('still lets a signed-in caller through', async () => {
    // The other half, and not a formality: `revoke ... from public` takes the
    // permission away from everyone, and only the explicit grant beside it
    // hands it back. Get that pair wrong and the app stops pulling entirely.
    const { error } = await asUser('maya').rpc('pull_world', { p_week_start: WEEK });
    expect(error).toBeNull();
  });
});

/**
 * The photos, which the pull carries because a goal and its picture are one
 * thing to the person reading the feed.
 *
 * The CTE has no predicate of its own — `task_media_select` already answers
 * screening state, blocks and audience, and `pull_world` runs as the caller.
 * So what is being tested here is precisely that *not restating it works*: if
 * the function ever stopped being SECURITY INVOKER, or grew a `where` of its
 * own that drifted from the policy, these are the tests that fail.
 */
describe('the photos on those goals', () => {
  const mediaId = () => randomUUID();

  /** Attach a photo to one of maya's goals. `ready` unless a test says not. */
  const attach = async (taskId: string, state: 'pending' | 'ready' = 'ready') => {
    const id = mediaId();
    const { error } = await asUser('maya')
      .from('task_media')
      .insert({
        id,
        task_id: taskId,
        owner_id: idOf('maya'),
        path: `${idOf('maya')}/${taskId}/${id}.jpg`,
        width: 1600,
        height: 1200,
      });
    expect(error).toBeNull();
    if (state === 'ready') {
      // The only route, and service-role only: no client can publish a photo.
      await sql('select public.mark_task_media_ready($1)', [id]);
    }
    return id;
  };

  const mediaIn = (world: World) => (world.media ?? []).map((m) => m.id).sort();

  it('gives a circle-mate the photo on a friends goal', async () => {
    const id = await attach(taskIds.friends);
    expect(mediaIn(await worldOf('dre'))).toEqual([id]);
  });

  it('withholds one the screener has not passed yet', async () => {
    await attach(taskIds.friends, 'pending');
    expect(mediaIn(await worldOf('dre'))).toEqual([]);
  });

  it('still gives the owner their own pending photo', async () => {
    // The reason the CTE must not gain `and state = 'ready'`: this is what puts
    // a photo on the owner's *second* device in the seconds before the screener
    // answers. Take it away and that device shows nothing — and, because the
    // client reads "no row" as "removed elsewhere", deletes the photo it has.
    const id = await attach(taskIds.friends, 'pending');
    expect(mediaIn(await worldOf('maya'))).toEqual([id]);
  });

  it('withholds a private goal’s photo from the circle', async () => {
    await attach(taskIds.privateAlone);
    expect(mediaIn(await worldOf('dre'))).toEqual([]);
  });

  it('withholds it from someone outside the circle', async () => {
    await attach(taskIds.friends);
    expect(mediaIn(await worldOf('jordan'))).toEqual([]);
  });

  it('withholds it from somebody blocked', async () => {
    const id = await attach(taskIds.friends);
    expect(mediaIn(await worldOf('dre'))).toEqual([id]);

    const { error } = await asUser('dre').rpc('block_person', { p_blocked: idOf('maya') });
    expect(error).toBeNull();
    try {
      expect(mediaIn(await worldOf('dre'))).toEqual([]);
    } finally {
      await sql('delete from public.blocks');
    }
  });

  it('answers null rather than empty when there is no week to ask about', async () => {
    // The distinction the client acts on. Empty means "these goals have no
    // photos", which is how a removal on another device arrives — so a
    // week-less pull answering `[]` would delete every photo on the device.
    await attach(taskIds.friends);
    const world = await worldOf('maya', null);
    expect(world.media).toBeNull();
    // And `my_tasks`, which has always answered this way, agrees.
    expect(world.my_tasks).toBeNull();
  });

  it('answers empty when the week genuinely has none', async () => {
    expect(await worldOf('maya').then((w) => w.media)).toEqual([]);
  });
});

/**
 * The finished weeks other people chose to post.
 *
 * `week_shares` is insert-only and written by the button, so the opt-in is the
 * whole mechanism: nothing here appears because a week happened to go well.
 */
describe('the perfect weeks other people posted', () => {
  const share = (handle: SeedHandle, over: Record<string, unknown> = {}) => ({
    profile_id: idOf(handle),
    week_start: WEEK,
    points: 150,
    done: 6,
    total: 6,
    streak: 5,
    ...over,
  });

  it('is empty until somebody posts one', async () => {
    expect((await worldOf('maya')).circle_shares).toEqual([]);
  });

  it('carries a circle-mate’s once they do', async () => {
    await asUser('dre').from('week_shares').insert(share('dre'));

    const world = await worldOf('maya');
    expect(world.circle_shares).toHaveLength(1);
    expect(world.circle_shares![0]).toMatchObject({
      profile_id: idOf('dre'),
      week_start: WEEK,
      points: 150,
      done: 6,
      total: 6,
      streak: 5,
    });
  });

  it('does not carry a stranger’s', async () => {
    await asUser('jordan').from('week_shares').insert(share('jordan'));
    expect((await worldOf('maya')).circle_shares).toEqual([]);
  });

  it('does not carry last week’s', async () => {
    await asUser('dre').from('week_shares').insert(share('dre', { week_start: '2026-08-03' }));
    expect((await worldOf('maya')).circle_shares).toEqual([]);
  });

  it('names somebody in two of your circles exactly once', async () => {
    // The fan-out this function's header is mostly about. maya is in basement
    // and gym; dre shares basement with her and sofia shares gym, so each of
    // them sees her once and neither sees her twice.
    await asUser('maya').from('week_shares').insert(share('maya'));

    for (const viewer of ['dre', 'sofia'] as const) {
      const world = await worldOf(viewer);
      expect(world.circle_shares).toHaveLength(1);
      expect(world.circle_shares![0].profile_id).toBe(idOf('maya'));
    }
  });

  it('keeps your own out of the list, and answers for it separately', async () => {
    // Two keys because the client asks two questions: what to draw in the feed,
    // and whether the button has already been pressed. The second has to
    // survive a reinstall, which is why it is not `acted`.
    await asUser('maya').from('week_shares').insert(share('maya'));

    const world = await worldOf('maya');
    expect(world.circle_shares).toEqual([]);
    expect(world.my_share).toMatchObject({ week_start: WEEK });
  });

  it('answers null for your own when you have not posted', async () => {
    expect((await worldOf('maya')).my_share).toBeNull();
  });

  it('is null rather than empty when there is no week to ask about', async () => {
    // Same contract `my_tasks` and `media` keep: the client treats an empty
    // array as authoritative, so "not asked" has to be distinguishable.
    const world = await worldOf('maya', null);
    expect(world.circle_shares).toBeNull();
    expect(world.my_share).toBeNull();
  });
});
