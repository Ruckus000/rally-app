/**
 * circles, circle_members, and the only supported way in: join_circle_by_code.
 *
 * `beforeEach` truncates the domain tables but deliberately leaves circles and
 * circle_members alone, since they come from seed.sql. This file writes to
 * both, so it restores the seeded shape after every test — otherwise one
 * anonymous user joining the basement changes what maya can see in every
 * other file in the suite.
 */
import { randomUUID } from 'node:crypto';
import { asAnon, asService, asUser, idOf, signInAnonymously } from '../support/clients';
import { sql } from '../support/reset';
import { CIRCLE_IDS, MEMBERSHIPS, type SeedHandle } from '../fixtures/world';

const SEED_CIRCLE_IDS = Object.values(CIRCLE_IDS);

/** A code no other test can collide with — circles.invite_code is unique. */
const newCode = () => `probe-${randomUUID().slice(0, 8)}`;

const seededPairs = () => {
  const circleIds: string[] = [];
  const profileIds: string[] = [];
  for (const [circle, members] of Object.entries(MEMBERSHIPS) as [
    keyof typeof CIRCLE_IDS,
    SeedHandle[],
  ][]) {
    for (const handle of members) {
      circleIds.push(CIRCLE_IDS[circle]);
      profileIds.push(idOf(handle));
    }
  }
  return { circleIds, profileIds };
};

afterEach(async () => {
  const { circleIds, profileIds } = seededPairs();

  await sql(
    `delete from public.circle_members
       where (circle_id::text || ':' || profile_id::text) <> all (
         select c || ':' || p from unnest($1::text[], $2::text[]) as t(c, p)
       )`,
    [circleIds, profileIds],
  );
  await sql(
    `insert into public.circle_members (circle_id, profile_id)
       select c, p from unnest($1::uuid[], $2::uuid[]) as t(c, p)
     on conflict (circle_id, profile_id) do nothing`,
    [circleIds, profileIds],
  );
  await sql('delete from public.circles where id <> all($1::uuid[])', [SEED_CIRCLE_IDS]);
});

const circleNamesFor = async (handle: SeedHandle) => {
  const { data, error } = await asUser(handle).from('circles').select('name');
  expect(error).toBeNull();
  return (data ?? []).map((r: { name: string }) => r.name).sort();
};

describe('circles are visible to their members only', () => {
  it('maya sees both circles she belongs to', async () => {
    expect(await circleNamesFor('maya')).toEqual(['Gym', 'The Basement']);
  });

  it('sofia shares a circle with maya but sees only the one she is in', async () => {
    expect(await circleNamesFor('sofia')).toEqual(['Gym']);
  });

  it('jordan cannot see a circle he is not a member of', async () => {
    const { data, error } = await asUser('jordan')
      .from('circles')
      .select('name')
      .eq('id', CIRCLE_IDS.basement);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('a non-member asking for exactly one circle gets the empty-result error', async () => {
    const { error } = await asUser('jordan')
      .from('circles')
      .select('name')
      .eq('id', CIRCLE_IDS.basement)
      .single();

    expect(error?.code).toBe('PGRST116');
  });

  it('a signed-out client cannot reach the table at all', async () => {
    const { error } = await asAnon().from('circles').select('name');
    // `anon` holds no grant on circles, so this is refused before RLS is
    // consulted — 42501, not zero rows.
    expect(error?.code).toBe('42501');
  });
});

describe('creating a circle', () => {
  it('succeeds when created_by is the caller', async () => {
    const id = randomUUID();
    const { error } = await asUser('jordan')
      .from('circles')
      .insert({ id, name: 'Jordans Circle', invite_code: newCode(), created_by: idOf('jordan') });

    expect(error).toBeNull();

    const { data } = await asService().from('circles').select('created_by').eq('id', id);
    expect(data?.[0]?.created_by).toBe(idOf('jordan'));
  });

  it('cannot be attributed to someone else', async () => {
    const { error } = await asUser('maya')
      .from('circles')
      .insert({ name: 'Not Mine', invite_code: newCode(), created_by: idOf('dre') });

    expect(error?.code).toBe('42501');
  });

  it('cannot omit created_by, even though the column is nullable', async () => {
    // The repair migration dropped NOT NULL so an anonymous creator can be
    // garbage-collected without taking the circle with them. The WITH CHECK
    // still evaluates to NULL — not true — so the insert is refused.
    const { error } = await asUser('maya')
      .from('circles')
      .insert({ name: 'Ownerless', invite_code: newCode() });

    expect(error?.code).toBe('42501');
  });

  it('cannot read back the row it just created, because creating is not joining', async () => {
    // circles_insert lets you create; circles_select still demands membership,
    // and a RETURNING clause is checked against the SELECT policy. So the
    // client must insert without representation, then add itself to
    // circle_members, then read. Creating a circle does not join it.
    const { error } = await asUser('jordan')
      .from('circles')
      .insert({ name: 'Returned?', invite_code: newCode(), created_by: idOf('jordan') })
      .select();

    expect(error?.code).toBe('42501');
  });

  it('cannot reuse an existing invite code', async () => {
    const { error } = await asUser('jordan')
      .from('circles')
      .insert({ name: 'Impostor', invite_code: 'basement-9x2', created_by: idOf('jordan') });

    expect(error?.code).toBe('23505');
  });
});

describe('an invite code cannot be resolved by selecting circles', () => {
  it('a member can read the code of their own circle, which is how it gets shared', async () => {
    const { data, error } = await asUser('maya')
      .from('circles')
      .select('invite_code')
      .eq('id', CIRCLE_IDS.basement);

    expect(error).toBeNull();
    expect(data?.[0]?.invite_code).toBe('basement-9x2');
  });

  it('guessing a code you are not a member of returns nothing', async () => {
    // This is the whole reason join_circle_by_code exists: the person who needs
    // to resolve a code is by definition not yet a member, and widening
    // circles_select to let them would expose every circle to every user.
    const { data, error } = await asUser('jordan')
      .from('circles')
      .select('id,name')
      .eq('invite_code', 'basement-9x2');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('is not a lookup oracle either — a real code and a bogus one look identical', async () => {
    const real = await asUser('jordan').from('circles').select('id').eq('invite_code', 'gym-4k7');
    const fake = await asUser('jordan').from('circles').select('id').eq('invite_code', 'no-such-code');

    expect(real.data).toEqual([]);
    expect(fake.data).toEqual([]);
  });
});

describe('the circle_members roster', () => {
  it('a member sees everyone in their circle', async () => {
    const { data, error } = await asUser('maya')
      .from('circle_members')
      .select('profile_id')
      .eq('circle_id', CIRCLE_IDS.basement);

    expect(error).toBeNull();
    expect((data ?? []).map((r: { profile_id: string }) => r.profile_id).sort()).toEqual(
      [idOf('maya'), idOf('dre'), idOf('nana')].sort(),
    );
  });

  it('a member sees the rosters of all their circles and no others', async () => {
    const { data } = await asUser('maya').from('circle_members').select('circle_id');
    const ids = new Set((data ?? []).map((r: { circle_id: string }) => r.circle_id));

    expect(ids).toEqual(new Set([CIRCLE_IDS.basement, CIRCLE_IDS.gym]));
    expect(data).toHaveLength(5);
  });

  it('sharing the gym does not reveal the basement roster', async () => {
    const { data, error } = await asUser('sofia')
      .from('circle_members')
      .select('profile_id')
      .eq('circle_id', CIRCLE_IDS.basement);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('someone who shares nothing sees only their own circle', async () => {
    const { data } = await asUser('tomas').from('circle_members').select('circle_id');
    expect(new Set((data ?? []).map((r: { circle_id: string }) => r.circle_id))).toEqual(
      new Set([CIRCLE_IDS.outsiders]),
    );
  });
});

describe('circle_members writes are limited to your own row', () => {
  it('cannot add another person to a circle you are in', async () => {
    const { error } = await asUser('maya')
      .from('circle_members')
      .insert({ circle_id: CIRCLE_IDS.basement, profile_id: idOf('jordan') });

    expect(error?.code).toBe('42501');
  });

  it('cannot add another person to a circle you are not in', async () => {
    const { error } = await asUser('jordan')
      .from('circle_members')
      .insert({ circle_id: CIRCLE_IDS.basement, profile_id: idOf('tomas') });

    expect(error?.code).toBe('42501');
  });

  it('can remove itself from a circle', async () => {
    const { error } = await asUser('dre')
      .from('circle_members')
      .delete()
      .eq('circle_id', CIRCLE_IDS.basement)
      .eq('profile_id', idOf('dre'));

    expect(error).toBeNull();

    const { data } = await asService()
      .from('circle_members')
      .select('profile_id')
      .eq('circle_id', CIRCLE_IDS.basement)
      .eq('profile_id', idOf('dre'));
    expect(data).toEqual([]);
  });

  it('cannot remove anybody else, and the row really survives', async () => {
    const { data, error } = await asUser('dre')
      .from('circle_members')
      .delete()
      .eq('circle_id', CIRCLE_IDS.basement)
      .eq('profile_id', idOf('nana'))
      .select();

    // A DELETE refused by RLS is a silent no-op in PostgREST, so the empty
    // result alone proves nothing — re-read past RLS to prove nana is still in.
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: still } = await asService()
      .from('circle_members')
      .select('profile_id')
      .eq('circle_id', CIRCLE_IDS.basement)
      .eq('profile_id', idOf('nana'));
    expect(still).toHaveLength(1);
  });

  it('cannot evict a member of a circle it cannot even see', async () => {
    const { data, error } = await asUser('jordan')
      .from('circle_members')
      .delete()
      .eq('circle_id', CIRCLE_IDS.basement)
      .eq('profile_id', idOf('maya'))
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: still } = await asService()
      .from('circle_members')
      .select('profile_id')
      .eq('circle_id', CIRCLE_IDS.basement)
      .eq('profile_id', idOf('maya'));
    expect(still).toHaveLength(1);
  });
});

describe('join_circle_by_code', () => {
  it('returns the circle uuid to a brand-new anonymous user', async () => {
    const { client } = await signInAnonymously();
    const { data, error } = await client.rpc('join_circle_by_code', { code: 'basement-9x2' });

    expect(error).toBeNull();
    expect(data).toBe(CIRCLE_IDS.basement);
  });

  it('makes the circle itself visible afterwards', async () => {
    const { client } = await signInAnonymously();
    await client.rpc('join_circle_by_code', { code: 'basement-9x2' });

    const { data, error } = await client.from('circles').select('name').eq('id', CIRCLE_IDS.basement);
    expect(error).toBeNull();
    expect(data?.[0]?.name).toBe('The Basement');
  });

  it('makes the roster visible afterwards, joiner included', async () => {
    const { client, id } = await signInAnonymously();
    await client.rpc('join_circle_by_code', { code: 'basement-9x2' });

    const { data } = await client
      .from('circle_members')
      .select('profile_id')
      .eq('circle_id', CIRCLE_IDS.basement);

    expect(data).toHaveLength(4);
    expect((data ?? []).map((r: { profile_id: string }) => r.profile_id)).toContain(id);
  });

  it('raises P0002 for a code that matches no circle', async () => {
    const { client } = await signInAnonymously();
    const { error } = await client.rpc('join_circle_by_code', { code: 'not-a-real-code' });

    expect(error?.code).toBe('P0002');
  });

  it('says nothing that would distinguish a bad code from an already-joined one', async () => {
    const { client } = await signInAnonymously();
    const { error } = await client.rpc('join_circle_by_code', { code: 'basement-9x3' });

    // A near-miss on a real code must not be confirmable. The message names
    // neither the circle nor the submitted code, and does not mention
    // membership — otherwise codes could be enumerated one character at a time.
    expect(error?.message).toBe('invalid invite code');
    expect(error?.message).not.toMatch(/basement|member|exists|already/i);
  });

  it('is idempotent — calling it twice joins once and returns the same uuid', async () => {
    const { client, id } = await signInAnonymously();
    const first = await client.rpc('join_circle_by_code', { code: 'basement-9x2' });
    const second = await client.rpc('join_circle_by_code', { code: 'basement-9x2' });

    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);

    const { data } = await asService()
      .from('circle_members')
      .select('profile_id')
      .eq('circle_id', CIRCLE_IDS.basement)
      .eq('profile_id', id);
    expect(data).toHaveLength(1);
  });

  it('lets an existing member re-run it without disturbing their membership', async () => {
    const { error } = await asUser('dre').rpc('join_circle_by_code', { code: 'basement-9x2' });

    expect(error).toBeNull();

    const { data } = await asService()
      .from('circle_members')
      .select('joined_at')
      .eq('circle_id', CIRCLE_IDS.basement)
      .eq('profile_id', idOf('dre'));
    expect(data).toHaveLength(1);
  });

  it('refuses a client with no JWT at all', async () => {
    const { error } = await asAnon().rpc('join_circle_by_code', { code: 'basement-9x2' });

    // EXECUTE is revoked from `anon`, so this is refused at the grant, before
    // the function's own `auth.uid() is null` guard is ever reached.
    expect(error?.code).toBe('42501');
  });

  it('does not join anybody when it refuses', async () => {
    await asAnon().rpc('join_circle_by_code', { code: 'basement-9x2' });

    const { data } = await asService()
      .from('circle_members')
      .select('profile_id')
      .eq('circle_id', CIRCLE_IDS.basement);
    expect(data).toHaveLength(3);
  });
});

describe('FINDING: an invite code is not required to join a circle', () => {
  it('lets anyone who learns a circle_id add themselves to it directly', async () => {
    // This is a genuine hole, recorded here as behaviour rather than papered
    // over. circle_members_insert checks only `profile_id = auth.uid()` — that
    // you are adding yourself and not someone else. It never checks that you
    // hold an invite, so join_circle_by_code is a convenience, not a gate: a
    // circle_id leaked in a screenshot, a URL or a shared device is as good as
    // the invite code. Closing it means requiring an accepted `invites` row (or
    // routing all joins through the SECURITY DEFINER function and revoking
    // INSERT on circle_members) — a product decision, not a test bug.
    const { error } = await asUser('sofia')
      .from('circle_members')
      .insert({ circle_id: CIRCLE_IDS.basement, profile_id: idOf('sofia') });

    expect(error).toBeNull();

    const { data } = await asUser('sofia')
      .from('circles')
      .select('name,invite_code')
      .eq('id', CIRCLE_IDS.basement);
    expect(data?.[0]?.name).toBe('The Basement');
    // And the invite code she never had is now readable to her.
    expect(data?.[0]?.invite_code).toBe('basement-9x2');
  });

  it('exposes the full roster of a circle she was never invited to', async () => {
    await asUser('sofia')
      .from('circle_members')
      .insert({ circle_id: CIRCLE_IDS.basement, profile_id: idOf('sofia') });

    const { data } = await asUser('sofia')
      .from('circle_members')
      .select('profile_id')
      .eq('circle_id', CIRCLE_IDS.basement);

    expect(data).toHaveLength(4);
  });

  it('but still cannot bring a friend along', async () => {
    await asUser('sofia')
      .from('circle_members')
      .insert({ circle_id: CIRCLE_IDS.basement, profile_id: idOf('sofia') });

    const { error } = await asUser('sofia')
      .from('circle_members')
      .insert({ circle_id: CIRCLE_IDS.basement, profile_id: idOf('jordan') });

    expect(error?.code).toBe('42501');
  });
});
