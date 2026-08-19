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
import { asAnon, asUser, idOf } from '../support/clients';
import { CIRCLE_IDS, SEED_BOTS } from '../fixtures/world';

/** 2026-08-10 is a Monday, which is what `week_start` means. */
const WEEK = '2026-08-10';

type World = {
  people: { id: string; handle: string; name: string }[];
  bots: { id: string; handle: string; name: string }[];
  circle: { id: string; name: string; invite_code: string } | null;
  notifications: unknown[];
  my_tasks: { id: string; title: string }[] | null;
  owner_tasks: { id: string; title: string; owner_id: string }[];
  reactions: { target_id: string; kind: string }[];
  notes: { id: string; body: string }[];
  rollups: { week_start: string; points: number }[];
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

describe('signed out', () => {
  it('is refused outright — execute is granted to authenticated only', async () => {
    const { error } = await asAnon().rpc('pull_world', { p_week_start: WEEK });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });
});
