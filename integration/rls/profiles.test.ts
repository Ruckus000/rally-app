/**
 * profiles: you, and anyone you share a circle with.
 *
 * This file is also the harness's own smoke test — if the seed, the sign-ins
 * or the grants are wrong, these fail first and most legibly.
 */
import { asAnon, asUser, idOf, signInAnonymously } from '../support/clients';
import { asRole } from '../support/reset';
import { SEED_HANDLES, HANDLE_RE, SEED_USERS, BOT_HANDLES } from '../fixtures/world';

const handles = async (client: ReturnType<typeof asUser>) => {
  const { data, error } = await client.from('profiles').select('handle');
  expect(error).toBeNull();
  return (data ?? []).map((r: { handle: string }) => r.handle).sort();
};

/** The bots are readable by everyone, so they are in every list below. */
const withBots = (...people: string[]) => [...BOT_HANDLES, ...people].sort();

describe('profiles visibility', () => {
  // That the bots are in every one of these is the point of them, and
  // `bots.test.ts` holds the line that they are the *only* rows anyone gets
  // for free. What each assertion is actually about is the people beside them.
  it('maya sees herself and both her circles, and nobody else', async () => {
    // basement: dre, nana · gym: sofia · jordan and tomas share nothing.
    expect(await handles(asUser('maya'))).toEqual(withBots('dre', 'maya', 'nana', 'sofia'));
  });

  it('jordan sees only himself and his one circle-mate', async () => {
    expect(await handles(asUser('jordan'))).toEqual(withBots('jordan', 'tomas'));
  });

  it('sharing a different circle is still sharing a circle', async () => {
    // sofia is in gym, not basement, but still sees maya.
    expect(await handles(asUser('sofia'))).toEqual(withBots('maya', 'sofia'));
  });

  it('a signed-out client cannot reach the table at all', async () => {
    const { error } = await asAnon().from('profiles').select('handle');
    // Stronger than "zero rows": `anon` holds no grant on the table, so it is
    // refused before RLS is consulted. Defence in depth, and deliberate — the
    // repair migration grants to `authenticated` only.
    expect(error?.code).toBe('42501');
  });
});

describe('profiles writes', () => {
  it('cannot update another persons profile', async () => {
    const { data, error } = await asUser('dre')
      .from('profiles')
      .update({ name: 'Renamed By Dre' })
      .eq('id', idOf('maya'))
      .select();

    // An UPDATE refused by RLS is a silent no-op in PostgREST, not a 42501.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('leaves the row genuinely unchanged after a refused update', async () => {
    await asUser('dre')
      .from('profiles')
      .update({ name: 'Renamed By Dre' })
      .eq('id', idOf('maya'));

    const { data } = await asUser('maya').from('profiles').select('name').eq('id', idOf('maya'));
    expect(data?.[0]?.name).toBe(SEED_USERS.maya.name);
  });

  it('can update its own profile', async () => {
    const { data, error } = await asUser('nana')
      .from('profiles')
      .update({ name: 'Nana R.' })
      .eq('id', idOf('nana'))
      .select();

    expect(error).toBeNull();
    expect(data?.[0]?.name).toBe('Nana R.');

    await asUser('nana').from('profiles').update({ name: SEED_USERS.nana.name }).eq('id', idOf('nana'));
  });

  /**
   * The client clamps to 80 too, but the client is the layer an attacker gets
   * to replace. This is the one that holds — and it has to, because the victim
   * is not the sender: an over-long name is persisted by everyone who shares a
   * circle with them, and it fails `peopleAreSound` on the *next launch*,
   * discarding the whole payload. A wiped week with no error and nothing to
   * blame is the outcome this constraint prevents.
   */
  it('refuses a display name long enough to wipe every circle-mate', async () => {
    const { error } = await asUser('nana')
      .from('profiles')
      .update({ name: 'A'.repeat(81) })
      .eq('id', idOf('nana'));

    expect(error?.code).toBe('23514');
    expect(error?.message).toContain('profiles_name_length');

    // Refused, not partially applied.
    const { data } = await asUser('nana').from('profiles').select('name').eq('id', idOf('nana'));
    expect(data?.[0]?.name).toBe(SEED_USERS.nana.name);
  });

  it('refuses an empty one, which renders as a nameless row', async () => {
    const { error } = await asUser('nana')
      .from('profiles')
      .update({ name: '' })
      .eq('id', idOf('nana'));

    expect(error?.code).toBe('23514');
  });

  it('accepts a name exactly at the bound — the control', async () => {
    // Without this, a constraint of `char_length(name) = 0` would pass both of
    // the tests above while refusing every real name in the app.
    const exact = 'A'.repeat(80);
    const { error } = await asUser('nana')
      .from('profiles')
      .update({ name: exact })
      .eq('id', idOf('nana'));

    expect(error).toBeNull();

    await asUser('nana').from('profiles').update({ name: SEED_USERS.nana.name }).eq('id', idOf('nana'));
  });
});

describe('a brand-new anonymous user', () => {
  it('gets a profile row without the client ever inserting one', async () => {
    const { client, id } = await signInAnonymously();
    const { data, error } = await client.from('profiles').select('handle,name').eq('id', id);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.name).toBe('Someone');
  });

  it('gets a generated handle that satisfies the check constraint', async () => {
    const { client, id } = await signInAnonymously();
    const { data } = await client.from('profiles').select('handle').eq('id', id);
    expect(data?.[0]?.handle).toMatch(HANDLE_RE);
  });

  it('sees no person but itself, because it is in no circle yet', async () => {
    const { client, id } = await signInAnonymously();
    const { data } = await client.from('profiles').select('id,handle');

    // The bots are here by design and `bots.test.ts` owns that claim. What this
    // one still says — and what widening the policy must not have changed —
    // is that none of the seeded people are reachable.
    const rows = (data ?? []) as { id: string; handle: string }[];
    expect(rows.filter((r) => r.id !== id).map((r) => r.handle).sort()).toEqual(BOT_HANDLES);
  });
});

describe('the private helpers stay unreachable', () => {
  it.each(['is_circle_member', 'shares_circle_with', 'is_paired_on', 'can_see_task'])(
    'private.%s is not callable over REST',
    async (fn) => {
      const { error } = await asUser('maya').rpc(fn as never, { target_circle: idOf('maya') });
      expect(error).not.toBeNull();
      // PGRST202: not in the exposed schema cache. `private` is absent from
      // [api] schemas, so PostgREST cannot see it at all.
      expect(error?.code).toBe('PGRST202');
    },
  );

  it('anon cannot execute the helpers even over a direct connection', async () => {
    const { error } = await asRole(
      'anon',
      `select private.shares_circle_with('${idOf('maya')}'::uuid)`,
    );
    expect(error).toBe('42501');
  });

  it('authenticated CAN execute them, which is what makes the policies work', async () => {
    // The init migration revoked this and silently broke every policy that
    // calls a helper. Regression test for that repair.
    const { error } = await asRole(
      'authenticated',
      `select private.shares_circle_with('${idOf('maya')}'::uuid)`,
    );
    expect(error).toBeUndefined();
  });
});

describe('the seed world matches the app fixtures', () => {
  it('every seeded handle satisfies the profiles check constraint', () => {
    for (const h of SEED_HANDLES) expect(SEED_USERS[h].handle).toMatch(HANDLE_RE);
  });
});
