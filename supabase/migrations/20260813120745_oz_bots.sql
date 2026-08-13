-- Accounts that are openly not people.
--
-- The Global feed has always been four invented accounts drawn from a client
-- fixture — same four for everyone, cheer counts that no ledger backs, and a
-- tap that toasted "kwon.builds heard that" about somebody who does not exist.
-- It is now the middle tab and where a new account lands, so it is the first
-- thing anyone sees.
--
-- The answer is not to hide it but to make the fiction obvious and the rows
-- real: characters out of Oz, owning actual `tasks` that a scheduled job will
-- keep current. A bot is therefore an ordinary account. Nothing here invents a
-- content system alongside the one that exists — `aud = 'everyone'` is already
-- readable by anyone signed in, a cheer on a task already becomes a
-- notification, and the client already knows how to draw somebody else's week.
--
-- Two things are missing, and this migration is both of them.

-- ─── 1. Whose profile you may read ────────────────────────────────────────
--
-- `profiles_select` exposes you and the people you share a circle with, which
-- is right for humans and is exactly why a stranger renders as "Someone": the
-- task is visible, the name behind it is not. A feed of people all called
-- Someone is the reason no global feed could be built out of real rows.
--
-- A bot has no privacy interest to weigh — it exists to be read by strangers,
-- and that is the whole of its purpose — so it is named explicitly rather than
-- by opening the policy to anyone with an `aud = 'everyone'` task. Human
-- visibility is untouched: the circle rule is still the only way one person
-- reads another.

alter table public.profiles
  add column is_bot boolean not null default false;

comment on column public.profiles.is_bot is
  'Openly fictional account, readable by everyone. Written by a job, never signed into.';

drop policy profiles_select on public.profiles;

create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or is_bot
    or private.shares_circle_with(id)
  );

-- Nobody may promote themselves.
--
-- `profiles_update` is scoped to your own row, which is the wrong question
-- here: it is your own row you would edit to claim you are a bot, and the
-- policy above would then publish your name and your handle to every account
-- on the service. RLS decides which rows; this is a column, so the column
-- grant is what decides it.
--
-- The table-level UPDATE goes and comes back naming the one field the client
-- actually writes — `profile.update` in the transport sets `name` and nothing
-- else. A table-level grant covers every column and cannot be partly revoked,
-- so it has to be replaced rather than trimmed. `handle` is left out for the
-- same reason it always was: the signup trigger writes it once and no screen
-- offers to change it.

revoke update on public.profiles from authenticated;
grant update (name) on public.profiles to authenticated;

-- ─── 2. A cheer a bot is allowed to give ──────────────────────────────────
--
-- Bots cheer public posts, which means a fictional name lands in a real
-- person's bell — the surface where what is written has to be true. The job
-- that does it runs as `service_role` and so bypasses RLS entirely, which is
-- the same as saying the audience model does not apply to it. Left there, a
-- bug in a scheduled script could cheer a task set to 'private', and the owner
-- would learn that a stranger had read it.
--
-- So the rule the job must not be trusted with lives here instead. It is the
-- narrowest thing that can be granted: this actor really is a bot, this task
-- really is public, and the reaction it writes is a cheer.
--
-- In `public` because that is the only schema the Data API exposes, and the
-- job reaches the database through it — `join_circle_by_code` and
-- `create_circle` live there for the same reason. Postgres grants EXECUTE to
-- PUBLIC on every new function, so a SECURITY DEFINER function in `public` is
-- an open endpoint until told otherwise; the revoke below is not tidiness.
--
-- A signed-in human calling this would be writing a reaction under someone
-- else's name. The ordinary `reactions_insert` policy is how people cheer.

create or replace function public.bot_cheer(bot uuid, target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = bot and p.is_bot) then
    raise exception 'not a bot: %', bot using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from public.tasks t where t.id = target and t.aud = 'everyone'
  ) then
    raise exception 'not a public task: %', target using errcode = 'check_violation';
  end if;

  -- Already cheered is not an error. The job is a schedule, and a schedule
  -- that has run twice is the normal case rather than a fault.
  insert into public.reactions (actor_id, target_type, target_id, kind)
  values (bot, 'task', target, 'cheer')
  on conflict do nothing;
end;
$$;

revoke execute on function public.bot_cheer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.bot_cheer(uuid, uuid) to service_role;
