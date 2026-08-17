-- A bot may cheer you. It may not wake you up.
--
-- The Oz bots cheer real people's staked tasks — that is `public.bot_cheer`,
-- and it is the point: the Global feed is the first thing a new account sees,
-- and an empty one that never reacts to you reads as a room full of people
-- ignoring you. So the bell showing "🔥 Dorothy Gale cheered you" is wanted.
--
-- What is not wanted is the buzz. `push_on_notification` now carries every
-- notification row to a lock screen, and a fictional character is not a good
-- enough reason to light somebody's phone at three in the morning. A cheer from
-- a real person is news; a cheer from a scheduled job wearing a name is
-- furniture, and furniture should wait until you next open the app.
--
-- The row is still written, and the bell still counts it. Only the last hop is
-- skipped.

-- ─── 1. Finding the bots without reading the whole table ──────────────────
--
-- This runs on every notification insert, so it must not become a sequential
-- scan of `profiles` as the service grows. There are four bot rows and there
-- will not be many more, so a partial index is the whole cost: the planner
-- reads only the rows where `is_bot` is true and compares those.

create index if not exists profiles_bots_idx on public.profiles (id) where is_bot;

-- ─── 2. The check ─────────────────────────────────────────────────────────

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
  -- Asked first, because it is the cheapest question here and because a push
  -- that should never happen should not depend on how the rest of this
  -- function behaves.
  --
  -- The actor is in `payload`: `notifications` has no actor column, and
  -- `notify_on_reaction` puts `actor_id` there so the client can render the row
  -- without a second read. Compared as text rather than cast to uuid, so a
  -- payload without an actor — or with a malformed one — cannot raise inside a
  -- trigger whose exception handler would then silently swallow a *real*
  -- person's push. No actor id means no match, which means the push proceeds:
  -- the default has to be to deliver, or a future notification kind would
  -- arrive silently for reasons nobody wrote down.
  if exists (
    select 1 from public.profiles p
    where p.is_bot and p.id::text = new.payload ->> 'actor_id'
  ) then
    return new;
  end if;

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

comment on function private.push_notification() is
  'Calls the push Edge Function for each new notification, except when the actor is a bot. Silent unless push_function_url and push_webhook_secret exist in Vault.';
