-- ─── Deleting an account, part two: finishing it ──────────────────────────
--
-- `20260824090000_account_deletion.sql` marks an account and makes it
-- invisible. This is the fortnight later. It is a separate migration because
-- the two halves fail differently: the first is policies, which are either
-- right or wrong; this one is a scheduler, an HTTP call and a bucket, every
-- one of which can be up while the others are down.
--
-- Almost nothing here does the deleting. The cascade from `auth.users` does
-- that, and the one thing this schema adds to it is the trigger in section 1.
-- Everything else is plumbing to get a service-role client to call
-- `auth.admin.deleteUser` on the right accounts, once a day, because SQL
-- cannot delete a storage object and cannot call Apple.

-- ─── 1. The rows the cascade has never been able to find ──────────────────
--
-- Every cheer anybody has ever sent left a row in someone *else's* feed
-- carrying the sender's uuid and display name in a `jsonb` payload with no
-- foreign key — `private.notify_on_reaction` builds it, and
-- `20260819164832_reports_and_blocks.sql:280` records that `recipient_id` is
-- the only profile reference the table has. `recipient_id` cascades. These do
-- not. So deleting an account has always left its name sitting in other
-- people's notification lists, and would have gone on doing so.
--
-- A trigger rather than a step in the purge function, which is the one place
-- this migration departs from what was planned. Three reasons, and the third
-- is the one that decided it:
--
--   1. It closes the hole for *every* route out, not just the scheduled one —
--      including the manual runbook in `docs/legal/README.md`, which is still
--      the fallback and would otherwise still leak.
--   2. It runs inside the deleting transaction, so it cannot half-happen.
--   3. It removes an ordering constraint from the function entirely. The uuid
--      is unfindable once `auth.users` is gone, so a function doing this by
--      hand has to do it *first* — an invariant living in the order of two
--      statements, where nothing would notice if they were ever swapped.
--
-- The row goes rather than the payload being scrubbed. A cheer notification
-- names a goal that the same cascade is deleting, so what a scrub would leave
-- behind is an unattributed line about something that no longer exists.

create or replace function private.forget_actor_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications
  where payload ->> 'actor_id' = old.id::text;
  return old;
end;
$$;

revoke execute on function private.forget_actor_notifications() from public, anon, authenticated;

drop trigger if exists forget_actor_notifications on public.profiles;

create trigger forget_actor_notifications
  before delete on public.profiles
  for each row execute function private.forget_actor_notifications();

comment on function private.forget_actor_notifications() is
  'Deletes notifications caused by a departing profile. They are the one thing '
  'the cascade cannot reach: the actor lives in payload->>actor_id, which is '
  'jsonb and has no foreign key.';

-- ─── 2. Who is due ────────────────────────────────────────────────────────
--
-- **Takes no arguments, and that is the security property.** `orphaned_media`
-- takes its window as an `interval` and this deliberately does not copy it:
-- the caller is an edge function behind a shared secret, and a leaked secret
-- plus `p_grace => '0 seconds'` would delete every pending account on the
-- service in one request. The fortnight lives here, where the caller cannot
-- reach it, and the client's copy in `deleteAccount.ts` only decides what a
-- sentence says.
--
-- In `public` rather than `private` for `orphaned_media`'s mechanical reason:
-- PostgREST exposes only `public`, so a `private` one could not be called by
-- the collector either.

create or replace function public.accounts_due_for_purge()
returns table (id uuid)
language sql
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.deleted_at is not null
    and p.deleted_at < now() - interval '14 days'
  order by p.deleted_at
$$;

revoke execute on function public.accounts_due_for_purge() from public, anon, authenticated;
grant  execute on function public.accounts_due_for_purge() to service_role;

comment on function public.accounts_due_for_purge() is
  'Accounts whose fourteen days are up, oldest first. Takes no arguments on '
  'purpose: the window is not the caller''s to choose.';

-- ─── 3. The nudge, and the scheduler behind it ────────────────────────────
--
-- `private.nudge_media_gc` copied, with the trigger swapped for a clock.
-- Endpoint and secret both come from Vault, and a database with neither — every
-- local stack, every `db reset`, every integration run — does not call out.
-- That is what keeps `npm run test:integration` off the network, and it is why
-- the tests for this assert what the function *would* send rather than that it
-- sent it.
--
-- The `exists` check is the one addition. `nudge_media_gc` fires on an insert,
-- so by construction it always has something to say; this fires on a clock and
-- would otherwise make an authenticated request every night to be told nothing
-- is due. On a service this size that is the normal case.

create or replace function private.purge_due_accounts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  endpoint text;
  secret   text;
begin
  if not exists (select 1 from public.accounts_due_for_purge()) then
    return;
  end if;

  select decrypted_secret into endpoint
  from vault.decrypted_secrets where name = 'delete_account_function_url';

  select decrypted_secret into secret
  from vault.decrypted_secrets where name = 'delete_account_webhook_secret';

  if endpoint is null or secret is null then
    return;
  end if;

  perform net.http_post(
    url := endpoint,
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', secret
    ),
    timeout_milliseconds := 5000
  );
exception
  when others then
    -- Nothing is lost by failing here. `deleted_at` is the memory, it is still
    -- set, and tomorrow's run asks again. Raising would abort the cron job and
    -- put a red mark against a night when the only thing that happened is that
    -- an HTTP call did not go out.
    raise log 'purge_due_accounts: %', sqlerrm;
end;
$$;

revoke execute on function private.purge_due_accounts() from public, anon, authenticated;

comment on function private.purge_due_accounts() is
  'Asks delete-account to purge whoever is due. Silent unless '
  'delete_account_function_url and delete_account_webhook_secret exist in Vault.';

-- ─── 4. pg_cron, which this project did not have ──────────────────────────
--
-- `collect-media` says in as many words that `pg_cron` is not installed and
-- "this is not worth installing one for", and that was right: media collection
-- hangs off a delete, so a trigger already fires at exactly the moment there
-- is work. That reasoning does not reach here. Elapsed time has no trigger —
-- nothing happens on the fourteenth day to hang one off — so the choice is a
-- scheduler or nothing, and a deletion that only completes when the user
-- happens to open the app is not a deletion.
--
-- Daily, and off the hour. Precision buys nothing against a fortnight, and one
-- account purged sixteen hours late is invisible where a herd of services all
-- waking at midnight is not.

create extension if not exists pg_cron;

select cron.schedule(
  'purge-due-accounts',
  '17 3 * * *',
  $$select private.purge_due_accounts()$$
);
