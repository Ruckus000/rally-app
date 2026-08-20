-- The bucket keeps what the cascade drops.
--
-- `task_media.task_id references tasks (id) on delete cascade`, and that
-- cascade is right: the row describing a photo on a goal has no meaning once
-- the goal is gone. What it cannot do is take the file with it. Postgres
-- deletes rows; the bytes live in a bucket it cannot reach. So deleting a goal
-- left an object that no row named, which `can_see_media` therefore refuses to
-- anyone — unreadable, and also uncollectable, because after the row went
-- there was nothing left in the schema or the app that would ever look at it
-- again. It sat there and was billed.
--
-- The client half of this is `media.detach` on the delete path (see
-- `src/sync/engine.ts`), which sends the same op the photo chip already sent.
-- That is the fast path and it covers the device holding the photo. It cannot
-- cover the rest: a goal deleted from a device whose state never carried the
-- photo has nothing to detach, and an upload that landed before its row was
-- written is an object no client ever knew to name. This file is the half that
-- does not depend on a client being there, or being right.
--
-- ─── two mechanisms, because there are two kinds of garbage ───────────────
--
-- `media_gc` is the exact one. A row leaves `task_media`, a trigger writes its
-- path here, and that path is known garbage the moment it is written — no
-- guessing, no waiting.
--
-- `public.orphaned_media` is the inexact one, and it is what catches
-- everything the trigger was not there for: the objects already orphaned
-- before this migration existed, and the ones whose row was never written at
-- all. It has to guess, because "no row names this object" is also true of an
-- upload that landed one second ago and whose row is still in the outbox —
-- `src/sync/media.ts` writes the row only once the bytes are up, deliberately,
-- so that a row never points at a file that is not there. Hence the age bound:
-- an object is only a candidate once it is old enough that any row it was
-- going to get would have arrived.

-- ─── 1. The queue ─────────────────────────────────────────────────────────
--
-- Not a `net.http_post` straight from the trigger, which is what
-- `push_on_notification` does. That call is fire-and-forget by design and the
-- migration says so: a dropped request there costs one missed buzz. A dropped
-- request here costs the delete permanently, which is the bug this file
-- exists to fix. So the durable thing is the row, and the HTTP call is only a
-- nudge — losing it delays collection to the next nudge and loses nothing.

create table public.media_gc (
  -- The object name, and the primary key: enqueueing the same path twice is
  -- the same instruction twice, and `on conflict do nothing` makes a repeat
  -- free rather than a duplicate delete.
  path        text primary key,
  enqueued_at timestamptz not null default now(),
  -- Bumped by the collector when a delete fails, so a path that can never be
  -- deleted is visible as a number going up rather than as silence.
  tries       integer not null default 0,
  last_error  text
);

comment on table public.media_gc is
  'Object names whose task_media row has gone, waiting to be deleted from the '
  'task-media bucket. Written only by the trigger below; drained only by the '
  'collect-media function as service_role. Readable by no client.';

-- Readable by nobody, on the `reports` pattern: RLS on with no policy stops
-- the rows, and the revoke stops the table. `service_role` is not revoked
-- here — the collector is the one thing that must read and delete these.
alter table public.media_gc enable row level security;
revoke all on public.media_gc from anon, authenticated;

-- Granted explicitly, because nothing grants it implicitly any more. The
-- default privilege that used to hand every new `public` table to every role
-- was revoked in `repair_write_paths` — deliberately, since it included
-- TRUNCATE for `anon` — and the consequence is that a new table arrives
-- reachable by nobody at all, `service_role` included. The collector reads the
-- queue, updates a row when a delete fails, and deletes it when one succeeds;
-- an integration test asserts all three, because the failure mode without them
-- is collection quietly never happening.
grant select, update, delete on public.media_gc to service_role;

-- ─── 2. Filling it ────────────────────────────────────────────────────────
--
-- `after delete`, not `before`: if the delete rolls back, the path is not
-- garbage and this row must roll back with it. Being in the same transaction
-- is the point.
--
-- Fires for the cascade *and* for `media.detach`, which deletes the row and
-- then the object itself. That is a deliberate overlap, not a waste: the
-- client's delete is the fast path and this is the receipt. If the client
-- managed it, the collector deletes an object that is already gone, which
-- storage answers without complaint and which costs one call.

create or replace function private.enqueue_media_gc()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.media_gc (path) values (old.path)
  on conflict (path) do nothing;
  return old;
end;
$$;

revoke execute on function private.enqueue_media_gc() from public, anon, authenticated;

drop trigger if exists enqueue_media_gc on public.task_media;

create trigger enqueue_media_gc
  after delete on public.task_media
  for each row execute function private.enqueue_media_gc();

-- ─── 3. Finding what the trigger was never told about ─────────────────────
--
-- One query rather than a walk of the bucket. The storage API can only list a
-- prefix at a time, and these objects are `<owner_id>/<task_id>/<id>.jpg`, so
-- listing them means one call per owner and then one per goal — a sweep whose
-- cost grows with the number of accounts rather than with the amount of
-- garbage. `storage.objects` is a table, and the question is a join.
--
-- `security definer` because `storage.objects` is not readable by the roles a
-- client can act as and must not become so; this returns names, and only to
-- `service_role`.
--
-- In `public` rather than `private`, unlike every other helper here, and for a
-- mechanical reason: PostgREST only exposes `public`, so a `private` one could
-- not be called by the collector either — the grant would be to a role with no
-- way to reach it. `mark_task_media_ready` sits in `public` for the same
-- reason and is locked the same way: revoked from the roles a client can act
-- as, granted to `service_role` alone.

create or replace function public.orphaned_media(p_min_age interval)
returns table (path text)
language sql
security definer
set search_path = ''
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'task-media'
    -- The age bound. Without it this deletes uploads that are still waiting
    -- for their row, which is the one failure this whole file must not cause:
    -- a goal whose photo vanishes between taking it and it appearing.
    and o.created_at < now() - p_min_age
    and not exists (
      select 1 from public.task_media m where m.path = o.name
    )
$$;

revoke execute on function public.orphaned_media(interval) from public, anon, authenticated;
grant  execute on function public.orphaned_media(interval) to service_role;

comment on function public.orphaned_media(interval) is
  'Objects in task-media older than p_min_age that no task_media row names. '
  'The age bound exists because a row is written after its upload lands, so a '
  'young unclaimed object is a live upload, not garbage.';

-- ─── 4. The nudge ─────────────────────────────────────────────────────────
--
-- Same shape as `push_on_notification`, and optional for the same reason:
-- endpoint and secret both come from Vault, and a database with neither —
-- every local stack, every `db reset`, every integration run — does not call
-- out. That is what keeps `npm run test:integration` from making network calls,
-- and it is why the integration test for this asserts the *queue row*, which
-- is the durable part, rather than the HTTP call, which is not.
--
-- Statement-level, not per row: deleting a goal with a photo enqueues one
-- path, but a person deleted, or a week's worth of goals cleared, enqueues
-- many, and they all want one call rather than one call each.

create or replace function private.nudge_media_gc()
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
  from vault.decrypted_secrets where name = 'collect_media_function_url';

  select decrypted_secret into secret
  from vault.decrypted_secrets where name = 'collect_media_webhook_secret';

  if endpoint is null or secret is null then
    return null;
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

  return null;
exception
  when others then
    -- The path is already in `media_gc` and the next nudge will drain it.
    -- Raising here would roll back the delete that caused it, which would
    -- keep a goal the user removed.
    raise log 'nudge_media_gc: %', sqlerrm;
    return null;
end;
$$;

revoke execute on function private.nudge_media_gc() from public, anon, authenticated;

drop trigger if exists nudge_media_gc on public.media_gc;

create trigger nudge_media_gc
  after insert on public.media_gc
  for each statement execute function private.nudge_media_gc();

comment on function private.nudge_media_gc() is
  'Asks collect-media to drain the queue. Silent unless '
  'collect_media_function_url and collect_media_webhook_secret exist in Vault.';
