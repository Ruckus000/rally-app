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
import { CIRCLE_IDS, SEED_BOTS } from '../fixtures/world';

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
  notifications: unknown[];
  my_tasks: { id: string; title: string }[] | null;
  owner_tasks: { id: string; title: string; owner_id: string }[];
  reactions: { target_id: string; kind: string }[];
  notes: { id: string; body: string }[];
  rollups: { week_start: string; points: number }[];
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
  it('is refused outright — execute is granted to authenticated only', async () => {
    const { error } = await asAnon().rpc('pull_world', { p_week_start: WEEK });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
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
