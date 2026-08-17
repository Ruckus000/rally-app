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
