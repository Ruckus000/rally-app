-- ─── Deleting an account, part one: scheduling it, and disappearing ───────
--
-- App Store Guideline 5.1.1(v) requires deletion to be initiated inside the
-- app. This is the half that runs when the button is pressed; the purge that
-- finishes the job fourteen days later is a separate migration and a separate
-- function, because one of them has to reach storage and Apple over HTTP and
-- SQL can do neither.
--
-- The shape is a grace period, not a hard delete, and the reason is the shape
-- of this app's accounts rather than a preference. `canSecure()` is false off
-- iOS, so every Android account is permanently anonymous, and nothing but the
-- live session holds its uuid. A hard delete on a mistaken tap is
-- unrecoverable for most of the people who could make it. So `deleted_at` is
-- set, everything the account owns stops being readable by anyone else, and
-- fourteen days later it is destroyed for good. Until then the device that
-- scheduled it can put it back.
--
-- The account keeps seeing *itself* throughout. That is not a courtesy; it is
-- the mechanism. The way back reads the caller's own profile row, so every
-- branch below that tests `= auth.uid()` stays outside the new guard for the
-- same reason the block migration kept ownership branches outside its own.

-- ─── 1. The column ────────────────────────────────────────────────────────
--
-- Null means live, which makes the common case the cheap one: every policy
-- below asks "is this person gone", and for all but a handful of rows in the
-- table the answer is a null test.

alter table public.profiles
  add column deleted_at timestamptz;

comment on column public.profiles.deleted_at is
  'When deletion was requested. Null means live. Written only by schedule_account_deletion / cancel_account_deletion; read by private.account_gone and by the purge.';

-- Partial, because the purge scan is the only query that reads this column as
-- a range and it only ever wants the non-null side. A full index here would be
-- one entry per account to answer a question about a handful of them.
create index profiles_deleted_at_idx on public.profiles (deleted_at)
  where deleted_at is not null;

-- ─── 2. The predicate ─────────────────────────────────────────────────────
--
-- SECURITY DEFINER and STABLE for the reasons the four helpers in `init.sql`
-- give and `block_between` repeats: `profiles_select` would otherwise be
-- consulted from inside the policies that call this, and the planner needs to
-- know it can be called once per row rather than once per comparison.
--
-- Deliberately *not* folded into `private.block_between`, which is threaded
-- through exactly the same call sites and would have been a tempting place to
-- put it. The two mean different things. A function named for blocking that
-- also returned true when somebody deleted their account would be lying about
-- its own name, and `blocks_select` and `i_blocked` read the same table on the
-- assumption that it is not.
create or replace function private.account_gone(other_profile uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = other_profile and deleted_at is not null
  );
$$;

-- An RLS policy is evaluated as the calling role, so `authenticated` must hold
-- EXECUTE on any helper a policy calls. Same grant, same reason, as
-- `block_between` — see section 1b of `20260811025743_repair_write_paths.sql`.
revoke execute on function private.account_gone(uuid) from public, anon;
grant execute on function private.account_gone(uuid) to authenticated;

-- ─── 3. The SELECT policies ───────────────────────────────────────────────
--
-- The same six that `20260819164832_reports_and_blocks.sql` threaded
-- `block_between` through, plus three it exempted or had no reason to touch.
-- Every one keeps its ownership branch first and unguarded, for that
-- migration's reason and one more: an account in its grace period has to go on
-- reading its own rows or there is nothing to put back.
--
-- Two departures from mechanical pattern-matching are marked where they occur.

-- `aud = 'everyone'` is why this could not be done by teaching
-- `shares_circle_with` about deleted accounts and stopping there. A public
-- goal is readable by every signed-in account without consulting any circle,
-- so a guard on the circle helper would have left a deleted person's public
-- goals on the service's shared feed. The guard has to be here, wrapping all
-- three audience branches at once.
drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      not private.account_gone(owner_id)
      and not private.block_between(owner_id)
      and (
        aud = 'everyone'
        or (aud = 'friends' and private.shares_circle_with(owner_id))
        or (aud = 'private' and private.is_paired_on(id))
      )
    )
  );

drop policy notes_select on public.notes;
create policy notes_select on public.notes for select to authenticated
  using (
    author_id = (select auth.uid())
    or (
      not private.account_gone(author_id)
      and not private.block_between(author_id)
      and (
        recipient_id = (select auth.uid())
        or (task_id is not null and private.can_see_task(task_id))
      )
    )
  );

drop policy reactions_select on public.reactions;
create policy reactions_select on public.reactions for select to authenticated
  using (
    actor_id = (select auth.uid())
    or (
      not private.account_gone(actor_id)
      and not private.block_between(actor_id)
      and (
        (target_type = 'task' and private.can_see_task(target_id))
        or target_type = 'post'
      )
    )
  );

drop policy task_pairs_select on public.task_pairs;
create policy task_pairs_select on public.task_pairs for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (
      not private.account_gone(profile_id)
      and not private.block_between(profile_id)
      and private.can_see_task(task_id)
    )
  );

drop policy task_media_select on public.task_media;
create policy task_media_select on public.task_media for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      state = 'ready'
      and not private.account_gone(owner_id)
      and not private.block_between(owner_id)
      and private.can_see_task(task_id)
    )
  );

-- `is_bot` stays outside the guard because a bot has no `auth.users` row and
-- therefore no way to be gone — the branch is unreachable rather than
-- exempted. `i_blocked` stays outside for the asymmetry its own migration
-- argues for: you blocked this person, so you already knew who they were, and
-- guarding it would leave the Settings screen offering to unblock a uuid
-- nobody recognises for a fortnight.
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or is_bot
    or private.i_blocked(id)
    or (
      not private.account_gone(id)
      and not private.block_between(id)
      and private.shares_circle_with(id)
    )
  );

-- ─── week_rollups: guarded here, and it was exempted from blocking ────────
--
-- The first departure, and it needs stating because the previous migration
-- left this policy alone on purpose and said so.
--
-- The block exemption rests entirely on a rollup being circle arithmetic that
-- must read the same for every member: filtering it per-viewer would make two
-- people in one circle get different answers to "how did we do this week", and
-- neither would be wrong. That argument does not transfer. A deletion is not a
-- per-viewer opinion — the account is gone for everybody at once, so the
-- totals stay consistent across the circle however this reads.
--
-- And the alternative is worse than an inconsistent total. Leaving the numbers
-- of a deleted account on the ranked list, with its name no longer resolving,
-- puts a permanent nameless ghost in the circle scoring exactly the person who
-- asked to be removed from it.
drop policy week_rollups_select on public.week_rollups;
create policy week_rollups_select on public.week_rollups for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (
      not private.account_gone(profile_id)
      and private.shares_circle_with(profile_id)
    )
  );

-- The roster. `is_circle_member` asks about the *caller*, so it cannot carry
-- this on its own — the guard is on the row's subject. Your own membership row
-- stays readable, which is what keeps you in your own circle while you decide.
drop policy circle_members_select on public.circle_members;
create policy circle_members_select on public.circle_members for select to authenticated
  using (
    private.is_circle_member(circle_id)
    and (
      profile_id = (select auth.uid())
      or not private.account_gone(profile_id)
    )
  );

-- The actor is in the payload, not in a column. Everything about the `case`,
-- the shape test and the fall-through to `true` is
-- `20260819164832_reports_and_blocks.sql`'s reasoning unchanged — a `jsonb`
-- key is a parse of text something else chose, and a policy that raises turns
-- one hidden row into an entire notification feed failing to load. The only
-- change is a second question asked in the same arm.
drop policy notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (
    recipient_id = (select auth.uid())
    and case
          when coalesce(payload ->> 'actor_id', '') ~
               '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            then not private.account_gone((payload ->> 'actor_id')::uuid)
             and not private.block_between((payload ->> 'actor_id')::uuid)
          else true
        end
  );

-- ─── 4. `can_see_task`, which the policies above lean on ──────────────────
--
-- The second departure. `tasks_select` inlines the audience model; the notes,
-- reactions, pairs and media policies delegate to this function instead. Guard
-- only the policy and the two answers diverge: a live person's note on a
-- deleted person's goal would stay readable through `can_see_task` after the
-- goal itself had stopped being.
--
-- This is the one place where doing it twice is right rather than repetitive.
-- The function's name is a question about a task, and "no, because the person
-- who wrote it deleted their account" is a true answer to that question, not a
-- second concern smuggled into it.
create or replace function private.can_see_task(target_task uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = target_task
      and (
        t.owner_id = (select auth.uid())
        or (
          not private.account_gone(t.owner_id)
          and (
            t.aud = 'everyone'
            or (t.aud = 'friends' and private.shares_circle_with(t.owner_id))
            or (t.aud = 'private' and private.is_paired_on(t.id))
          )
        )
      )
  );
$$;

-- ─── 5. A scheduled account may not write ─────────────────────────────────
--
-- Invisibility is not the same as gone, and the gap between them is fourteen
-- days long. The device is wiped to onboarding when deletion is scheduled, so
-- the app itself cannot write — but the session is deliberately left on disk
-- so the way back works, and a session on disk is a bearer token somebody
-- could use against the API directly.
--
-- Refusing the write is the difference between an account that is hidden and
-- an account that is being deleted. Reads are left alone: the way back has to
-- be able to see what it is putting back.
--
-- `with check` only. A `using` clause here would block deletes too, and a
-- scheduled account removing its own rows early is the direction of travel.

drop policy tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and not private.account_gone((select auth.uid()))
  );

drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and not private.account_gone((select auth.uid()))
  );

-- These two restate `20260811142948_tighten_realtime_and_notes.sql` in full,
-- with one clause added. Restating a policy replaces it outright, so writing
-- out the `init.sql` version plus a new guard would silently revert the
-- migration that stopped a stranger addressing a note to anybody on the
-- service — which is what the first draft of this file did, and what
-- `integration/rls/notes.test.ts` and `reactions.test.ts` caught.
drop policy notes_insert on public.notes;
create policy notes_insert on public.notes for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and not private.account_gone((select auth.uid()))
    and (
      (recipient_id is not null and (
        recipient_id = (select auth.uid())
        or private.shares_circle_with(recipient_id)
      ))
      or (task_id is not null and private.can_see_task(task_id))
    )
  );

drop policy reactions_insert on public.reactions;
create policy reactions_insert on public.reactions for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and not private.account_gone((select auth.uid()))
    and (target_type <> 'task' or private.can_see_task(target_id))
  );

-- ─── 6. The two RPCs ──────────────────────────────────────────────────────
--
-- Both follow the house style stated at `20260819164832_reports_and_blocks.sql`
-- section "the three RPCs": SECURITY DEFINER so the write happens as the
-- function's owner, an empty `search_path` so every name resolves explicitly,
-- and `auth.uid()` read *inside* rather than taken as an argument — an actor
-- you accept as a parameter is an actor the caller chooses.
--
-- Neither takes the account as a parameter and neither ever will. This is the
-- one pair of functions on the service that destroys a person's history; a
-- uuid argument here would let any signed-in account schedule the deletion of
-- any other.

create or replace function public.schedule_account_deletion()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  already timestamptz;
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- Idempotent, and it returns the *original* timestamp rather than moving it.
  -- A second call is a retry — the client runs this inline rather than through
  -- the outbox, so a flaky connection produces exactly that — and a retry that
  -- silently extended the grace period by another fortnight would be a way to
  -- keep an account alive forever by tapping the button once a week.
  select deleted_at into already from public.profiles where id = me;
  if already is not null then
    return already;
  end if;

  update public.profiles set deleted_at = now() where id = me;
  return (select deleted_at from public.profiles where id = me);
end;
$$;

comment on function public.schedule_account_deletion() is
  'Marks the calling account for deletion and returns when the clock started. Idempotent: a second call returns the first call''s timestamp rather than restarting the grace period.';

create or replace function public.cancel_account_deletion()
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

  -- No error when nothing was scheduled. The way back is reached from a screen
  -- that may have been left open while the purge ran, or opened by somebody
  -- who never scheduled anything, and neither is a fault worth a red banner —
  -- the state the caller wants is the state they end up in either way. An
  -- account already purged has no row here to update, so this affects nothing.
  update public.profiles set deleted_at = null where id = me;
end;
$$;

comment on function public.cancel_account_deletion() is
  'Clears a pending deletion for the calling account. A no-op when none was scheduled.';

-- Postgres grants EXECUTE to PUBLIC on every new function, so a SECURITY
-- DEFINER function in `public` is an open endpoint until told otherwise.
-- `20260820210000_pull_world_execute.sql` is an entire migration fixing three
-- earlier ones that granted without revoking first.
revoke execute on function public.schedule_account_deletion() from public, anon;
grant execute on function public.schedule_account_deletion() to authenticated;

revoke execute on function public.cancel_account_deletion() from public, anon;
grant execute on function public.cancel_account_deletion() to authenticated;
