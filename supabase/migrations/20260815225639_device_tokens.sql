-- Where to send a cheer when the app is closed.
--
-- `private.notify_on_reaction` already writes a row the moment anyone cheers
-- your task, and the bell already renders it — but only once you open the app
-- and look. Onboarding's step 5 draws a cheer landing on a lock screen and then
-- carefully promises only that cheers "wait in the app", because that is all
-- the app can honestly do. This table is the missing address book.
--
-- A token is per *install*, not per account. The same person on a phone and a
-- tablet is two rows; deleting and reinstalling mints a new one and orphans the
-- old. Nothing here assumes otherwise.

create table device_tokens (
  -- Expo's "ExponentPushToken[…]", and the primary key rather than a column of
  -- one: a phone that changes hands re-registers the same token under the new
  -- account, and that has to *move* the row. A composite key would keep the
  -- previous owner's, and the next cheer they got would ring on this phone.
  token       text primary key,
  profile_id  uuid not null references profiles (id) on delete cascade,
  platform    text not null,
  updated_at  timestamptz not null default now(),

  -- Bounded for the same reason `profiles.name` is: `token` is client-supplied
  -- text, and without this the table is general-purpose storage that anyone
  -- signed in can write to. Expo's are ~41 characters.
  constraint device_tokens_token_shape check (length(token) between 8 and 200),
  constraint device_tokens_platform_known check (platform in ('ios', 'android'))
);

-- The delivery path's only query: every device belonging to one recipient.
create index device_tokens_profile_idx on device_tokens (profile_id);

alter table device_tokens enable row level security;

-- ─── Nobody reaches this table directly ───────────────────────────────────
--
-- No policies and no grant to `authenticated`, which is deliberate and is the
-- whole design. A row here says which phone a person is holding and when they
-- last opened the app; a table that can be read is a list of somebody's
-- devices, and the cheapest time not to have one is before it exists.
--
-- The obvious shape — grant the owner insert/update/delete on their own rows —
-- does not survive contact with how a client actually writes. Registration is
-- an upsert, and `on conflict do update` has to read the row it is updating;
-- deregistration is `delete where token = …`, and the filter has to read it
-- too. Both come back "permission denied … GRANT SELECT", so keeping the write
-- paths means granting the read, and then the no-read rule is gone in exchange
-- for nothing.
--
-- So the two writes are functions instead, the way `join_circle_by_code` and
-- `bot_cheer` are: the client gets EXECUTE on exactly the two things it needs
-- to do and no privilege on the table at all. RLS stays enabled underneath
-- with no policy — belt and braces on a table nothing is granted.

create or replace function public.register_device(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- `on conflict (token)` reassigns rather than inserting a second row: the
  -- token names one physical device, and a device belongs to whoever is signed
  -- in on it now. This is the phone-changed-hands path, and it is the reason
  -- the token is the primary key.
  insert into public.device_tokens (token, profile_id, platform)
  values (p_token, me, p_platform)
  on conflict (token) do update
    set profile_id = me,
        platform   = excluded.platform,
        updated_at = now();
end;
$$;

create or replace function public.unregister_device(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Scoped to your own row even though you had to know the token to get here.
  -- Deleting somebody else's is a silent, targeted denial of service: their
  -- cheers simply stop arriving and nothing on any screen says why.
  delete from public.device_tokens
  where token = p_token and profile_id = auth.uid();
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, so a SECURITY
-- DEFINER function in `public` is an open endpoint until told otherwise. Both
-- of these write the table as their owner; `anon` must not reach either.
revoke execute on function public.register_device(text, text) from public, anon;
revoke execute on function public.unregister_device(text) from public, anon;
grant execute on function public.register_device(text, text) to authenticated;
grant execute on function public.unregister_device(text) to authenticated;

-- The read the whole feature exists for, and it needs saying explicitly.
--
-- `repair_write_paths` granted `all on all tables` to service_role, which is a
-- statement about the tables that existed that day — it does not reach a table
-- created two migrations later. Bypassing RLS is not permission to reach the
-- table, so without this the delivery job gets "permission denied for table
-- device_tokens" and every push fails: a book full of correct addresses that
-- nothing is allowed to open.
--
-- `delete` as well as `select`, because Expo's receipts name tokens that are
-- dead — uninstalled apps, rotated tokens — and the job has to prune them or
-- every send burns quota on addresses nothing lives at.
grant all on public.device_tokens to service_role;

-- ─── The privilege nobody granted ─────────────────────────────────────────
--
-- Supabase ships a default privilege — `alter default privileges for postgres
-- in schema public grant ... to anon, authenticated` — carrying `Dxtm`:
-- TRUNCATE, REFERENCES, TRIGGER, MAINTAIN. Every table created in `public`
-- therefore arrives with anon and authenticated already holding TRUNCATE, and
-- **TRUNCATE ignores row security entirely**: no policy in this file, or any
-- other, has any bearing on a role that can empty the table in one statement.
--
-- `repair_write_paths` revoked it from the ten tables that existed that day.
-- It could not revoke it from tables that did not exist yet, and this is the
-- first one added since — so it arrived with the same hole, silently, having
-- been granted nothing by name.
--
-- Both halves, because either alone leaves the trap set:

revoke all on public.device_tokens from anon, authenticated;

-- And for the next table, whoever adds it. This is the actual defect: a
-- default that hands two public roles a destructive privilege on everything
-- written from here on. service_role keeps its own — it is granted `all`
-- explicitly above and is not reachable from a client.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

comment on table public.device_tokens is
  'Expo push tokens, one per install. Written only through register_device/unregister_device; read only by the delivery job as service_role.';
