/**
 * The only bearer credential in this schema, and who may touch it. Nobody.
 *
 * `apple_credentials` holds Apple refresh tokens, put there by `link-apple` and
 * spent by `delete-account` for exactly one call — the revocation Apple's
 * account-deletion guidance asks for. It is not app data. The client never reads
 * it, cannot write it, and has no business with it: a refresh token is a bearer
 * credential for somebody's relationship with this app, and the account it
 * belongs to has no more reason to hold one than a stranger does.
 *
 * Protected by *absence*, the posture `goal_ratings` and `llm_usage` already
 * use: RLS enabled, no policy written, grants revoked. That is easy to mistake
 * for an unfinished migration, so these tests exist to say it was the intent —
 * and to fail loudly if somebody later "fixes" it by adding a policy.
 *
 * The cascade is asserted too, and it is not decoration. A token outliving the
 * account it belonged to is the precise thing this table exists to prevent, and
 * `delete-account` reads the row *before* it deletes the user for exactly that
 * reason — afterwards there is nothing left to revoke with.
 */
import { asAnon, asService, asUser, idOf, signInAnonymously } from '../support/clients';
import { sql } from '../support/reset';

const TOKEN = 'apple-refresh-token-for-tests';
const CLIENT = 'app.rally.weekspine';

async function seedCredential(profileId: string) {
  const { error } = await asService()
    .from('apple_credentials')
    .upsert({ profile_id: profileId, refresh_token: TOKEN, client_id: CLIENT });
  expect(error).toBeNull();
}

afterEach(async () => {
  await sql('delete from public.apple_credentials');
});

describe('nobody signed in can read a refresh token', () => {
  it('refuses the account it belongs to, which is the point', async () => {
    // Not "refuses other people" — refuses *you*, about *your own* row. There is
    // no version of this app that needs a client to hold this, and the moment
    // one can, the token is on a phone.
    await seedCredential(idOf('maya'));

    const { data, error } = await asUser('maya').from('apple_credentials').select('*');

    // A grant failure, not an empty result. An empty array would mean a policy
    // filtered it, which is a weaker guarantee than never having been allowed
    // to look at all.
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('refuses somebody else', async () => {
    await seedCredential(idOf('maya'));
    const { error } = await asUser('dre').from('apple_credentials').select('*');
    expect(error).not.toBeNull();
  });

  it('refuses a brand-new anonymous account', async () => {
    const { client } = await signInAnonymously();
    const { error } = await client.from('apple_credentials').select('*');
    expect(error).not.toBeNull();
  });

  it('refuses anon', async () => {
    const { error } = await asAnon().from('apple_credentials').select('*');
    expect(error).not.toBeNull();
  });

  it('refuses a write, which would be filing a credential against somebody', async () => {
    // The write side matters as much as the read. A row here decides whose
    // Apple tokens get revoked, so an account able to insert one could point a
    // revocation at another person's Apple identity.
    const { error } = await asUser('dre')
      .from('apple_credentials')
      .insert({ profile_id: idOf('maya'), refresh_token: 'mine-now', client_id: CLIENT });
    expect(error).not.toBeNull();
  });

  it('lets the service role through, or neither function could work', async () => {
    await seedCredential(idOf('maya'));

    const { data, error } = await asService()
      .from('apple_credentials')
      .select('refresh_token, client_id')
      .eq('profile_id', idOf('maya'))
      .single();

    expect(error).toBeNull();
    expect(data).toEqual({ refresh_token: TOKEN, client_id: CLIENT });
  });
});

describe('the protection is the absence of a policy, deliberately', () => {
  it('has RLS on and no policies', async () => {
    const rows = await sql<{ rls: boolean; policies: number }>(`
      select c.relrowsecurity as rls,
             (select count(*) from pg_policies p
               where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'apple_credentials'`);

    expect(rows).toHaveLength(1);
    expect(rows[0].rls).toBe(true);
    // If this fails, somebody has written a policy — which means they intend a
    // signed-in account to reach this table. Read the header first.
    expect(Number(rows[0].policies)).toBe(0);
  });

  it('holds no grant of any kind for anon or authenticated', async () => {
    // Asserted at the grant rather than through a request, so it cannot be
    // satisfied by a policy that merely happens to refuse today.
    const rows = await sql<{ n: number }>(`
      select count(*)::int as n from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = 'apple_credentials'
        and grantee in ('anon','authenticated')`);
    expect(rows[0].n).toBe(0);
  });
});

describe('the token does not outlive the account', () => {
  it('goes when the account does', async () => {
    // The whole reason the column is a foreign key. `delete-account` reads this
    // row *before* it deletes the user, because a moment later there is nothing
    // left to revoke with — and if the cascade ever stopped working, the token
    // would sit here forever instead.
    const { data } = await asService().auth.admin.createUser({
      email: 'apple.cascade@rally.test',
      password: 'rally-test-password',
      email_confirm: true,
    });
    const ghost = data.user!.id;
    await seedCredential(ghost);

    await asService().auth.admin.deleteUser(ghost);

    const left = await sql<{ n: string }>(
      'select count(*) as n from public.apple_credentials where profile_id = $1',
      [ghost],
    );
    expect(Number(left[0].n)).toBe(0);
  });
});
