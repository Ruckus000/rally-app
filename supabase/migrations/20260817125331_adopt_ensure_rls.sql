-- Bring the production-only RLS backstop into version control.
--
-- Production has carried an event trigger, `ensure_rls`, that enables row
-- level security on every table created in `public`. It was in no migration —
-- created directly against the database at some point, owned by `postgres`
-- rather than `supabase_admin`, so it is ours and not the platform's. Local had
-- neither the trigger nor its function.
--
-- That divergence is the actual problem, more than the trigger itself. A
-- database whose behaviour differs from the one every test runs against is a
-- database where a passing suite means less than it says. All fourteen tables
-- happen to agree today — every one of them has RLS on because a migration says
-- so in as many words, and this trigger has never once changed an outcome — but
-- "happens to agree" is not a property anything checks.
--
-- Adopted rather than dropped. It is a fail-closed backstop on the one mistake
-- in this schema that is silent when you make it: a new table with no
-- `enable row level security` line is readable by everybody, and it looks
-- exactly like a table that is fine. Tests catch that for tables tests know
-- about. This catches it for the one somebody adds in a hurry.
--
-- Two things change on the way in.

-- ─── 1. It moves to `private` ─────────────────────────────────────────────
--
-- Every internal function in this schema lives there — `notify_on_reaction`,
-- `push_notification`, `tasks_lww_guard` — and none of them is in `public`,
-- because Postgres grants EXECUTE to PUBLIC on every new function and a
-- SECURITY DEFINER function in an exposed schema is a callable endpoint until
-- told otherwise. That reasoning does not really bite here (a function
-- returning `event_trigger` cannot be called directly at all), but the
-- convention is worth more than the exception: somebody auditing `public` for
-- SECURITY DEFINER functions should find only the ones meant to be reachable.

-- The old pair, in the order the dependency requires. Both are no-ops locally,
-- where neither has ever existed.
drop event trigger if exists ensure_rls;
drop function if exists public.rls_auto_enable();

create or replace function private.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
-- Empty rather than `pg_catalog`, matching every other function here, with the
-- catalog names below qualified explicitly instead.
set search_path = ''
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_catalog.pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    -- ─── 2. The schema test is one comparison, not five ───────────────────
    --
    -- The original also excluded `pg_catalog`, `information_schema`, `pg_toast%`
    -- and `pg_temp%` — every one of which is already excluded by requiring
    -- `public`. Four dead clauses reading as though they were load-bearing.
    if cmd.schema_name = 'public' then
      begin
        execute pg_catalog.format(
          'alter table if exists %s enable row level security', cmd.object_identity
        );
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          -- A backstop that can abort a migration is worse than the mistake it
          -- guards against: it would turn "you forgot a line" into "your deploy
          -- failed halfway".
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    end if;
  end loop;
end;
$$;

revoke execute on function private.rls_auto_enable() from public, anon, authenticated;

create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function private.rls_auto_enable();

comment on function private.rls_auto_enable() is
  'Event-trigger backstop: enables RLS on any table created in public. Every migration should still say so explicitly — this is what catches the one that does not.';
