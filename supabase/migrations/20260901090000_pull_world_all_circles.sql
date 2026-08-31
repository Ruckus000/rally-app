-- The pull answers with every circle you are in, and who is in each.
--
-- `my_circles` (plural) has always been unbounded, and `member_ids`, `people`,
-- `owner_tasks`, `media` and `cheer_counts` have always unioned across all of
-- them. Only the answer was singular: one `circle` key, chosen by
-- `20260831190000_one_circle_chosen_the_same_way_twice.sql` as the oldest
-- membership because it had to be chosen somehow.
--
-- Two new keys, so the client can stop choosing:
--
--   `circles`      every circle, ordered oldest first, same rule as `circle`.
--   `memberships`  a (circle_id, profile_id) edge list — who is in which.
--
-- `circle` stays, equal to `circles[0]`. An installed client reads only that
-- key, and this function is how it learns anything at all, so removing it is a
-- separate change made after the client has stopped asking.
--
-- ─── the optimisation that would break the payload ───────────────────────
--
-- `owner_tasks` stays owner-driven — `t.owner_id in (select profile_id from
-- member_ids)`. Rewriting it as a join to `memberships` looks like the natural
-- way to use the new CTE and returns a shared member's goals *twice*: once per
-- circle you share with them. A semi-join cannot duplicate; a join can. The
-- duplicate would not stay local either — `cheer_counts` and `media` both read
-- `select id from owner_tasks`, so one shared circle-mate would inflate a cheer
-- count and hand the client the same photo twice.
--
-- `memberships` is the one CTE here allowed to repeat a person, and it repeats
-- them on purpose: that is what an edge list is. Everything downstream of it
-- goes through `member_ids`, which is `distinct`.
--
-- ─── what is unchanged ───────────────────────────────────────────────────
--
-- `people`, `bots`, `notifs`, `my_tasks`, `owner_tasks`, `media`,
-- `my_reactions`, `my_notes`, `my_rollups`, `cheer_counts`. The function is
-- otherwise byte-identical to the definition it replaces, which it was
-- generated from rather than retyped.
--
-- The revoke/grant pair is restated again, for the reason
-- `20260820210000_pull_world_execute.sql` gives: it exists because three
-- migrations granted without revoking, and a `create or replace` is exactly
-- where that fix gets dropped by accident.

create or replace function public.pull_world(
  p_week_start date default null,
  p_notif_limit int default 30
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with my_circles as (
    -- `joined_at` is carried for `my_circle` below, which has to break a tie
    -- the same way on every call.
    select cm.circle_id, cm.joined_at
      from public.circle_members cm
     where cm.profile_id = (select auth.uid())
  ),
  -- The edge list, and the only place in this function a person is allowed to
  -- appear more than once. Bounded by |your circles| × |their members|, one row
  -- per (circle, person) by primary key.
  --
  -- Membership is an edge list rather than a field on `people` deliberately. A
  -- `circles` array inside each person, or a `people` CTE joined to
  -- `circle_members`, is where the fan-out gets in: somebody in two of your
  -- circles becomes two directory rows, and every count downstream doubles.
  -- Here the duplication is the answer rather than a side effect of asking.
  memberships as (
    select cm.circle_id, cm.profile_id
      from public.circle_members cm
     where cm.circle_id in (select circle_id from my_circles)
  ),
  -- Reads off `memberships` now rather than scanning `circle_members` a second
  -- time. Same rows, one fewer scan, and the `distinct` stays exactly where it
  -- was — it is what keeps a person shared between two of your circles from
  -- becoming two people.
  member_ids as (
    select distinct profile_id from memberships
  ),
  people as (
    select p.id, p.handle, p.name, p.avatar_path, p.avatar_state
      from public.profiles p
     where p.id in (select profile_id from member_ids)
        or p.id = (select auth.uid())
  ),
  bots as (
    select p.id, p.handle, p.name, p.avatar_path, p.avatar_state
      from public.profiles p
     where p.is_bot
  ),
  -- First circle only, exactly as `pullMyCircle` has always answered: the
  -- schema allows several, the UI has always shown one.
  --
  -- *Which* first is the fix. This was `limit 1` with no `order by`, which is
  -- an arbitrary row Postgres is free to choose differently on two consecutive
  -- calls — and the client keys a whole screen off it, so a name, a roster and
  -- an invite code could all change under a finger.
  --
  -- `joined_at` first, so the answer is the circle you have been in longest.
  -- `id` second because `joined_at` ties: `seed.sql` inserts every membership
  -- in one statement, and `now()` is transaction time, so every seeded
  -- membership shares a timestamp to the microsecond. Without the tiebreak this
  -- is still arbitrary, just less obviously so.
  -- Every circle, which is the new half. `joined_at` rides along so both the
  -- array and the single-circle key below sort by the same rule.
  my_circle_rows as (
    select c.id, c.name, c.invite_code, mc.joined_at
      from public.circles c
      join my_circles mc on mc.circle_id = c.id
  ),
  my_circle as (
    select r.id, r.name, r.invite_code
      from my_circle_rows r
     order by r.joined_at asc, r.id asc
     limit 1
  ),
  notifs as (
    select n.id, n.tier, n.kind, n.payload, n.read_at, n.created_at
      from public.notifications n
     where n.recipient_id = (select auth.uid())
     order by n.created_at desc
     limit p_notif_limit
  ),
  my_tasks as (
    select t.*
      from public.tasks t
     where p_week_start is not null
       and t.owner_id = (select auth.uid())
       and t.week_start = p_week_start
  ),
  -- The feed: this week's tasks belonging to circle-mates and bots. What of
  -- theirs is visible is `tasks_select`'s decision, not restated here — this
  -- only decides *whose* rows to ask about, which is the half the client
  -- legitimately owns and the half that used to cost a second round trip.
  owner_tasks as (
    select t.*
      from public.tasks t
     where p_week_start is not null
       and t.week_start = p_week_start
       and t.owner_id <> (select auth.uid())
       and t.owner_id in (
             select profile_id from member_ids
             union
             select id from bots
           )
  ),
  -- The photos on any of the goals this pull just gathered. No predicate of
  -- its own — see the header.
  media as (
    select tm.id, tm.task_id, tm.owner_id, tm.path, tm.width, tm.height, tm.state
      from public.task_media tm
     where tm.task_id in (
             select id from my_tasks
             union
             select id from owner_tasks
           )
  ),
  my_reactions as (
    select r.target_id, r.kind
      from public.reactions r
     where r.actor_id = (select auth.uid())
       and r.target_type = 'task'
  ),
  -- Notes addressed to me, and notes on my tasks — the two the client has
  -- somewhere to put. `notes_exactly_one_target` keeps the arms disjoint, so
  -- `union all` cannot duplicate a row.
  my_notes as (
    select n.*
      from public.notes n
     where n.recipient_id = (select auth.uid())
    union all
    select n.*
      from public.notes n
     where n.task_id in (
             select t.id from public.tasks t where t.owner_id = (select auth.uid())
           )
  ),
  my_rollups as (
    select w.week_start, w.points, w.done, w.total, w.perfect, w.streak_held
      from public.week_rollups w
     where w.profile_id = (select auth.uid())
     order by w.week_start asc
  ),
  -- Everyone else's cheers on the tasks this pull just gathered, already
  -- counted. The raw rows never cross the wire.
  cheer_counts as (
    select r.target_id, count(*)::int as n
      from public.reactions r
     where r.target_type = 'task'
       and r.kind = 'cheer'
       and r.actor_id <> (select auth.uid())
       and r.target_id in (
             select id from my_tasks
             union
             select id from owner_tasks
           )
     group by r.target_id
  )
  select jsonb_build_object(
    'people',        coalesce((select jsonb_agg(to_jsonb(p)) from people p), '[]'::jsonb),
    'bots',          coalesce((select jsonb_agg(to_jsonb(b)) from bots b), '[]'::jsonb),
    -- Ordered inside the aggregate, not in the CTE. A CTE's ordering is not
    -- contractually preserved through an outer aggregate; an aggregate's own
    -- `order by` is. `my_circle` is the exception that proves it — `order by
    -- ... limit 1` inside a CTE *is* guaranteed, which is what makes the key
    -- below deterministic.
    'circles',       coalesce(
                       (select jsonb_agg(to_jsonb(r) order by r.joined_at asc, r.id asc)
                          from my_circle_rows r),
                       '[]'::jsonb
                     ),
    -- Kept, and equal to `circles[0]` by the shared ordering. An installed
    -- client reads this key and nothing else; dropping it here would break
    -- every build in the field at once, so it goes when the client stops
    -- asking and not before.
    'circle',        (select to_jsonb(c) from my_circle c),
    'memberships',   coalesce((select jsonb_agg(to_jsonb(m)) from memberships m), '[]'::jsonb),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n)) from notifs n), '[]'::jsonb),
    'my_tasks',      case
                       when p_week_start is null then null
                       else coalesce((select jsonb_agg(to_jsonb(t)) from my_tasks t), '[]'::jsonb)
                     end,
    'owner_tasks',   coalesce((select jsonb_agg(to_jsonb(t)) from owner_tasks t), '[]'::jsonb),
    'media',         case
                       when p_week_start is null then null
                       else coalesce((select jsonb_agg(to_jsonb(m)) from media m), '[]'::jsonb)
                     end,
    'reactions',     coalesce((select jsonb_agg(to_jsonb(r)) from my_reactions r), '[]'::jsonb),
    'notes',         coalesce((select jsonb_agg(to_jsonb(n)) from my_notes n), '[]'::jsonb),
    'rollups',       coalesce((select jsonb_agg(to_jsonb(w)) from my_rollups w), '[]'::jsonb),
    'cheer_counts',  coalesce(
                       (select jsonb_object_agg(c.target_id, c.n) from cheer_counts c),
                       '{}'::jsonb
                     )
  );
$$;

revoke execute on function public.pull_world(date, int) from public, anon;
grant  execute on function public.pull_world(date, int) to authenticated;

comment on function public.pull_world(date, int) is
  'One round trip for everything a launch needs: the directory, every circle '
  'you are in and who is in each, notifications, both halves of the week, '
  'reactions, notes, rollups, cheer counts, and the photos on any goal it '
  'gathered. SECURITY INVOKER — every CTE runs under the caller''s own RLS, so '
  'no audience rule is restated here and a policy change changes the answer '
  'without touching this function. `my_tasks` and `media` are null rather than '
  'empty when there is no week to ask about, because the client treats empty '
  'as authoritative. `circle` is `circles[0]` and is kept only until the '
  'client stops reading it. `memberships` is an edge list and is the one key '
  'here that may name a person twice.';
