-- Repair the write paths the initial schema left out.
--
-- The init migration enabled RLS and wrote 23 policies, and `db advisors`
-- reported it clean — but advisors only detect *over*-permission. It cannot
-- tell you a table has no way to be written to at all. Auditing every table
-- for a write path found five gaps, each of which independently blocks the
-- client work:
--
--   1. No Data API grants at all. Verified: locally 0 of 10 tables were
--      reachable by `authenticated`. The hosted project worked only because it
--      still auto-exposes new tables — legacy behaviour Supabase removes on
--      2026-10-30. Granting explicitly makes local match hosted and survives
--      that change.
--   2. `profiles` had no INSERT policy, so a new user could never create their
--      own row — and every FK in the schema points at `profiles`, not
--      `auth.users`.
--   3. `circles` was selectable only by existing members, so an invite code
--      could never be resolved to a circle. The join flow was unreachable.
--   4. `task_pairs` had no INSERT, so pairing was unwritable.
--   5. `invites` had no UPDATE, so an invite could never be accepted.
--
-- Plus `tasks.updated_at` (last-write-wins had no clock) and the realtime
-- publication (subscriptions would have connected and delivered nothing).

-- ─── 1. Data API grants ───────────────────────────────────────────────────
--
-- Granted per table to match the policies that actually exist, rather than a
-- blanket `all tables`. RLS still decides which *rows*; these decide whether
-- the table is reachable at all. `anon` deliberately gets no table access —
-- no policy targets it, so it would see nothing regardless, and saying so
-- explicitly is better than relying on that.

grant usage on schema public to anon, authenticated, service_role;

-- service_role carries `bypassrls`, which is worthless on its own: bypassing
-- row security still requires permission to reach the table. Without this it
-- gets "permission denied for table tasks" on everything, which would break
-- every server-side path — the future rollover job, any edge function, and
-- admin tooling — the moment auto-exposure of new tables goes away.
grant all on all tables in schema public to service_role;

grant select, update          on public.profiles       to authenticated;
grant select, insert          on public.circles        to authenticated;
grant select, insert, delete  on public.circle_members to authenticated;
grant select, insert, update, delete on public.tasks   to authenticated;
grant select, insert, update, delete on public.task_pairs to authenticated;
grant select, insert, delete  on public.reactions      to authenticated;
grant select, insert          on public.notes          to authenticated;
grant select                  on public.week_rollups   to authenticated;
grant select, update          on public.notifications  to authenticated;
grant select, insert, update  on public.invites        to authenticated;

-- ─── 1b. The policy helpers must be executable by the role RLS runs as ────
--
-- The init migration ended with:
--     revoke execute on all functions in schema private from public, anon, authenticated;
-- which is correct instinct and wrong effect. An RLS policy is evaluated as
-- the *calling* role, so revoking EXECUTE from `authenticated` breaks every
-- policy that calls a helper — profiles, circles, circle_members, the friends
-- and private branches of tasks_select, task_pairs, reactions, notes,
-- week_rollups and invites_insert. All of them fail with
-- "permission denied for function shares_circle_with".
--
-- It stayed hidden because `tasks_select` short-circuits on
-- `owner_id = auth.uid() or aud = 'everyone'`, so an empty table never reaches
-- a helper. The first real row would have exposed it.
--
-- Granting EXECUTE back is safe, and is not the same as exposing them: the
-- `private` schema is absent from `[api] schemas`, so they remain unreachable
-- over REST (PostgREST answers PGRST202). Each helper is also scoped to
-- auth.uid(), so being SECURITY DEFINER cannot reveal another user's rows.
-- `anon` and PUBLIC stay revoked.

grant usage on schema private to authenticated;

grant execute on function private.is_circle_member(uuid)    to authenticated;
grant execute on function private.shares_circle_with(uuid)  to authenticated;
grant execute on function private.is_paired_on(uuid)        to authenticated;
grant execute on function private.can_see_task(uuid)        to authenticated;

-- ─── 2. Profiles are created by a trigger, not by the client ──────────────
--
-- An anonymous user has no handle to offer and no name, so there is nothing
-- for a client insert to supply. Doing it in a trigger also means `profiles`
-- never needs an INSERT policy, which keeps the client's write surface
-- smaller rather than larger.

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  generated_handle text;
begin
  -- 'anon_' + 12 hex chars = 17, inside profiles.handle's ^[a-z0-9_.]{3,30}$.
  generated_handle := coalesce(
    nullif(new.raw_user_meta_data ->> 'handle', ''),
    'anon_' || substr(replace(new.id::text, '-', ''), 1, 12)
  );

  insert into public.profiles (id, handle, name)
  values (
    new.id,
    generated_handle,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), 'Someone')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ─── 3. Joining a circle by its invite code ───────────────────────────────
--
-- `circles_select` requires membership, which makes resolving an invite code
-- impossible for the one person who needs to: someone who is not yet a
-- member. Widening that policy would leak every circle to every user, so the
-- lookup happens inside a SECURITY DEFINER function instead, which returns
-- only the circle you just joined.
--
-- The failure message is deliberately generic so invite codes cannot be
-- enumerated by distinguishing "no such circle" from "already a member".

create or replace function public.join_circle_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id into target from public.circles where invite_code = code;

  if target is null then
    raise exception 'invalid invite code' using errcode = 'P0002';
  end if;

  insert into public.circle_members (circle_id, profile_id)
  values (target, caller)
  on conflict (circle_id, profile_id) do nothing;

  return target;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default, which would make this callable
-- by `anon`. It checks auth.uid() internally, but say it explicitly.
revoke execute on function public.join_circle_by_code(text) from public, anon;
grant execute on function public.join_circle_by_code(text) to authenticated;

-- `db advisors` flags this as "authenticated can execute a SECURITY DEFINER
-- function", and it is right that it cannot verify the body. The warning is
-- expected and accepted: the function is scoped to auth.uid(), returns only
-- the circle the caller just joined, and being callable by signed-in users is
-- the whole point.
--
-- The real residual risk is not the definer rights, it is invite-code entropy.
-- `basement-9x2` is guessable, and this function is an oracle for testing
-- guesses. Whatever generates invite_code should produce something with real
-- entropy before anyone outside a test uses it.

-- ─── 4. Pairing ───────────────────────────────────────────────────────────
--
-- You may pair someone on a task you own, and you may remove yourself from
-- one. Both halves were missing.

create policy task_pairs_insert on public.task_pairs for insert to authenticated
  with check (
    exists (
      select 1 from public.tasks t
      where t.id = task_id and t.owner_id = (select auth.uid())
    )
  );

create policy task_pairs_delete on public.task_pairs for delete to authenticated
  using (
    profile_id = (select auth.uid())
    or exists (
      select 1 from public.tasks t
      where t.id = task_id and t.owner_id = (select auth.uid())
    )
  );

-- ─── 5. Accepting an invite ───────────────────────────────────────────────
--
-- Only the invitee may accept, and only their own invite.

create policy invites_update on public.invites for update to authenticated
  using (invitee_id = (select auth.uid()))
  with check (invitee_id = (select auth.uid()));

-- ─── 5b. "Not blank" has to mean not blank ────────────────────────────────
--
-- `length(trim(body)) > 0` reads as a blank-note guard but isn't one: bare
-- `trim()` strips spaces and nothing else, so a body of tabs and newlines
-- sails through. Same for task titles. btrim with an explicit character set
-- is what the constraint was always meant to say.

alter table public.notes drop constraint notes_body_check;
alter table public.notes add constraint notes_body_check
  check (length(btrim(body, E' \t\n\r')) > 0);

alter table public.tasks drop constraint tasks_title_check;
alter table public.tasks add constraint tasks_title_check
  check (length(btrim(title, E' \t\n\r')) > 0);

-- ─── 6. A clock for last-write-wins ───────────────────────────────────────
--
-- The client sends the moment the user tapped, because that is the intent
-- worth comparing: a stake queued offline on Monday and drained on Friday
-- should not beat a Wednesday edit from another device. Server `now()` alone
-- would make arrival order authoritative, which is wrong for an offline-first
-- app. The clamp bounds how far a device with a wrong clock can win.

alter table public.tasks add column updated_at timestamptz not null default now();

create or replace function private.clamp_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := least(coalesce(new.updated_at, now()), now() + interval '5 minutes');
  return new;
end;
$$;

create trigger tasks_clamp_updated_at
  before insert or update on public.tasks
  for each row execute function private.clamp_updated_at();

create index tasks_updated_at_idx on public.tasks (owner_id, updated_at);

-- ─── 7. Realtime ──────────────────────────────────────────────────────────
--
-- Without the publication a subscription connects successfully and delivers
-- nothing, which is the most confusing possible failure. `replica identity
-- full` additionally matters because a DELETE otherwise carries only the
-- primary key.

alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.reactions;
alter publication supabase_realtime add table public.notes;

alter table public.tasks     replica identity full;
alter table public.reactions replica identity full;
alter table public.notes     replica identity full;

-- ─── 8. Anonymous accounts must stay deletable ────────────────────────────
--
-- `on delete restrict` means deleting an auth user cascades to profiles and
-- is then blocked if they ever created a circle. Anonymous accounts are
-- exactly the population you garbage-collect, so the circle outlives its
-- creator instead.

alter table public.circles drop constraint circles_created_by_fkey;
alter table public.circles alter column created_by drop not null;
alter table public.circles add constraint circles_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete set null;

create index circles_created_by_idx on public.circles (created_by);
