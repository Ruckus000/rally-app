-- The last hop: a notification row becomes a buzz.
--
-- `notify_on_reaction` writes the row, the bell renders it, and the `push`
-- Edge Function knows how to hand it to Expo. Nothing connected the two. This
-- is that wire.
--
-- Deliberately a migration rather than a Database Webhook created in the
-- dashboard. The dashboard's version bakes its headers into the trigger
-- definition as a literal string, which means the shared secret is readable by
-- anyone who can `select pg_get_triggerdef(...)` — every migration, every
-- backup, every `pg_dump`. It is also invisible to code review: a critical
-- piece of behaviour existing only as a row in someone's project settings.
--
-- Here the secret lives in Vault, encrypted, and is read at call time.

-- ─── 1. Where to send it, and what to prove ───────────────────────────────
--
-- Both come from Vault, and **both are optional**. A database with neither —
-- every local stack, every `db reset`, every integration run — simply does not
-- call out. That is what keeps this file from turning `npm run test:integration`
-- into a machine that fires real push notifications at a real phone.

create or replace function private.push_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  endpoint text;
  secret   text;
begin
  select decrypted_secret into endpoint
  from vault.decrypted_secrets where name = 'push_function_url';

  select decrypted_secret into secret
  from vault.decrypted_secrets where name = 'push_webhook_secret';

  -- Not configured is the normal case, not a fault: it is every environment
  -- except production.
  if endpoint is null or secret is null then
    return new;
  end if;

  -- `net.http_post` queues the request and returns immediately, so a slow or
  -- unreachable function cannot hold up the transaction that is writing the
  -- notification. A cheer must never fail because a phone could not be told
  -- about it.
  perform net.http_post(
    url := endpoint,
    body := jsonb_build_object('type', 'INSERT', 'table', 'notifications',
                               'record', to_jsonb(new)),
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', secret
    ),
    timeout_milliseconds := 5000
  );

  return new;
exception
  when others then
    -- The row is already written and the bell will show it. Failing here would
    -- roll back the notification itself — the phone would stay quiet *and* the
    -- app would forget it ever happened, which is strictly worse than one
    -- missed buzz.
    raise log 'push_notification: %', sqlerrm;
    return new;
end;
$$;

revoke execute on function private.push_notification() from public, anon, authenticated;

-- ─── 2. The trigger ───────────────────────────────────────────────────────
--
-- INSERT only. An UPDATE trigger would re-push every time a notification was
-- marked read, which is the one action that means "I have already seen this".

drop trigger if exists push_on_notification on public.notifications;

create trigger push_on_notification
  after insert on public.notifications
  for each row execute function private.push_notification();

comment on function private.push_notification() is
  'Calls the push Edge Function for each new notification. Silent unless push_function_url and push_webhook_secret exist in Vault.';
