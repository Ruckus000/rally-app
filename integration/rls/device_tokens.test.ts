/**
 * Push tokens: the one table in this schema nobody may read.
 *
 * A row here says which phone a person is holding and when they last opened the
 * app. `device_tokens` is granted to nobody but `service_role`, and the two
 * writes a client needs are functions — so the assertions that matter are all
 * negative, and the sharpest of them is not "a stranger cannot read yours" but
 * "you cannot read your own". A select policy added later for convenience is
 * one line, and it is the line that turns a bad query into an enumeration of
 * every device on the service.
 *
 * The functions still have to work without that read, which is the other half
 * of what this file pins.
 */
import { asAnon, asService, asUser, idOf, signInAnonymously } from '../support/clients';
import { sql } from '../support/reset';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type SeedHandle } from '../fixtures/world';

const token = (name: string) => `ExponentPushToken[${name}]`;

const register = (who: SupabaseClient, p_token: string, p_platform = 'ios') =>
  who.rpc('register_device', { p_token, p_platform });

const unregister = (who: SupabaseClient, p_token: string) =>
  who.rpc('unregister_device', { p_token });

/** Written as the job would see the table — service_role is the only reader. */
async function seedToken(owner: SeedHandle, value: string, platform = 'ios') {
  const { error } = await asService()
    .from('device_tokens')
    .upsert({ token: value, profile_id: idOf(owner), platform }, { onConflict: 'token' });
  expect(error).toBeNull();
}

async function readAsService(value: string) {
  const { data } = await asService()
    .from('device_tokens')
    .select('profile_id, platform')
    .eq('token', value)
    .maybeSingle();
  return data as { profile_id: string; platform: string } | null;
}

afterEach(async () => {
  await asService().from('device_tokens').delete().like('token', 'ExponentPushToken[%');
});

describe('registering this device', () => {
  it('files the token against whoever is signed in', async () => {
    const value = token('mine');
    const { error } = await register(asUser('maya'), value);

    expect(error).toBeNull();
    expect(await readAsService(value)).toEqual({ profile_id: idOf('maya'), platform: 'ios' });
  });

  it('takes no owner argument, so there is no owner to forge', async () => {
    // The whole feature, inverted: a row written against dre's profile sends
    // dre's cheers to maya's phone. The function reads `auth.uid()` and the
    // client cannot say otherwise — this is why it is not a table write.
    const value = token('cannot.forge');
    await register(asUser('maya'), value);

    expect((await readAsService(value))?.profile_id).toBe(idOf('maya'));
    expect((await readAsService(value))?.profile_id).not.toBe(idOf('dre'));
  });

  it('is idempotent, because a permission prompt can be answered twice', async () => {
    const value = token('twice');
    await register(asUser('maya'), value);
    const { error } = await register(asUser('maya'), value);

    expect(error).toBeNull();
    expect((await readAsService(value))?.profile_id).toBe(idOf('maya'));
  });

  it('refuses a signed-out caller', async () => {
    const { error } = await register(asAnon(), token('anon'));
    expect(error).not.toBeNull();
  });

  it('and anon holds no EXECUTE on either function', async () => {
    // Asserted at the grant rather than through a request, as the circle
    // tables are, so it cannot be satisfied by a function body that merely
    // happens to refuse today. Both controls are real — the body checks
    // `auth.uid()` too — but this is the one that decides whether an
    // unauthenticated request reaches SECURITY DEFINER code at all, and the
    // behavioural test above passes with or without it.
    const rows = await sql<{ fn: string; role: string; can: boolean }>(`
      select p.proname as fn, r.rolname as role,
             has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join (select rolname from pg_roles where rolname = 'anon') r
      where n.nspname = 'public'
        and p.proname in ('register_device', 'unregister_device')`);

    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.can).toBe(false);
  });

  it('rejects something that is not a token', async () => {
    const { error } = await register(asUser('maya'), 'x');
    expect(error?.code).toBe('23514');
  });

  it('rejects a platform this app does not build for', async () => {
    const { error } = await register(asUser('maya'), token('web'), 'web');
    expect(error?.code).toBe('23514');
  });
});

describe('a phone that changes hands', () => {
  it('moves the row rather than adding a second', async () => {
    // The reason `token` is the primary key. Two rows would mean the previous
    // owner's next cheer rings on a phone they no longer have.
    const value = token('handed.over');
    await register(asUser('maya'), value);

    const { error } = await register(asUser('dre'), value);

    expect(error).toBeNull();
    expect((await readAsService(value))?.profile_id).toBe(idOf('dre'));

    const { count } = await asService()
      .from('device_tokens')
      .select('token', { count: 'exact', head: true })
      .eq('token', value);
    expect(count).toBe(1);
  });
});

describe('signing out', () => {
  it('deletes this device’s row', async () => {
    const value = token('leaving');
    await register(asUser('maya'), value);

    const { error } = await unregister(asUser('maya'), value);

    expect(error).toBeNull();
    expect(await readAsService(value)).toBeNull();
  });

  it('cannot delete somebody else’s', async () => {
    // Knowing a token is not permission to silence the phone it belongs to.
    // Their cheers would simply stop arriving, and nothing would say why.
    const value = token('not.yours');
    await seedToken('dre', value);

    const { error } = await unregister(asUser('maya'), value);

    expect(error).toBeNull(); // deletes nothing rather than failing
    expect(await readAsService(value)).not.toBeNull();
  });

  it('is quiet about a token that was already gone', async () => {
    // Sign-out runs it unconditionally, and a second sign-out is not a fault.
    const { error } = await unregister(asUser('maya'), token('never.existed'));
    expect(error).toBeNull();
  });

  it('takes the rows with the account', async () => {
    // `on delete cascade`. Tokens outliving the account they belonged to are a
    // push addressed to someone who asked to be forgotten.
    const value = token('deleted.account');
    const { data } = await asService().auth.admin.createUser({
      email: 'ghost@rally.test',
      password: 'rally-test-password',
      email_confirm: true,
    });
    const ghost = data.user!.id;
    await asService()
      .from('device_tokens')
      .insert({ token: value, profile_id: ghost, platform: 'ios' });

    await asService().auth.admin.deleteUser(ghost);

    expect(await readAsService(value)).toBeNull();
  });
});

describe('nobody reads this table', () => {
  it('not a stranger', async () => {
    await seedToken('maya', token('private.to.maya'));
    const { data } = await asUser('jordan').from('device_tokens').select('*');
    expect(data ?? []).toEqual([]);
  });

  it('not someone who shares your circle', async () => {
    // Sharing a circle is what makes a profile, a task and a name readable.
    // It does not make the list of somebody's phones readable.
    await seedToken('maya', token('circle.mate'));
    const { data } = await asUser('dre').from('device_tokens').select('*');
    expect(data ?? []).toEqual([]);
  });

  it('not even you, on your own row', async () => {
    // The load-bearing one, and the reason the two writes above are functions:
    // an upsert and a filtered delete both need SELECT, so a client that wrote
    // the table directly would have to be granted the read this denies.
    const value = token('my.very.own');
    await register(asUser('maya'), value);

    const { data } = await asUser('maya').from('device_tokens').select('*');
    expect(data ?? []).toEqual([]);
  });

  it('nor writes it directly, in any of the three ways', async () => {
    // No grant at all, so these fail on privilege rather than on policy —
    // which is what keeps the functions the only door.
    const mine = { token: token('direct'), profile_id: idOf('maya'), platform: 'ios' };
    const maya = asUser('maya');

    expect((await maya.from('device_tokens').insert(mine)).error?.code).toBe('42501');
    expect((await maya.from('device_tokens').update({ platform: 'android' }).eq('token', mine.token))
      .error?.code).toBe('42501');
    expect((await maya.from('device_tokens').delete().eq('token', mine.token)).error?.code).toBe(
      '42501',
    );
  });

  it('not a brand-new anonymous account', async () => {
    await seedToken('maya', token('unseen'));
    const { client: stranger } = await signInAnonymously();
    const { data } = await stranger.from('device_tokens').select('*');
    expect(data ?? []).toEqual([]);
  });

  it('and the job still can, which is the only reason any of it works', async () => {
    // Mutation-check on the grant: drop `grant all … to service_role` and this
    // is the test that fails, where every other one in the file still passes.
    const value = token('deliverable');
    await register(asUser('maya'), value);

    expect((await readAsService(value))?.profile_id).toBe(idOf('maya'));
  });
});

describe('the delivery query', () => {
  it('answers every device one person is holding', async () => {
    await seedToken('maya', token('phone'), 'ios');
    await seedToken('maya', token('tablet'), 'ios');
    await seedToken('dre', token('dres.phone'), 'android');

    const { data } = await asService()
      .from('device_tokens')
      .select('token')
      .eq('profile_id', idOf('maya'));

    expect((data ?? []).map((r) => (r as { token: string }).token).sort()).toEqual([
      token('phone'),
      token('tablet'),
    ]);
  });
});
