/**
 * The pool the Global feed is drawn from, and who may touch it. Nobody signed in.
 *
 * `bot_goal_candidates` holds goals a model wrote for the four Oz bots, waiting
 * for a person to approve them. It is not app data: no client reads it, no
 * client writes it, and the three authoring scripts reach it with the service
 * role. A signed-in account that could write this table would be choosing what
 * every new account sees on the first screen it lands on.
 *
 * Protected by *absence*: RLS enabled, no policy written, grants revoked. That
 * is easy to mistake for an unfinished migration, so these tests state that it
 * was the intent — and fail loudly if somebody later "fixes" it with a policy.
 *
 * The second half pins the draw. `approved_at is not null` is the gate between
 * a model's output and the feed, and `last_staked asc nulls first` is the whole
 * of the least-recently-used rule that stops the cast repeating itself.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { asAnon, asService, asUser, signInAnonymously } from '../support/clients';
import { sql } from '../support/reset';

const CANDIDATE = {
  handle: 'dorothy.gale',
  title: 'Walk 30 minutes every morning',
  category: 'Fitness',
  points: 35,
};

async function seedCandidate(over: Partial<typeof CANDIDATE> & Record<string, unknown> = {}) {
  const { data, error } = await asService()
    .from('bot_goal_candidates')
    .insert({ ...CANDIDATE, ...over })
    .select('id')
    .single();
  expect(error).toBeNull();
  return (data as { id: string }).id;
}

describe('nobody signed in reads the pool', () => {
  it('refuses an ordinary account', async () => {
    await seedCandidate();
    const { data, error } = await asUser('jordan').from('bot_goal_candidates').select('*');
    // A grant failure, not an empty result: the row is there, and the answer is
    // still nothing. An empty array would mean a policy filtered it, which is a
    // weaker guarantee than never having been allowed to look.
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('refuses a brand-new anonymous account', async () => {
    await seedCandidate();
    const { client } = await signInAnonymously();
    const { error } = await client.from('bot_goal_candidates').select('*');
    expect(error).not.toBeNull();
  });

  it('refuses anon', async () => {
    const { error } = await asAnon().from('bot_goal_candidates').select('*');
    expect(error).not.toBeNull();
  });
});

describe('nor writes it, in any of the three ways', () => {
  it('refuses an insert, which would be writing the Global feed', async () => {
    const { error } = await asUser('jordan').from('bot_goal_candidates').insert(CANDIDATE);
    expect(error?.code).toBe('42501');
  });

  it('refuses an update, which would be approving your own goal', async () => {
    const id = await seedCandidate();
    const { error } = await asUser('jordan')
      .from('bot_goal_candidates')
      .update({ approved_at: new Date().toISOString() })
      .eq('id', id);
    expect(error?.code).toBe('42501');
  });

  it('refuses a delete', async () => {
    const id = await seedCandidate();
    const { error } = await asUser('jordan').from('bot_goal_candidates').delete().eq('id', id);
    expect(error?.code).toBe('42501');
  });
});

describe('the protection is the absence of a policy, deliberately', () => {
  it('has RLS on and no policies', async () => {
    const rows = await sql<{ rls: boolean; policies: number }>(`
      select c.relrowsecurity as rls,
             (select count(*) from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'bot_goal_candidates'`);

    expect(rows).toHaveLength(1);
    expect(rows[0].rls).toBe(true);
    // If this fails, someone has written a policy — which means they intend a
    // signed-in account to reach this table. Read the header before deciding
    // that is right.
    expect(Number(rows[0].policies)).toBe(0);
  });

  it('holds no grant of any kind for anon or authenticated', async () => {
    // Asserted at the grant rather than through a request, so it cannot be
    // satisfied by a policy that merely happens to refuse today.
    const rows = await sql<{ n: number }>(`
      select count(*)::int as n from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = 'bot_goal_candidates'
        and grantee in ('anon','authenticated')`);
    expect(rows[0].n).toBe(0);
  });

  it('and the scripts still can, which is the only reason any of it works', async () => {
    // Mutation-check on the grant: drop `grant all … to service_role` and this
    // is the test that fails, where every other one in the file still passes.
    const id = await seedCandidate();
    const { data, error } = await asService()
      .from('bot_goal_candidates')
      .select('points')
      .eq('id', id)
      .single();
    expect(error).toBeNull();
    expect((data as { points: number }).points).toBe(35);
  });
});

describe('the shape a candidate has to have, which `tasks` never enforced', () => {
  it('refuses a title longer than a feed card', async () => {
    const { error } = await asService()
      .from('bot_goal_candidates')
      .insert({ ...CANDIDATE, title: 'x'.repeat(51) });
    expect(error?.code).toBe('23514');
  });

  it('refuses a title that is only whitespace', async () => {
    const { error } = await asService()
      .from('bot_goal_candidates')
      .insert({ ...CANDIDATE, title: ' \t\n ' });
    expect(error?.code).toBe('23514');
  });

  it('refuses a category the composer does not offer', async () => {
    // Unchecked, this reaches the client, which silently relabels it `Quick log`
    // and prices it at a number that is not in the price table.
    const { error } = await asService()
      .from('bot_goal_candidates')
      .insert({ ...CANDIDATE, category: 'Errands' });
    expect(error?.code).toBe('23514');
  });

  it('refuses points outside the band', async () => {
    const { error } = await asService()
      .from('bot_goal_candidates')
      .insert({ ...CANDIDATE, points: 95 });
    expect(error?.code).toBe('23514');
  });

  it('refuses the same goal twice for one bot, so review is not done twice', async () => {
    await seedCandidate();
    const { error } = await asService().from('bot_goal_candidates').insert(CANDIDATE);
    expect(error?.code).toBe('23505');
  });

  it('but lets two bots hold the same goal, because two people can', async () => {
    await seedCandidate();
    const { error } = await asService()
      .from('bot_goal_candidates')
      .insert({ ...CANDIDATE, handle: 'tin.man' });
    expect(error).toBeNull();
  });
});

/**
 * The draw, asserted against the real table.
 *
 * These run the same query `seed-bots.mjs` runs. The last test in the block
 * pins the script to it, because a behavioural test of a copied query proves
 * the database orders as expected without proving the seeder asks it to.
 */
describe('the draw', () => {
  const draw = (handle: string, limit: number) =>
    asService()
      .from('bot_goal_candidates')
      .select('title')
      .eq('handle', handle)
      .not('approved_at', 'is', null)
      .order('last_staked', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: true })
      .limit(limit);

  it('never returns a candidate nobody has approved', async () => {
    // The gate. Without this filter a model writes straight to the first screen
    // a new account sees.
    await seedCandidate({ title: 'Pending, never approved' });
    await seedCandidate({ title: 'Approved', approved_at: new Date().toISOString() });

    const { data, error } = await draw('dorothy.gale', 10);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => (r as { title: string }).title)).toEqual(['Approved']);
  });

  it('prefers a goal that has never been staked', async () => {
    await seedCandidate({
      title: 'Staked last week',
      approved_at: new Date().toISOString(),
      last_staked: '2026-08-03',
    });
    await seedCandidate({ title: 'Never staked', approved_at: new Date().toISOString() });

    const { data } = await draw('dorothy.gale', 1);
    expect((data ?? []).map((r) => (r as { title: string }).title)).toEqual(['Never staked']);
  });

  it('then the one that ran longest ago', async () => {
    await seedCandidate({
      title: 'Staked recently',
      approved_at: new Date().toISOString(),
      last_staked: '2026-08-10',
    });
    await seedCandidate({
      title: 'Staked long ago',
      approved_at: new Date().toISOString(),
      last_staked: '2026-07-06',
    });

    const { data } = await draw('dorothy.gale', 2);
    expect((data ?? []).map((r) => (r as { title: string }).title)).toEqual([
      'Staked long ago',
      'Staked recently',
    ]);
  });

  it('and only that bot’s goals', async () => {
    await seedCandidate({ approved_at: new Date().toISOString() });
    await seedCandidate({ handle: 'tin.man', approved_at: new Date().toISOString() });

    const { data } = await draw('tin.man', 10);
    expect(data ?? []).toHaveLength(1);
  });

  it('and the seeder asks for exactly that order', async () => {
    // The idiom `src/lib/__tests__/points.test.ts` uses for a file no test can
    // import: read it and check the claim. Drop `nullsFirst` or the approval
    // filter from the script and the tests above would all still pass.
    const seeder = readFileSync(join(__dirname, '../../scripts/seed-bots.mjs'), 'utf8');
    expect(seeder).toMatch(/\.not\('approved_at',\s*'is',\s*null\)/);
    expect(seeder).toMatch(/\.order\('last_staked',\s*\{[^}]*nullsFirst:\s*true/);
    expect(seeder).toMatch(/\.order\('created_at',\s*\{[^}]*ascending:\s*true/);
  });
});
