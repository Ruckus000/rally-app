/**
 * Avatars: whose folder it is, and who may say an image is safe.
 *
 * `20260819194501_avatars.sql` spends most of its comments arguing that the
 * screening gate is real rather than decorative, and every one of those claims
 * is enforced by something the unit suite cannot see. The Supabase fake has no
 * row security, no column privileges, no storage schema and no roles, so a
 * test named "a client cannot write avatar_state" passes there whether or not
 * the grant exists. All of it therefore lives here, against real Postgres.
 *
 * Two halves, and they fail differently on purpose:
 *
 *   1. **The folder.** Storage policies compare `(storage.foldername(name))[1]`
 *      to `auth.uid()::text` — text against text, deliberately not a uuid cast.
 *      The migration explains why at length: an object name is client-chosen,
 *      and a cast would turn a junk name into a 22P02 raised *inside the
 *      policy*, which breaks the policy for whoever evaluates it next rather
 *      than failing one upload. So the malformed case is asserted to be an RLS
 *      refusal specifically, not merely "an error" — an assertion that would
 *      still pass if the policy had been written the dangerous way.
 *
 *   2. **The gate.** `authenticated` holds `update (name)` on `profiles` and
 *      nothing more, so the two new columns arrive unwritable by inheritance.
 *      That refusal is asserted on the SQLSTATE and on the row afterwards, not
 *      on the message: Postgres's wording for a column-privilege miss is the
 *      generic *permission denied for table profiles*, and its HINT suggests
 *      granting UPDATE on the whole table — the exact change that would open
 *      the hole. A test that matched the string would keep passing if someone
 *      took the hint and the failure moved to a policy instead.
 *
 * Deletes go through the Storage API rather than SQL, and that is not a style
 * choice. Supabase installs `storage.protect_delete()` as a trigger on
 * `storage.objects`, which intercepts a direct `delete from storage.objects`
 * before RLS is consulted — so a SQL-level delete test would be asserting
 * against the trigger and would pass with the delete policy dropped entirely.
 * `supabase.storage.from('avatars').remove([...])` is the path a client
 * actually has, and it is the one exercised below.
 *
 * Neither `profiles` nor `storage.objects` is in `resetDomainTables`' truncate
 * list, so this file cleans up after itself: avatar columns back to their
 * defaults over a direct connection, and every object in the bucket removed as
 * service_role through the API.
 */
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { asAnon, asService, asUser, idOf } from '../support/clients';
import { asRole, sql } from '../support/reset';
import type { SeedHandle } from '../fixtures/world';

const BUCKET = 'avatars';

/** A handful of bytes with a jpeg content type. The screener is not here. */
const image = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01])], {
  type: 'image/jpeg',
});

/** `<owner>/<client-minted id>.jpg`, the shape the policies are written for. */
const pathFor = (who: SeedHandle) => `${idOf(who)}/${randomUUID()}.jpg`;

const upload = (who: SupabaseClient, path: string) =>
  who.storage.from(BUCKET).upload(path, image(), { contentType: 'image/jpeg', upsert: false });

/** Setup only — service_role bypasses RLS, so nothing put here is a subject. */
async function seedObject(path: string): Promise<void> {
  const { error } = await upload(asService(), path);
  expect(error).toBeNull();
}

async function objectExists(path: string): Promise<boolean> {
  const rows = await sql<{ n: number }>(
    `select count(*)::int as n from storage.objects where bucket_id = $1 and name = $2`,
    [BUCKET, path],
  );
  return rows[0].n > 0;
}

async function avatarOf(who: SeedHandle) {
  const rows = await sql<{ avatar_path: string | null; avatar_state: string }>(
    `select avatar_path, avatar_state from public.profiles where id = $1`,
    [idOf(who)],
  );
  return rows[0];
}

/** Puts a profile in the one state a screening verdict is allowed to move. */
async function makePending(who: SeedHandle): Promise<string> {
  const path = pathFor(who);
  const { error } = await asUser(who).rpc('set_avatar', { p_path: path });
  expect(error).toBeNull();
  expect(await avatarOf(who)).toEqual({ avatar_path: path, avatar_state: 'pending' });
  return path;
}

/** The SQLSTATE behind a rejected statement, without asserting on wording. */
async function sqlstateOf(text: string, values?: unknown[]): Promise<string | undefined> {
  try {
    await sql(text, values);
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

afterEach(async () => {
  await sql(`update public.profiles set avatar_path = null, avatar_state = 'none'`);
  const names = await sql<{ name: string }>(
    `select name from storage.objects where bucket_id = $1`,
    [BUCKET],
  );
  if (names.length) {
    // Through the API for the same reason the delete test is: `protect_delete`
    // stands in front of a direct delete on this table.
    await asService()
      .storage.from(BUCKET)
      .remove(names.map((r) => r.name));
  }
});

// ─── the folder is yours ───────────────────────────────────────────────────

describe('uploading into a folder', () => {
  it('accepts an object under your own id', async () => {
    const path = pathFor('maya');

    const { error } = await upload(asUser('maya'), path);

    expect(error).toBeNull();
    expect(await objectExists(path)).toBe(true);
  });

  it('refuses an object under somebody else’s id', async () => {
    // The whole point of rooting the path at the owner. Without this, an
    // upload into dre's prefix is an image dre can be made to wear.
    const path = pathFor('dre');

    const { error } = await upload(asUser('maya'), path);

    expect(error).not.toBeNull();
    expect(await objectExists(path)).toBe(false);
  });

  it('treats a name that is not a uuid as a policy miss, not a raised cast', async () => {
    // The migration's reason for comparing text rather than casting to uuid.
    // A 22P02 raised inside a policy is not one bad upload failing — it is
    // that policy erroring for whoever evaluates it next. So the assertion is
    // on *how* this is refused: an authorization refusal, and specifically not
    // Postgres complaining about invalid input syntax for a uuid.
    const path = 'not-a-uuid/x.jpg';

    const { error } = await upload(asUser('maya'), path);

    expect(error).not.toBeNull();
    const message = String(error?.message ?? '');
    expect(message).not.toMatch(/invalid input syntax/i);
    expect(message).not.toMatch(/22P02/);
    expect((error as { statusCode?: string } | null)?.statusCode).toBe('403');
    expect(await objectExists(path)).toBe(false);
  });
});

describe('reading somebody’s avatar', () => {
  it('is open to any signed-in account, which is the product decision', async () => {
    // jordan shares no circle with maya. Avatars are deliberately not an
    // audience question — a face is what makes a name in a bell mean
    // something — so there is no visibility helper to call here.
    const path = pathFor('maya');
    await seedObject(path);

    const { data, error } = await asUser('jordan').storage.from(BUCKET).download(path);

    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });

  it('is closed to anon, because the bucket is private and the policy is to authenticated', async () => {
    const path = pathFor('maya');
    await seedObject(path);

    const { data, error } = await asAnon().storage.from(BUCKET).download(path);

    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });
});

describe('deleting an object, through the API a client actually has', () => {
  it('removes your own', async () => {
    const path = pathFor('maya');
    await seedObject(path);

    const { error } = await asUser('maya').storage.from(BUCKET).remove([path]);

    expect(error).toBeNull();
    expect(await objectExists(path)).toBe(false);
  });

  it('cannot remove somebody else’s', async () => {
    // Not assertable over SQL: `storage.protect_delete()` fires before RLS on
    // a direct `delete from storage.objects`, so that version of this test
    // would pass with `avatars_objects_delete` dropped. Through the API the
    // delete policy is the only thing standing here, and the object survives.
    const path = pathFor('dre');
    await seedObject(path);

    const { data } = await asUser('maya').storage.from(BUCKET).remove([path]);

    expect(data ?? []).toEqual([]); // deletes nothing rather than erroring
    expect(await objectExists(path)).toBe(true);
  });
});

// ─── the gate ──────────────────────────────────────────────────────────────

describe('the state column is not the client’s to write', () => {
  it('refuses a direct update of avatar_state', async () => {
    // The one that matters: if this passes, every paragraph the migration
    // spends on screening is decoration. Asserted on the SQLSTATE and on the
    // row, never on the message — 42501 here reads "permission denied for
    // table profiles" and HINTs at granting UPDATE on the whole table, which
    // is precisely the change that would reopen this.
    const maya = asUser('maya');

    const { error } = await maya.from('profiles').update({ avatar_state: 'ready' }).eq('id', idOf('maya'));

    expect(error?.code).toBe('42501');
    expect((await avatarOf('maya')).avatar_state).toBe('none');
  });

  it('refuses a direct update of avatar_path', async () => {
    // The tempting half. Widening the column grant to let the upload screen
    // record an object name hands over `avatar_state` with it, since a
    // column-list grant is edited as one line.
    const path = pathFor('maya');

    const { error } = await asUser('maya').from('profiles').update({ avatar_path: path }).eq('id', idOf('maya'));

    expect(error?.code).toBe('42501');
    expect((await avatarOf('maya')).avatar_path).toBeNull();
  });

  it('grants `authenticated` update on nothing but name', async () => {
    // Stated at the grant as well as through a request, so the property is
    // pinned where it lives rather than only where it is observed.
    const rows = await sql<{ column_name: string }>(`
      select column_name from information_schema.column_privileges
      where grantee = 'authenticated'
        and table_schema = 'public' and table_name = 'profiles'
        and privilege_type = 'UPDATE'
      order by column_name`);

    expect(rows.map((r) => r.column_name)).toEqual(['name']);
  });

  it('does not let `authenticated` execute mark_avatar_screened', async () => {
    // The only route into 'ready'. Postgres grants EXECUTE to PUBLIC on every
    // new function, so this revoke is the whole difference between a
    // service-role RPC and an open endpoint that publishes unscreened images.
    const [priv] = await sql<{ can: boolean }>(`
      select has_function_privilege('authenticated', p.oid, 'EXECUTE') as can
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'mark_avatar_screened'`);
    expect(priv.can).toBe(false);

    const { error } = await asRole(
      'authenticated',
      `select public.mark_avatar_screened('${idOf('maya')}'::uuid, 'ready')`,
    );
    expect(error).toBe('42501');
  });
});

describe('set_avatar, the write path a client does have', () => {
  it('records a path in your own folder and lands on pending', async () => {
    const path = pathFor('maya');

    const { error } = await asUser('maya').rpc('set_avatar', { p_path: path });

    expect(error).toBeNull();
    expect(await avatarOf('maya')).toEqual({ avatar_path: path, avatar_state: 'pending' });
  });

  it('refuses a path in somebody else’s folder', async () => {
    // The storage policies stop you *writing* an object under dre's prefix.
    // Nothing stops you naming one, so without this check you could point your
    // profile at dre's object and wear their face.
    const { error } = await asUser('maya').rpc('set_avatar', { p_path: pathFor('dre') });

    expect(error).not.toBeNull();
    expect(await avatarOf('maya')).toEqual({ avatar_path: null, avatar_state: 'none' });
  });

  it('clears back to none when handed null', async () => {
    await makePending('maya');

    const { error } = await asUser('maya').rpc('set_avatar', { p_path: null });

    expect(error).toBeNull();
    expect(await avatarOf('maya')).toEqual({ avatar_path: null, avatar_state: 'none' });
  });
});

describe('set_avatar takes exactly one argument, and that is the whole gate', () => {
  // Mutation testing changed set_avatar's signature to
  // `set_avatar(p_path text, p_state text default 'pending')` and had the
  // body write `avatar_state = p_state` instead of the literal `'pending'`.
  // Every test above still passed, because every call site in this file
  // supplies only `p_path` — the mutant is indistinguishable from the real
  // function unless something calls set_avatar with a second argument. Under
  // the mutation, `rpc('set_avatar', { p_path, p_state: 'ready' })` from a
  // signed-in client landed a `ready` row and published an unscreened avatar
  // to every signed-in account, without ever touching mark_avatar_screened or
  // the revoked grant on avatar_state.
  //
  // The migration's whole argument is that `set_avatar` cannot express
  // 'ready' because the state is a literal in its body, not a parameter. That
  // is a property of the function's *shape*, not of what today's callers
  // happen to pass, so it has to be pinned at the shape rather than at a
  // handful of call sites. Two angles, on purpose:
  //
  //   1. The signature itself, read from pg_proc — a future set_avatar with
  //      an extra parameter fails this immediately, before anyone has to
  //      notice a security property regressed.
  //   2. The behaviour a widened signature would produce — no call through
  //      this RPC may leave a row at 'ready', no matter what extra argument
  //      is thrown at it. Today PostgREST refuses the call outright ("no
  //      function matches"), and that refusal *is* the correct outcome, but
  //      the assertion is written to hold regardless of which error comes
  //      back — what matters is that `ready` stays unreachable through this
  //      door, not the shape of the failure.

  it('is defined with exactly one parameter', async () => {
    const rows = await sql<{ pronargs: number }>(`
      select p.pronargs
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_avatar'`);

    // Also guards against an overload sneaking in under the same name.
    expect(rows).toHaveLength(1);
    expect(rows[0].pronargs).toBe(1);
  });

  it('cannot be made to land a ready row by passing an extra state argument', async () => {
    const path = pathFor('maya');

    await asUser('maya').rpc('set_avatar', {
      p_path: path,
      p_state: 'ready',
    } as unknown as { p_path: string });

    // Deliberately not asserting on `error` here. Today PostgREST refuses this
    // call outright ("no function matches" / an overload-resolution failure),
    // which is itself the correct outcome — but the property this test exists
    // to pin is not the shape of that refusal. It is that no call through this
    // RPC, with any extra argument, may leave a row at 'ready'. That must hold
    // whether the call errors, silently no-ops, or resolves to some function.
    expect((await avatarOf('maya')).avatar_state).not.toBe('ready');
  });
});

describe('the screener’s verdict', () => {
  it('moves a pending row to ready, as service_role', async () => {
    const path = await makePending('maya');

    const { error } = await asService().rpc('mark_avatar_screened', {
      p_profile: idOf('maya'),
      p_state: 'ready',
    });

    expect(error).toBeNull();
    expect(await avatarOf('maya')).toEqual({ avatar_path: path, avatar_state: 'ready' });
  });

  it('changes nothing on a row that is no longer pending', async () => {
    // A verdict that arrives after the owner removed the photo. Without the
    // `and avatar_state = 'pending'` filter this republishes an image its
    // subject believes is gone — and the path column would still be null, so
    // the app would be in `ready` with nothing to show.
    await makePending('maya');
    await asUser('maya').rpc('set_avatar', { p_path: null });

    const { error } = await asService().rpc('mark_avatar_screened', {
      p_profile: idOf('maya'),
      p_state: 'ready',
    });

    expect(error).toBeNull(); // a replay is not a fault, it is simply a no-op
    expect(await avatarOf('maya')).toEqual({ avatar_path: null, avatar_state: 'none' });
  });

  it('rejects a state that is not a verdict', async () => {
    // 'none' and 'pending' mean "not screened yet". Accepting them would let a
    // bug walk an image backwards into a queue it had already left.
    await makePending('maya');

    const { error } = await asService().rpc('mark_avatar_screened', {
      p_profile: idOf('maya'),
      p_state: 'none',
    });

    expect(error?.code).toBe('22023');
    expect((await avatarOf('maya')).avatar_state).toBe('pending');
  });
});

describe('the check constraint', () => {
  it('rejects a state nothing in the schema knows', async () => {
    // Asserted as the superuser, past every grant and policy: the last line of
    // defence is the constraint itself, and it is what keeps the column a
    // four-valued enum rather than free text.
    const code = await sqlstateOf(`update public.profiles set avatar_state = 'banana' where id = $1`, [
      idOf('maya'),
    ]);

    expect(code).toBe('23514');
    expect((await avatarOf('maya')).avatar_state).toBe('none');
  });
});
