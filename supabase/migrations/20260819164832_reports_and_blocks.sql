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

  -- `subject_kind` deliberately omits 'avatar'. When this ran, profile photos did
  -- not exist; they landed the same day in `20260819194501_avatars.sql`, and the
  -- omission outlived the reason for it. It holds now on different ground: an
  -- avatar is screened by `screen-image` before any other account can see it, and
  -- one that gets past that is reported as the 'profile' it is drawn on. A fourth
  -- kind would route nothing anywhere new.
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

-- The other half of "a block you cannot find is a block you cannot lift".
--
-- `blocks_select` lets you read your own list, but a list of uuids is not a
-- list of people: `profiles_select` guards on `block_between`, which is
-- symmetric, so the moment you block someone their name stops resolving — for
-- you as well — and the Settings screen that offers to unblock them can only
-- draw an identifier nobody recognises. This is the narrowest thing that fixes
-- it: one question, "is this person on *my* list", asked separately from the
-- symmetric one.
--
-- Deliberately asymmetric, and that asymmetry is the point. The blocker can
-- resolve the name of someone they blocked, because they chose them and
-- already knew who they were. The blocked party gets nothing back: there is no
-- branch anywhere that reads the blocker's row, so this cannot be used to
-- discover that you have been blocked.
create or replace function private.i_blocked(other_profile uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where blocker_id = (select auth.uid()) and blocked_id = other_profile
  );
$$;

revoke execute on function private.i_blocked(uuid) from public, anon;
grant execute on function private.i_blocked(uuid) to authenticated;

-- ─── the six SELECT policies that expose other people ─────────────────────
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
--
-- ─── a coupling, found by mutation testing and written down here ──────────
--
-- Folding the ownership branch *inside* the guard, and folding the `is_bot`
-- branch inside it, are both no-ops today. Mutation testing tried each and no
-- test failed. That is not because the tests are weak — it is because
-- `block_between` can never be true for either pair: `blocks_not_self` forbids
-- a self-row, and `block_person` refuses bots, so neither a self nor a bot can
-- appear in `blocks` at all.
--
-- So the safety of those two branches is *incidental* to invariants enforced
-- elsewhere, not structural to these policies. Both invariants are themselves
-- tested — removing the bot refusal fails `refuses a bot, loudly`. But if
-- either is ever relaxed, these branches stop being decorative and start being
-- load-bearing, and no test will say so at the moment it changes.
--
-- Keep them outside the guard. The cost is nothing; the alternative is a policy
-- whose correctness depends on a constraint three hundred lines away.

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
--
-- Symmetry means this runs in the other direction as well, and that deserves
-- saying out loud rather than being discovered: because the guard is on the
-- author and the block matches either way round, a note *you* write to someone
-- you have blocked is silently withheld from them too. That is the intended
-- behaviour — a block is not a filter on your inbox, it is an end to the
-- exchange — but it is the one case where the person kept in the dark is the
-- one who asked for the block. Nothing in the app claims the note was
-- delivered; the row simply stops being readable by its recipient.
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

-- `task_pairs` is the sixth, and it is not a mechanical addition either: it is
-- the one place where blocking somebody left *residual state* behind. After the
-- change above, a blocked person's `private` task disappears; without this,
-- their row on that task — including whether they ticked it — did not, so their
-- progress went on being readable through a table nobody thinks of as content.
--
-- Amended rather than exempted, unlike `week_rollups` below. The exemption
-- there rests on a rollup being a circle aggregate that must read the same for
-- every member; a pair row is one named person's progress on one task, so there
-- is no consistency argument for keeping it, and hiding it costs nothing.
drop policy task_pairs_select on task_pairs;
create policy task_pairs_select on task_pairs for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (not private.block_between(profile_id) and private.can_see_task(task_id))
  );

-- The `is_bot` branch stays outside the guard deliberately. Bots cannot be
-- blocked — `block_person` below refuses them outright, so this is an
-- invariant rather than a statement about which buttons exist — and that
-- branch is what lets a brand-new account with no circle render the Oz bots by
-- name instead of a screen full of "Someone". Guarding it would cost a
-- first-run experience and buy nothing.
--
-- `i_blocked` is a third unguarded branch, for the block list. It widens
-- profile visibility only to people you personally blocked, which is to say
-- only to people you had already identified well enough to block.
drop policy profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated
  using (
    id = (select auth.uid())
    or is_bot
    or private.i_blocked(id)
    or (not private.block_between(id) and private.shares_circle_with(id))
  );

-- ─── notifications: the actor is in the payload ───────────────────────────
--
-- This one needed reading rather than pattern-matching. `notifications` has no
-- actor column: `recipient_id` is the only profile reference on the table, and
-- the person who caused the row is in `payload ->> 'actor_id'`, written by
-- `private.notify_on_reaction` (20260813004523) as a `jsonb_build_object`.
--
-- That is still cleanly expressible, so it is filtered rather than skipped —
-- but a `jsonb` key is not a typed column, and the cast has to be treated like
-- what it is: a parse of text that something else chose.
--
-- Hence the shape test rather than a null test. `authenticated` cannot write
-- this table (no INSERT policy, no INSERT grant), but `service_role` can and
-- the edge functions hold that key, so the day a job writes `'system'` or an
-- empty string into `actor_id` the cast raises *invalid input syntax for type
-- uuid* — and because this is a policy, the error is not one bad row hidden,
-- it is that recipient's entire notification feed failing to load. A privacy
-- filter that can take down a screen is worse than the leak it prevents.
--
-- `case` rather than `or`, and that is load-bearing too: Postgres does not
-- promise to evaluate the arms of an `or` left to right, so a regex guard sat
-- beside the cast can be reordered behind it and stop guarding anything.
-- `case` is the one construct that guarantees the untaken arm is not
-- evaluated. Anything that is not a uuid — absent, malformed, a sentinel —
-- falls to `true` and stays visible, because a row we cannot attribute is a
-- row we have no grounds to hide.
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
    and case
          when coalesce(payload ->> 'actor_id', '') ~
               '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            then not private.block_between((payload ->> 'actor_id')::uuid)
          else true
        end
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

  -- Bots are not blockable, and this is what makes `profiles_select`'s
  -- unguarded `is_bot` branch true rather than merely conventional. A block on
  -- a bot would be an incoherent half-state: its tasks and cheers would vanish
  -- while its name went on rendering to everyone, including you, because that
  -- branch is deliberately outside the guard. Refused loudly — a caller that
  -- offers this has a bug, and a silent no-op would hide it behind a control
  -- that looked like it worked.
  if exists (select 1 from public.profiles where id = p_blocked and is_bot) then
    raise exception 'cannot block a bot' using errcode = 'invalid_parameter_value';
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

-- And from `service_role`, which is the half of that default this file first
-- got wrong. Revoking from two client roles left the third holding `Dxtm` on
-- `reports` — TRUNCATE included — granted by the same default and by nobody's
-- decision. `service_role` is not reachable from a client, but it is the key
-- the edge functions carry, and TRUNCATE on the moderation evidence table is
-- one stray statement away from erasing every report anyone has ever filed.
-- Nothing reads this table yet, so there is nothing to keep.
revoke all on public.reports from service_role;

-- Then exactly one privilege back. A policy decides which rows; the grant
-- decides whether the table is reachable at all, so `blocks` needs this line
-- for `blocks_select` to mean anything — and `reports`, correspondingly, needs
-- no line at all.
grant select on public.blocks to authenticated;

-- `blocks` is granted to `service_role` because the push delivery job has the
-- same question the policies do — whether to send — and it runs with RLS
-- bypassed but still needs the table to be reachable.
grant all on public.blocks to service_role;

-- `reports` therefore holds exactly one privilege set: `postgres`, the owner.
-- No role a client or an edge function can act as reaches it at all. The queue
-- is a person with database access, reading it as the owner. When a moderation
-- job exists, `grant select, update on public.reports to service_role` is the
-- line to add — a decision somebody makes, rather than a privilege that was
-- already lying there because a platform default handed it over.

comment on table public.blocks is
  'Symmetric mutes. Written only through block_person/unblock_person; a row hides content in both directions via private.block_between. Does not remove anyone from a circle.';

comment on table public.reports is
  'What people reported, and what came of it. Readable by nobody: RLS on, no policy, no grant. Written only through report_content.';
