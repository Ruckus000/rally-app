-- The circle the pull names is the same one every time.
--
-- `my_circle` picked the caller's circle with `limit 1` and no `order by`.
-- With one circle that is a distinction without a difference, and every human
-- in the seed but maya has one. With two it is a coin flip that Postgres may
-- land differently on consecutive calls, and the client does not treat it as
-- one: `state.circle` is the Me header's subtitle, the Circle tab's roster,
-- and — the part that matters — the invite code the share sheet hands out. A
-- code for a circle the user is not looking at is an invitation delivered to
-- the wrong room.
--
-- Found while testing something else: an account that had been walked through
-- onboarding twice held two circles, and which one the app claimed depended on
-- the pull.
--
-- This is the whole of the change. `my_circles` (plural) was already unbounded
-- and every other CTE already unions across all of them, so nothing else here
-- moves. The function is otherwise byte-identical to
-- `20260820180000_pull_world_media.sql`, which it is replaced from.
--
-- The revoke/grant pair below is restated from
-- `20260820210000_pull_world_execute.sql`. `create or replace` preserves the
-- ACL, so this is belt and braces — but that file exists solely because three
-- earlier migrations granted without revoking, and the next `create or
-- replace` is exactly where such a fix gets dropped by accident. Restating it
-- costs two lines and means this file can be read on its own.

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
  member_ids as (
    select distinct cm.profile_id
      from public.circle_members cm
     where cm.circle_id in (select circle_id from my_circles)
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
  my_circle as (
    select c.id, c.name, c.invite_code
      from public.circles c
      join my_circles mc on mc.circle_id = c.id
     order by mc.joined_at asc, c.id asc
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
    'circle',        (select to_jsonb(c) from my_circle c),
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
  'One round trip for everything a launch needs: the directory, the circle, '
  'notifications, both halves of the week, reactions, notes, rollups, cheer '
  'counts, and the photos on any goal it gathered. SECURITY INVOKER — every '
  'CTE runs under the caller''s own RLS, so no audience rule is restated here '
  'and a policy change changes the answer without touching this function. '
  '`my_tasks` and `media` are null rather than empty when there is no week to '
  'ask about, because the client treats empty as authoritative. EXECUTE is '
  'revoked from PUBLIC: a signed-out caller is refused at the function rather '
  'than three joins later at the first table anon cannot read. The `circle` '
  'key is the oldest membership, ordered rather than arbitrary, because the '
  'client shows one circle and the invite code it shares must belong to it.';
