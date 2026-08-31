-- A goal belongs to the circle it was staked in.
--
-- `aud = 'friends'` has always meant `shares_circle_with(owner_id)` — *anyone
-- who shares any circle with me*. With one circle per person that is the same
-- sentence as "my circle", which is why it has stood. It stops being the same
-- sentence the moment anybody joins a second one: every goal they have ever
-- staked at `friends` becomes visible to the new circle, retroactively, with
-- nothing on any screen saying so. That is not a feature waiting to be built.
-- It is a disclosure, and it is live today.
--
-- The product decision, in the owner's words: *people in your circle can see
-- the goals you stake within that circle; the user should be able to choose if
-- that goal is visible outside of the circle; the default is that it is only
-- visible within the circle.* So `friends` narrows to the row's own circle, and
-- `everyone` stays the way out.
--
-- `tasks.circle_id` has existed since `init.sql:57` and is indexed at `:70`.
-- Nothing has ever read it: no policy, no function, no CTE. The client omits it
-- on write (`src/sync/mappers.ts`). This migration is where the column starts
-- meaning something — which makes the backfill below the load-bearing part, not
-- the policies.
--
-- ─── what is deliberately not here ────────────────────────────────────────
--
-- `notes_select`, `reactions_select`, `task_pairs_select`, `task_media_select`
-- and `task_media_objects_select` are untouched. Every one of them delegates to
-- `private.can_see_task`, which is rewritten below, so they inherit this
-- without being restated. Restating them is the failure this repo has a rule
-- about: a migration that writes out a policy replaces it outright, and those
-- five carry hardening from `20260811142948` and `20260824090000` that a
-- careful-looking rewrite would silently drop.
--
-- `profiles_select` and `week_rollups_select` keep `shares_circle_with`, and
-- that is a decision rather than an oversight. Both are per-person records —
-- who you are, and how your week went. Sharing any circle with someone is the
-- right reason to see those. Only a *goal* belongs to a room.

-- ─── 1. The predicate ─────────────────────────────────────────────────────
--
-- Two `exists`, not a self-join, and not the existing `is_circle_member`.
--
-- `is_circle_member(circle_id)` alone would have been the obvious spelling and
-- it is a **widening**: it asks only whether the *viewer* is in the circle. Once
-- an owner leaves, their old goals in that room would stay readable by everyone
-- still in it, forever. `shares_circle_with` is two-sided and fails the moment
-- either party leaves; this keeps that property and adds the room.
--
-- `target_circle is null` makes both `exists` false with no clause of its own.
-- That is the point: NULL is closed by construction rather than by a condition
-- somebody can drop while tidying.
--
-- Cost: two exact primary-key probes on `circle_members_pkey (circle_id,
-- profile_id)`, so O(1). `shares_circle_with` scans the caller's memberships and
-- probes per row — O(k) in exactly the number this feature exists to raise. The
-- narrower predicate is also the cheaper one.
create or replace function private.shares_circle_on(target_circle uuid, other_profile uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
           select 1 from public.circle_members
            where circle_id = target_circle
              and profile_id = (select auth.uid())
         )
     and exists (
           select 1 from public.circle_members
            where circle_id = target_circle
              and profile_id = other_profile
         );
$$;

-- Postgres grants EXECUTE to PUBLIC by default. `private` is not an exposed
-- schema, but a policy resolves a function by OID and needs no schema
-- privilege, so the grant is what actually matters here.
revoke execute on function private.shares_circle_on(uuid, uuid) from public, anon;
grant  execute on function private.shares_circle_on(uuid, uuid) to authenticated;

-- ─── 2. The backfill, before the policies ─────────────────────────────────
--
-- Every task in existence has `circle_id is null`, and after the policies below
-- a null circle is owner-only. Backfilling *after* them would leave a window —
-- inside one transaction, but a window in a file somebody may one day split —
-- where every `friends` goal on the service is dark.
--
-- The owner's earliest membership, because for anyone in exactly one circle
-- that is precisely visibility-preserving, and everyone in the seed except maya
-- is in exactly one. For maya it is a choice, and "the circle you joined first"
-- is the least surprising one. No client has shipped, so the only rows this can
-- touch are development and CI data. Against real data this would need a
-- product decision instead of a default.
--
-- `joined_at` ties — `seed.sql` writes every membership in one statement and
-- `now()` is transaction time — so `circle_id` breaks it, the same ordering
-- `pull_world`'s `my_circle` uses. Two places, one rule.
--
-- Every audience, not just `friends`. An `everyone` goal still belongs to a
-- room: that is what lets a per-circle board count it later, and the `everyone`
-- branch below never consults the column anyway.
--
-- Safe to run through `tasks_lww_guard` (`20260811131531_lww_guard.sql`): the
-- trigger returns unchanged when `updated_at` is not touched, and this does not
-- touch it. No clamp, no comparison, and no realtime storm of rewritten rows.
update public.tasks t
   set circle_id = first_circle.circle_id
  from (
         select distinct on (cm.profile_id) cm.profile_id, cm.circle_id
           from public.circle_members cm
          order by cm.profile_id, cm.joined_at asc, cm.circle_id asc
       ) as first_circle
 where t.circle_id is null
   and t.owner_id = first_circle.profile_id;

-- Somebody in no circle matches nothing above and keeps `circle_id is null`,
-- so their `friends` goals are visible to them alone. That is not a new
-- outcome: `shares_circle_with(owner)` was already false for every viewer of an
-- owner with no memberships. The solo rider is not a special case in this
-- design — they fall out of it.

-- ─── 3. Writes: the column has to be true ─────────────────────────────────
--
-- Restated from `20260824090000_account_deletion.sql`, with one clause added.
--
-- `is_circle_member` here rather than `shares_circle_on`, because `owner_id =
-- auth.uid()` is already conjoined: the caller *is* the subject, and asking the
-- two-sided question would be asking whether they share a circle with
-- themselves.
drop policy tasks_insert on public.tasks;
create policy tasks_insert on public.tasks for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and not private.account_gone((select auth.uid()))
    and (circle_id is null or private.is_circle_member(circle_id))
  );

-- Restated **unchanged**, and the absence is the decision.
--
-- A `circle_id` clause here would look like the natural pair of the one above
-- and would be a bug. `WITH CHECK` sees only NEW — it cannot ask whether
-- `circle_id` moved — so it fires on every update, including a plain `done_at`
-- toggle. The moment somebody leaves a circle, every goal they staked there
-- becomes un-tickable with 42501, and the client's outbox retries a permanent
-- error at the head of the queue. Leaving a circle would jam the app.
--
-- Nor is a mis-tagged circle a capability. `shares_circle_on` checks the
-- owner's membership too, so an owner who tags a goal to a room they are not in
-- has published it to nobody. The insert check is data hygiene; the read
-- predicate is the boundary.
--
-- A trigger could ask the OLD/NEW question properly. It is not worth it here:
-- same-timing triggers fire in name order, `tasks_circle_guard` would sort
-- before `tasks_lww_guard`, and a stale losing write carrying a now-invalid
-- circle would raise instead of quietly losing — a permanently retrying queue
-- entry again. Folding the check into `tasks_lww_guard` fixes the order and
-- gives a function named for last-write-wins an authorization job.
drop policy tasks_update on public.tasks;
create policy tasks_update on public.tasks for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and not private.account_gone((select auth.uid()))
  );

-- ─── 4. Reads: friends means this room ────────────────────────────────────
--
-- Restated from `20260824090000_account_deletion.sql:89`. One line differs, and
-- everything else — the deletion guard, the block guard, the shape that wraps
-- all three audience branches at once — is carried verbatim for the reason that
-- file gives at length.
drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      not private.account_gone(owner_id)
      and not private.block_between(owner_id)
      and (
        aud = 'everyone'
        or (aud = 'friends' and private.shares_circle_on(circle_id, owner_id))
        or (aud = 'private' and private.is_paired_on(id))
      )
    )
  );

-- And the same line in the function five other policies delegate to. Restated
-- from `20260824090000_account_deletion.sql:244`, including its own deliberate
-- omission of `block_between` — the policy and the function diverge there on
-- purpose, and that argument is unaffected by this one.
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
            or (t.aud = 'friends' and private.shares_circle_on(t.circle_id, t.owner_id))
            or (t.aud = 'private' and private.is_paired_on(t.id))
          )
        )
      )
  );
$$;

comment on column public.tasks.circle_id is
  'The circle this goal was staked in. NULL is closed, not permissive: a '
  '`friends` goal with no circle is visible to its owner alone. That matters '
  'because NULL is also what a client that forgets the column writes, so a '
  'permissive NULL would be a bypass that never fails loudly. Stays nullable '
  'forever — the FK is ON DELETE SET NULL, so NOT NULL would raise at delete '
  'time rather than at DDL time, and somebody in no circle has to be able to '
  'stake.';
