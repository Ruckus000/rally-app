-- Two tables for the two things a person needs when someone else is the
-- problem: a way to tell us, and a way to stop seeing them.
--
-- They are opposite postures on purpose.
--
-- `blocks` is *yours*. You wrote it, you can read it, and the app has to show
-- you the list to let you undo it — a block you cannot find is a block you
-- cannot lift. So it gets a SELECT policy scoped to the blocker and a SELECT
-- grant, and nothing else: both writes go through RPCs below, the way
-- `device_tokens` does, so nobody can insert a row naming somebody else as the
-- blocker.
--
-- `reports` is readable by *nobody*. Not by the reporter, not by the subject,
-- not by `authenticated` at all. A readable report table is a list of who
-- accused whom, and that list is more dangerous than the reports are useful:
-- the one thing a person filing a report is owed is that the person they filed
-- it about cannot find out. RLS on with no policy is the whole access rule —
-- the same shape as `goal_ratings` and `bot_goal_candidates`, and the reason
-- `docs/backend.md` has a paragraph explaining that advisor INFO.
--
-- ─── why `blocks_not_self` ────────────────────────────────────────────────
--
-- `private.block_between` below is symmetric: it matches a row where you are
-- the blocker *or* the blocked. A self-row satisfies both halves at once, so
-- `block_between(me)` would return true and every policy amended in this file
-- would stop showing you your own tasks, your own notes and your own cheers.
-- The check constraint is not tidiness — it is what keeps the helper from
-- being able to erase the caller from their own app. The RPC cannot write one
-- either, but a constraint holds for writes nobody has thought of yet.

create table blocks (
  blocker_id  uuid not null references profiles (id) on delete cascade,
  blocked_id  uuid not null references profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),

  -- The pair is the row. Blocking twice is not a second fact, which is what
  -- lets `block_person` be `on conflict do nothing` rather than a read
  -- followed by a write that can race with itself.
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

-- The primary key already serves "who have I blocked". Symmetry means every
-- policy check also asks "who has blocked me", which reads the other column.
create index blocks_blocked_idx on blocks (blocked_id);

create table reports (
  id            uuid primary key default gen_random_uuid(),
  reporter_id   uuid not null references profiles (id) on delete cascade,

  -- `subject_kind` deliberately omits 'avatar'. Profile photos do not exist in
  -- this app, so permitting a value nothing can produce would be a comment
  -- pretending to be a check — it would read as though the moderation queue
  -- handles images, and the first person to believe that would be wrong.
  subject_kind  text not null,

  -- Not a foreign key, because it points at three different tables depending
  -- on `subject_kind`, and because a report has to survive the thing it is
  -- about: deleting the note is frequently the outcome, and a cascade would
  -- delete the evidence at the moment it was acted on.
  subject_id    uuid not null,
  reason        text not null,
  created_at    timestamptz not null default now(),

  -- Both null until a human looks. `resolution` is free text on purpose: there
  -- is no moderation tool yet, and inventing an enum for a workflow nobody has
  -- run would be guessing at the states.
  resolution    text,
  resolved_at   timestamptz,

  constraint reports_kind_known check (subject_kind in ('task', 'note', 'profile')),
  constraint reports_reason_known check (
    reason in ('harassment', 'spam', 'sexual', 'violence', 'self_harm', 'other')
  )
);

-- The only query anyone will ever run against this: what is still open, oldest
-- first. Partial, because a resolved report is history and history is not the
-- queue.
create index reports_open_idx on reports (created_at) where resolved_at is null;

alter table blocks  enable row level security;
alter table reports enable row level security;

-- ─── the visibility helper ────────────────────────────────────────────────
--
-- Symmetric, and that is the decision this whole file turns on. A one-way
-- block hides them from you and leaves them free to keep cheering your tasks
-- and writing notes on them — which is the exact behaviour the control exists
-- to stop. So one row hides the content in both directions.
--
-- The honest cost of symmetry: a block is *implicitly* discoverable. Their
-- cheers stop landing, your name stops appearing, and an attentive person can
-- infer what happened. The app never says so — there is no screen, no
-- notification and no error that names a block — but the inference is
-- available and pretending otherwise would be the wrong thing to write down.
-- The alternative, a block they cannot notice, is a block that does not work.
--
-- SECURITY DEFINER and STABLE for the same reasons as the four helpers in
-- `init.sql`: policies on `blocks` would otherwise be consulted from inside a
-- policy, and the planner needs to know it can call this once per row rather
-- than once per comparison.
create or replace function private.block_between(other_profile uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = (select auth.uid()) and blocked_id = other_profile)
       or (blocked_id = (select auth.uid()) and blocker_id = other_profile)
  );
$$;

-- An RLS policy is evaluated as the *calling* role, so `authenticated` must
-- hold EXECUTE on any helper a policy calls — see section 1b of
-- `20260811025743_repair_write_paths.sql`, which took this grant back out of
-- the revoke that `init.sql` ended with. `anon` evaluates none of these
-- policies (every one is `to authenticated`) and gets nothing.
revoke execute on function private.block_between(uuid) from public, anon;
grant execute on function private.block_between(uuid) to authenticated;

-- ─── the five SELECT policies that expose other people ────────────────────
--
-- Every one keeps its ownership branch first and unguarded. A block must never
-- hide your own work from you, and putting `owner_id = auth.uid()` outside the
-- guard is what guarantees that even if `block_between` were somehow true of
-- yourself. Nothing else about visibility changes: for two people with no
-- block between them, `block_between` is false and each policy reduces exactly
-- to what it said before.
--
-- Blocking is retroactive, and that falls out of the shape rather than being
-- arranged: the guard tests the *author*, not a timestamp, so notes and cheers
-- written before the block are hidden too. There is no moment after which the
-- old content becomes visible again except unblocking.

drop policy tasks_select on tasks;
create policy tasks_select on tasks for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      not private.block_between(owner_id)
      and (
        aud = 'everyone'
        or (aud = 'friends' and private.shares_circle_with(owner_id))
        or (aud = 'private' and private.is_paired_on(id))
      )
    )
  );

-- The `recipient_id` branch moves *inside* the guard, which is the one
-- non-mechanical bit here. A note addressed to you by someone you blocked is
-- precisely the delivery this control exists to stop; leaving that branch
-- outside would have let a blocked person keep writing to you.
drop policy notes_select on notes;
create policy notes_select on notes for select to authenticated
  using (
    author_id = (select auth.uid())
    or (
      not private.block_between(author_id)
      and (
        recipient_id = (select auth.uid())
        or (task_id is not null and private.can_see_task(task_id))
      )
    )
  );

drop policy reactions_select on reactions;
create policy reactions_select on reactions for select to authenticated
  using (
    actor_id = (select auth.uid())
    or (
      not private.block_between(actor_id)
      and (
        (target_type = 'task' and private.can_see_task(target_id))
        or target_type = 'post'
      )
    )
  );

-- The `is_bot` branch stays outside the guard deliberately. Bots cannot be
-- blocked — nothing offers it, and there is nobody on the other end to be
-- protected from — and that branch is what lets a brand-new account with no
-- circle render the Oz bots by name instead of a screen full of "Someone".
-- Guarding it would cost a first-run experience and buy nothing.
drop policy profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated
  using (
    id = (select auth.uid())
    or is_bot
    or (not private.block_between(id) and private.shares_circle_with(id))
  );

-- ─── notifications: the actor is in the payload ───────────────────────────
--
-- This one needed reading rather than pattern-matching. `notifications` has no
-- actor column: `recipient_id` is the only profile reference on the table, and
-- the person who caused the row is in `payload ->> 'actor_id'`, written by
-- `private.notify_on_reaction` (20260813004523) as a `jsonb_build_object`.
--
-- That is still cleanly expressible, so it is filtered rather than skipped. Two
-- things make the cast safe:
--
--   * `notifications` has no INSERT policy and no INSERT grant to any client.
--     Every row in it was written by that one SECURITY DEFINER trigger, which
--     casts a `uuid` column into the object. There is no path by which a
--     client puts arbitrary text in that key, so `::uuid` cannot be handed
--     something unparseable.
--   * `payload ->> 'actor_id' is null` is tested first, so kinds that carry no
--     actor — anything added later that is not a cheer — pass through visible
--     instead of disappearing on a null cast.
--
-- `recipient_id = auth.uid()` is still an AND rather than an OR here, unlike
-- the policies above: these rows are addressed *to* you, so the ownership test
-- is the base predicate and the block narrows it. There is no branch of this
-- policy that shows you anybody else's feed, so nothing of your own is at risk
-- of being hidden.
drop policy notifications_select on notifications;
create policy notifications_select on notifications for select to authenticated
  using (
    recipient_id = (select auth.uid())
    and (
      payload ->> 'actor_id' is null
      or not private.block_between((payload ->> 'actor_id')::uuid)
    )
  );

-- ─── week_rollups is left alone, and that is a decision ───────────────────
--
-- `week_rollups_select` exposes other people's rows — yours, and anyone you
-- share a circle with — so it looks like the sixth policy in the list above.
-- It is deliberately not filtered, and this comment exists so that a later
-- reader does not "fix" the omission.
--
-- Blocking someone does not remove them from your circle; it hides what they
-- say. A rollup is not something they said, it is a number the circle's
-- arithmetic is made of, and filtering it would make circle totals per-viewer
-- rather than per-circle: two members of the same circle would see different
-- answers to "how did we do this week", and neither would be wrong. Leaving
-- someone out of the maths is a different feature — leaving the circle — and
-- it belongs on that control, not this one.

-- ─── the three RPCs ───────────────────────────────────────────────────────
--
-- All three follow `register_device`: SECURITY DEFINER so the write happens as
-- the function's owner on tables the client is granted nothing on, an empty
-- `search_path` so every name resolves explicitly, and `auth.uid()` read
-- *inside* rather than taken as an argument — an actor you accept as a
-- parameter is an actor the caller chooses.

create or replace function public.report_content(
  p_subject_kind text,
  p_subject_id uuid,
  p_reason text
)
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

  -- Deliberately not deduplicated. Reporting the same thing twice is a signal
  -- — it usually means it happened again, or that nothing visibly came of the
  -- first one — and an `on conflict do nothing` here would make the app look
  -- like it did nothing while telling the user it had. The volume is somebody
  -- reading a queue; it is not a cost worth trading that against.
  insert into public.reports (reporter_id, subject_kind, subject_id, reason)
  values (me, p_subject_kind, p_subject_id, p_reason);
end;
$$;

create or replace function public.block_person(p_blocked uuid)
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

  -- Idempotent: blocking someone you have already blocked is a no-op rather
  -- than an error the client has to know how to swallow. The `blocks_not_self`
  -- constraint still bites if `p_blocked` is you, which is a bug in the caller
  -- and should be loud.
  insert into public.blocks (blocker_id, blocked_id)
  values (me, p_blocked)
  on conflict do nothing;
end;
$$;

create or replace function public.unblock_person(p_blocked uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Scoped to your own row. Without the `blocker_id` filter this function
  -- would let anyone lift anyone else's block on them — the one operation a
  -- blocked person would most like to perform, handed over by omission.
  delete from public.blocks
  where blocker_id = auth.uid() and blocked_id = p_blocked;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, so a SECURITY
-- DEFINER function in `public` is an open endpoint until told otherwise. All
-- three write as their owner; `anon` must not reach any of them.
revoke execute on function public.report_content(text, uuid, text) from public, anon;
revoke execute on function public.block_person(uuid) from public, anon;
revoke execute on function public.unblock_person(uuid) from public, anon;
grant execute on function public.report_content(text, uuid, text) to authenticated;
grant execute on function public.block_person(uuid) to authenticated;
grant execute on function public.unblock_person(uuid) to authenticated;

-- ─── one policy on `blocks`, none on `reports` ────────────────────────────
--
-- Read your own list, so the app can draw it and offer to undo it. No INSERT
-- and no DELETE policy: both go through the RPCs above, which is what stops a
-- row naming you as the *blocked* party from being written by anyone but you.
create policy blocks_select on blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

-- Start both tables from nothing, explicitly, rather than trusting that
-- `20260815225639_device_tokens.sql` — which ended the default privilege
-- handing `anon` and `authenticated` a grant on every new table in `public` —
-- covered these two. That default carried TRUNCATE, and **TRUNCATE ignores row
-- security entirely**: a role holding it can empty the table in one statement
-- and no policy in this file has any bearing on it.
revoke all on public.blocks  from anon, authenticated;
revoke all on public.reports from anon, authenticated;

-- Then exactly one privilege back. A policy decides which rows; the grant
-- decides whether the table is reachable at all, so `blocks` needs this line
-- for `blocks_select` to mean anything — and `reports`, correspondingly, needs
-- no line at all.
grant select on public.blocks to authenticated;

-- `blocks` is granted to `service_role` because the push delivery job has the
-- same question the policies do — whether to send — and it runs with RLS
-- bypassed but still needs the table to be reachable.
grant all on public.blocks to service_role;

-- `reports` gets no grant, to any role, on purpose. Nothing automated reads it
-- yet; the queue is a person with database access, who reaches it as the table
-- owner. When a moderation job exists, `grant select, update on public.reports
-- to service_role` is the line to add — and adding it should be a decision
-- somebody makes, not a privilege that was already lying there.

comment on table public.blocks is
  'Symmetric mutes. Written only through block_person/unblock_person; a row hides content in both directions via private.block_between. Does not remove anyone from a circle.';

comment on table public.reports is
  'What people reported, and what came of it. Readable by nobody: RLS on, no policy, no grant. Written only through report_content.';
