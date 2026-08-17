/**
 * The backstop under the backstop.
 *
 * Every table in this schema enables row level security in as many words, and
 * the tests in the files beside this one hold each of them to it. `ensure_rls`
 * is for the table that is added without either — a new `create table` in
 * `public` with no `enable row level security` line and no test naming it, which
 * is readable by everybody and looks exactly like a table that is fine.
 *
 * It lived only on production until now, created straight against the database
 * and owned by `postgres` rather than by the platform. Adopting it here is
 * mostly about that: a database whose behaviour differs from the one every test
 * runs against makes a passing suite mean less than it says.
 *
 * The DDL below is real and rolls back, which is what `sqlInTx` is for — a test
 * that leaves tables behind would change the answer of the table-count tripwire
 * in `circles.test.ts`.
 */
import { sql, sqlInTx } from '../support/reset';

describe('a table created without a word about RLS', () => {
  it('gets it anyway, when it lands in public', async () => {
    const rows = await sqlInTx<{ rls: boolean }>([
      `create table public.probe_forgot_rls (id int)`,
      `select relrowsecurity as rls from pg_class where relname = 'probe_forgot_rls'`,
    ]);
    expect(rows[0].rls).toBe(true);
  });

  it('and still gets it when created as a copy of another table', async () => {
    // `create table as` is the shape most likely to be written in a hurry, and
    // it is the one where the missing RLS line is least likely to be noticed.
    const rows = await sqlInTx<{ rls: boolean }>([
      `create table public.probe_copy as select 1 as id`,
      `select relrowsecurity as rls from pg_class where relname = 'probe_copy'`,
    ]);
    expect(rows[0].rls).toBe(true);
  });

  it('however the table was spelled', async () => {
    // The event trigger fires on three command tags — CREATE TABLE, CREATE
    // TABLE AS, SELECT INTO — and Postgres reports more forms under those than
    // is obvious. Enumerated because the tag list is the one place this could
    // silently narrow: a form that reports some fourth tag would be created
    // wide open and nothing would say so.
    const rows = await sqlInTx<{ relname: string; rls: boolean }>([
      `create table public.probe_plain (id int)`,
      `create table public.probe_as as select 1 as id`,
      `select 1 as id into public.probe_into`,
      `create table public.probe_like (like public.probe_plain)`,
      `create unlogged table public.probe_unlogged (id int)`,
      `create table public.probe_part (id int, d date) partition by range (d)`,
      `create table public.probe_part_child partition of public.probe_part
         for values from ('2026-01-01') to ('2027-01-01')`,
      `select relname, relrowsecurity as rls from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and relname like 'probe\\_%' order by relname`,
    ]);

    expect(rows).toHaveLength(7);
    for (const r of rows) expect(`${r.relname}:${r.rls}`).toBe(`${r.relname}:true`);
  });

  it('but not a temp table, which no client can reach', async () => {
    // Lands in pg_temp rather than public, so the schema test skips it. Worth
    // stating: a temp table with RLS on would be a confusing way for a future
    // migration's own scratch space to start refusing to read itself.
    const rows = await sqlInTx<{ rls: boolean }>([
      `create temp table probe_temp (id int)`,
      `select relrowsecurity as rls from pg_class where relname = 'probe_temp'`,
    ]);
    expect(rows[0].rls).toBe(false);
  });

  it('but not in private, which is not reachable by a client anyway', async () => {
    // The trigger is scoped to `public` on purpose. Enabling RLS on internal
    // tables would buy nothing — nothing signed in can reach that schema — and
    // would silently change how the functions there read their own data.
    const rows = await sqlInTx<{ rls: boolean }>([
      `create table private.probe_internal (id int)`,
      `select c.relrowsecurity as rls from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where c.relname = 'probe_internal' and n.nspname = 'private'`,
    ]);
    expect(rows[0].rls).toBe(false);
  });
});

describe('where it lives, which is the half that was drifting', () => {
  it('is a private function, not a public one', async () => {
    // Postgres grants EXECUTE to PUBLIC on every new function, so `public` is
    // where a SECURITY DEFINER function becomes a callable endpoint. Production
    // carried this one in `public`; every other internal function here is in
    // `private`, and an audit of `public` should not have to explain it away.
    const rows = await sql<{ schema: string }>(
      `select n.nspname as schema from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where p.proname = 'rls_auto_enable'`,
    );
    expect(rows.map((r) => r.schema)).toEqual(['private']);
  });

  it('is wired to an event trigger that is actually enabled', async () => {
    // A function with no trigger is dead code that reads like protection.
    const rows = await sql<{ enabled: string; fn: string }>(
      `select evtenabled::text as enabled, evtfoid::regprocedure::text as fn
         from pg_event_trigger where evtname = 'ensure_rls'`,
    );
    expect(rows).toHaveLength(1);
    // 'O' is the default, meaning it fires on ordinary DDL.
    expect(rows[0].enabled).toBe('O');
    expect(rows[0].fn).toBe('private.rls_auto_enable()');
  });
});
