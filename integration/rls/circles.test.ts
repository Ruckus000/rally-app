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
  it('is no longer a direct insert — the table is not client-writable', async () => {
    // Creation moved into create_circle() so that a circle can never exist
    // without its creator in it, and so the invite code is generated rather
    // than chosen. INSERT is revoked outright, which is why this is a grant
    // failure and not an RLS no-op.
    const { error } = await asUser('jordan')
      .from('circles')
      .insert({ name: 'Jordans Circle', invite_code: newCode(), created_by: idOf('jordan') });

    expect(error?.code).toBe('42501');
  });

  it('create_circle returns the new id and a generated code, and joins the creator', async () => {
    const { data, error } = await asUser('jordan').rpc('create_circle', {
      circle_name: 'Jordans Circle',
    });

    expect(error).toBeNull();
    const row = (data as { id: string; invite_code: string }[])[0];
    expect(row.id).toBeTruthy();

    // Creating is joining now: the old two-step left a window where a circle
    // existed with no members.
    const { data: roster } = await asUser('jordan')
      .from('circle_members')
      .select('profile_id')
      .eq('circle_id', row.id);
    expect(roster).toHaveLength(1);
    expect(roster?.[0]?.profile_id).toBe(idOf('jordan'));
  });

  it('generates a code with real entropy behind a readable slug', async () => {
    const { data } = await asUser('jordan').rpc('create_circle', { circle_name: 'The Basement' });
    const code = (data as { invite_code: string }[])[0].invite_code;

    // `the-basement-` + 16 hex chars. The slug carries no secrecy; the 64 bits
    // after it are what stop join_circle_by_code being a guessing oracle.
    expect(code).toMatch(/^the-basement-[0-9a-f]{16}$/);
  });

  it('gives two circles of the same name different codes', async () => {
    const a = await asUser('jordan').rpc('create_circle', { circle_name: 'Gym' });
    const b = await asUser('tomas').rpc('create_circle', { circle_name: 'Gym' });

    const codeA = (a.data as { invite_code: string }[])[0].invite_code;
    const codeB = (b.data as { invite_code: string }[])[0].invite_code;
    expect(codeA).not.toBe(codeB);
  });

  it('refuses a blank name', async () => {
    const { error } = await asUser('jordan').rpc('create_circle', { circle_name: '   ' });
    expect(error?.code).toBe('23514');
  });

  it('refuses a client with no JWT', async () => {
    const { error } = await asAnon().rpc('create_circle', { circle_name: 'Nope' });
    expect(error?.code).toBe('42501');
  });

  it('attributes the circle to the caller, with no say in the matter', async () => {
    const { data } = await asUser('tomas').rpc('create_circle', { circle_name: 'Tomas Circle' });
    const id = (data as { id: string }[])[0].id;

    const { data: row } = await asService().from('circles').select('created_by').eq('id', id);
    expect(row?.[0]?.created_by).toBe(idOf('tomas'));
  });
});

describe('an invite code cannot be resolved by selecting circles', () => {
  it('a member can read the code of their own circle, which is how it gets shared', async () => {
    const { data, error } = await asUser('maya')
      .from('circles')
      .select('invite_code')
      .eq('id', CIRCLE_IDS.basement);

    expect(error).toBeNull();
    expect(data?.[0]?.invite_code).toBe('the-basement-1111111111111111');
  });

  it('guessing a code you are not a member of returns nothing', async () => {
    // This is the whole reason join_circle_by_code exists: the person who needs
    // to resolve a code is by definition not yet a member, and widening
    // circles_select to let them would expose every circle to every user.
    const { data, error } = await asUser('jordan')
      .from('circles')
      .select('id,name')
      .eq('invite_code', 'the-basement-1111111111111111');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('is not a lookup oracle either — a real code and a bogus one look identical', async () => {
    const real = await asUser('jordan').from('circles').select('id').eq('invite_code', 'gym-2222222222222222');
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
    const { data, error } = await client.rpc('join_circle_by_code', { code: 'the-basement-1111111111111111' });

    expect(error).toBeNull();
    expect(data).toBe(CIRCLE_IDS.basement);
  });

  it('makes the circle itself visible afterwards', async () => {
    const { client } = await signInAnonymously();
    await client.rpc('join_circle_by_code', { code: 'the-basement-1111111111111111' });

    const { data, error } = await client.from('circles').select('name').eq('id', CIRCLE_IDS.basement);
    expect(error).toBeNull();
    expect(data?.[0]?.name).toBe('The Basement');
  });

  it('makes the roster visible afterwards, joiner included', async () => {
    const { client, id } = await signInAnonymously();
    await client.rpc('join_circle_by_code', { code: 'the-basement-1111111111111111' });

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
    const first = await client.rpc('join_circle_by_code', { code: 'the-basement-1111111111111111' });
    const second = await client.rpc('join_circle_by_code', { code: 'the-basement-1111111111111111' });

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
    const { error } = await asUser('dre').rpc('join_circle_by_code', { code: 'the-basement-1111111111111111' });

    expect(error).toBeNull();

    const { data } = await asService()
      .from('circle_members')
      .select('joined_at')
      .eq('circle_id', CIRCLE_IDS.basement)
      .eq('profile_id', idOf('dre'));
    expect(data).toHaveLength(1);
  });

  it('refuses a client with no JWT at all', async () => {
    const { error } = await asAnon().rpc('join_circle_by_code', { code: 'the-basement-1111111111111111' });

    // EXECUTE is revoked from `anon`, so this is refused at the grant, before
    // the function's own `auth.uid() is null` guard is ever reached.
    expect(error?.code).toBe('42501');
  });

  it('does not join anybody when it refuses', async () => {
    await asAnon().rpc('join_circle_by_code', { code: 'the-basement-1111111111111111' });

    const { data } = await asService()
      .from('circle_members')
      .select('profile_id')
      .eq('circle_id', CIRCLE_IDS.basement);
    expect(data).toHaveLength(3);
  });
});

describe('an invite code IS now required to join a circle', () => {
  it('refuses someone who knows a circle_id but holds no code', async () => {
    // This was a genuine hole: circle_members_insert checked only that you
    // were adding yourself, never that you had been invited, so a circle_id
    // leaked in a screenshot or a URL was as good as the code. INSERT on the
    // table is now revoked and join_circle_by_code is the only way in.
    const { error } = await asUser('sofia')
      .from('circle_members')
      .insert({ circle_id: CIRCLE_IDS.basement, profile_id: idOf('sofia') });

    expect(error?.code).toBe('42501');
  });

  it('leaves the roster and the code out of reach', async () => {
    await asUser('sofia')
      .from('circle_members')
      .insert({ circle_id: CIRCLE_IDS.basement, profile_id: idOf('sofia') });

    const { data: roster } = await asUser('sofia')
      .from('circle_members')
      .select('profile_id')
      .eq('circle_id', CIRCLE_IDS.basement);
    expect(roster).toEqual([]);

    // The leak used to be self-propagating: join once and the invite_code was
    // yours to pass on.
    const { data: circle } = await asUser('sofia')
      .from('circles')
      .select('invite_code')
      .eq('id', CIRCLE_IDS.basement);
    expect(circle).toEqual([]);
  });

  it('still lets the code holder in', async () => {
    const { error } = await asUser('sofia').rpc('join_circle_by_code', { code: 'the-basement-1111111111111111' });
    expect(error).toBeNull();

    const { data } = await asUser('sofia')
      .from('circle_members')
      .select('profile_id')
      .eq('circle_id', CIRCLE_IDS.basement);
    expect(data).toHaveLength(4);
  });

  it('still lets a member leave under their own steam', async () => {
    // Revoking INSERT must not trap anyone: DELETE is untouched.
    const { data } = await asUser('nana')
      .from('circle_members')
      .delete()
      .eq('circle_id', CIRCLE_IDS.basement)
      .eq('profile_id', idOf('nana'))
      .select();

    expect(data).toHaveLength(1);
  });
});

describe('the invariants, not just the error codes', () => {
  it('no circle anywhere carries a weak invite code', async () => {
    // The entropy test above only inspects codes it just minted. This is the
    // one that would have caught the seeded circles being grandfathered in.
    const rows = await sql<{ invite_code: string }>('select invite_code from public.circles');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.invite_code).toMatch(/-[0-9a-f]{16}$/);
  });

  it('authenticated holds no INSERT on either circle table', async () => {
    // Asserted at the grant rather than through a request, so it cannot be
    // satisfied by an RLS policy that merely happens to refuse today.
    const rows = await sql<{ t: string; ins: boolean }>(`
      select c.relname as t, has_table_privilege('authenticated', c.oid, 'INSERT') as ins
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('circles','circle_members')`);
    for (const r of rows) expect(r.ins).toBe(false);
  });

  it('neither anon nor authenticated can TRUNCATE, which would ignore RLS', async () => {
    const rows = await sql<{ t: string; role: string; trunc: boolean }>(`
      select c.relname as t, r.rolname as role,
             has_table_privilege(r.rolname, c.oid, 'TRUNCATE') as trunc
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join (select rolname from pg_roles where rolname in ('anon','authenticated')) r
      where n.nspname = 'public' and c.relkind = 'r'`);
    // 14 tables × 2 roles. The count is pinned so that adding a table without
    // thinking about its grants fails here rather than shipping — which is what
    // it did for `goal_ratings` and `llm_usage`, and again for `device_tokens`,
    // which arrived holding TRUNCATE that nobody had granted it (see below).
    expect(rows.length).toBe(28);
    for (const r of rows) expect(r.trunc).toBe(false);
  });

  it('and a table added tomorrow will not arrive holding it either', async () => {
    // The defect the row above only ever catches one table at a time.
    //
    // Supabase ships a default privilege granting `Dxtm` — TRUNCATE among them
    // — to anon and authenticated on every table created in `public`. TRUNCATE
    // ignores row security completely, so this is a privilege no policy can
    // mitigate, handed out to two roles a client can act as, on every table
    // anyone adds. `repair_write_paths` revoked it from the ten tables that
    // existed that day; `device_tokens` was the first added since and arrived
    // with it, which is how this was found.
    //
    // Asserted against the default itself rather than against today's tables,
    // because the per-table revoke is a fix for one table and this is the fix
    // for the class.
    // Scoped to `postgres`, which is the role migrations run as and therefore
    // the role that creates every table this repo owns. There is a second
    // default belonging to `supabase_admin` that grants anon and authenticated
    // everything; it is not ours to alter and it only fires for tables that
    // role creates, which is none of ours. Asserting on it would be asserting
    // on something no change here could ever satisfy.
    const rows = await sql<{ acl: string | null }>(`
      select array_to_string(defaclacl, ',') as acl
      from pg_default_acl
      where defaclnamespace = 'public'::regnamespace
        and defaclobjtype = 'r'
        and defaclrole = 'postgres'::regrole`);

    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.acl ?? '').not.toMatch(/\banon=/);
      expect(r.acl ?? '').not.toMatch(/\bauthenticated=/);
    }
  });

  it('refuses a circle name long enough to be a payload', async () => {
    const { error } = await asUser('jordan').rpc('create_circle', {
      circle_name: 'a'.repeat(200),
    });
    expect(error?.code).toBe('23514');
  });
});

/**
 * The read behind the invite sheet. Asserted here rather than only against the
 * fake because `circles_select` is membership-scoped, and "can I read the row
 * whose id I hold" is a question only real RLS answers.
 */
describe('reading your own circle', () => {
  const myCircle = async (handle: SeedHandle) => {
    const client = asUser(handle);
    const mine = await client
      .from('circle_members')
      .select('circle_id')
      .eq('profile_id', idOf(handle))
      .limit(1);
    const circleId = mine.data?.[0]?.circle_id;
    if (!circleId) return null;
    const row = await client.from('circles').select('id,name,invite_code').eq('id', circleId);
    return row.data?.[0] ?? null;
  };

  it('gives a member the code they need to invite someone', async () => {
    const circle = await myCircle('maya');

    expect(circle).not.toBeNull();
    expect(SEED_CIRCLE_IDS).toContain(circle?.id);
    // The entropy the schema insists on. A code without it is guessable against
    // an oracle with no rate limit, which is what the rotation was for.
    expect(circle?.invite_code).toMatch(/-[0-9a-f]{16}$/);
  });

  it('gives a different member a different circle — the control', () => {
    // Without this, a read that ignored the caller entirely would satisfy the
    // assertion above by always returning the same row.
    return Promise.all([myCircle('maya'), myCircle('jordan')]).then(([mine, theirs]) => {
      expect(theirs).not.toBeNull();
      expect(theirs?.id).not.toBe(mine?.id);
    });
  });

  it('refuses the row to someone holding its id but not its membership', async () => {
    // The id is not a capability: jordan shares no circle with maya, so even
    // naming her circle exactly answers with nothing.
    const { data } = await asUser('jordan')
      .from('circles')
      .select('id,invite_code')
      .eq('id', CIRCLE_IDS.basement);

    expect(data).toEqual([]);
  });
});
