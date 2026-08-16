/**
 * The two tables behind goal rating, and who may touch them. Nobody signed in.
 *
 * `goal_ratings` is a list of what every person on this service has typed into
 * the composer, including the drafts they thought better of. `llm_usage` is how
 * many times each account has asked. Neither is app data — the client never
 * reads either one, the edge function reaches them with the service role, and a
 * signed-in account has no business with either.
 *
 * Both tables are protected by *absence*: RLS enabled, no policy written, and
 * the grants revoked. That is easy to mistake for an unfinished migration, so
 * these tests exist to state that it was the intent — and to fail loudly if
 * somebody later "fixes" it by adding a policy.
 */
import { asAnon, asService, asUser, signInAnonymously } from '../support/clients';
import { sql } from '../support/reset';

const HASH = 'e3b0c44298fc1c149afbf4c8996fb924';

async function seedRating() {
  const { error } = await asService().from('goal_ratings').upsert({
    title_hash: HASH,
    title: 'Walk 30 minutes every morning',
    category: 'Fitness',
    points: 30,
    verdict: 'ok',
    reason: '',
  });
  expect(error).toBeNull();
}

describe('the rating cache is not readable by anyone signed in', () => {
  it('refuses an ordinary account', async () => {
    await seedRating();
    const { data, error } = await asUser('jordan').from('goal_ratings').select('*');
    // A grant failure, not an empty result: the row is there, and the answer is
    // still nothing. An empty array would mean a policy filtered it, which is a
    // weaker guarantee than never having been allowed to look.
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('refuses a brand-new anonymous account', async () => {
    const { client } = await signInAnonymously();
    const { error } = await client.from('goal_ratings').select('*');
    expect(error).not.toBeNull();
  });

  it('refuses anon', async () => {
    const { error } = await asAnon().from('goal_ratings').select('*');
    expect(error).not.toBeNull();
  });

  it('lets the service role through, or the function could not cache at all', async () => {
    await seedRating();
    const { data, error } = await asService()
      .from('goal_ratings')
      .select('points')
      .eq('title_hash', HASH)
      .single();
    expect(error).toBeNull();
    expect((data as { points: number }).points).toBe(30);
  });
});

describe('the usage counter is not readable or writable by anyone signed in', () => {
  it('refuses a select', async () => {
    const { error } = await asUser('jordan').from('llm_usage').select('*');
    expect(error).not.toBeNull();
  });

  it('refuses an insert, which would be granting yourself a quota', async () => {
    const { error } = await asUser('jordan')
      .from('llm_usage')
      .insert({ user_id: '00000000-0000-4000-8000-000000000001', day: '2026-08-15', count: 0 });
    expect(error).not.toBeNull();
  });

  it('refuses the bump function, which would let you spend someone else’s day', async () => {
    // Postgres grants EXECUTE to PUBLIC on every new function, so a
    // SECURITY DEFINER function in `public` is an open endpoint until revoked.
    // Reachable, this would let any account exhaust another's daily cap.
    const { error } = await asUser('jordan').rpc('bump_llm_usage', {
      u: '00000000-0000-4000-8000-000000000001',
      d: '2026-08-15',
    });
    expect(error).not.toBeNull();
  });
});

describe('the protection is the absence of a policy, deliberately', () => {
  it('has RLS on and no policies on either table', async () => {
    const rows = await sql<{ t: string; rls: boolean; policies: number }>(`
      select c.relname as t, c.relrowsecurity as rls,
             (select count(*) from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('goal_ratings','llm_usage')`);

    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.rls).toBe(true);
      // If this ever fails, someone has written a policy — which means they
      // intend a signed-in account to read one of these. Read the header above
      // before deciding that is right.
      expect(Number(r.policies)).toBe(0);
    }
  });

  it('holds no grant of any kind for anon or authenticated', async () => {
    // Asserted at the grant rather than through a request, so it cannot be
    // satisfied by a policy that merely happens to refuse today.
    const rows = await sql<{ n: number }>(`
      select count(*)::int as n from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name in ('goal_ratings','llm_usage')
        and grantee in ('anon','authenticated')`);
    expect(rows[0].n).toBe(0);
  });
});
