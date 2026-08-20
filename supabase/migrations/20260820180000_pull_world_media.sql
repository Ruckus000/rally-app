-- The photo comes back with the goal it hangs off.
--
-- Everything for goal photos has existed for a while except the way back:
-- `task_media` holds the rows, the bucket holds the bytes, the screener moves
-- them to `ready` — and `pull_world` never mentioned any of it, so a photo was
-- visible only on the device that took it. This adds the eleventh key.
--
-- ─── the predicate that is deliberately not here ──────────────────────────
--
-- `media` has no `where` clause beyond which tasks to ask about, and that is
-- the whole design rather than an omission. This function is `security
-- invoker` (see `20260819160000_pull_world.sql`, which argues it at length), so
-- the CTE runs as the caller under `task_media_select`:
--
--     owner_id = auth.uid()
--     or (state = 'ready' and not block_between(owner_id) and can_see_task(task_id))
--
-- Screening state, blocks and the goal's audience are already answered there.
-- Restating any of it here would be a second copy of a rule that has been
-- rewritten twice already — once for blocks, once for screening — and the copy
-- would have been missed both times.
--
-- ─── the owner's own `pending` row is returned on purpose ─────────────────
--
-- The first branch of that policy hands an owner their own row whatever its
-- state, and `private.can_see_media` signs a `pending` object for them too.
-- That is what makes a photo appear on the owner's *second* device in the
-- seconds before the screener answers, and after a reinstall.
--
-- So do not "tidy" this CTE by adding `and state = 'ready'`. It would blank
-- the owner's other device, and — because the client reads "no row" as "the
-- photo was removed elsewhere" — it would delete the photo from that device
-- while it waited.
--
-- ─── null is not the same as empty ───────────────────────────────────────
--
-- `media` follows `my_tasks`: null when there is no week to ask about, `[]`
-- when the week genuinely has no photos. The client leans on the difference —
-- `[]` means "the server says there are none", which is how a photo removed on
-- another device disappears here, and null means "this pull cannot say", which
-- must never delete anything. Both source CTEs are gated on `p_week_start is
-- not null`, so without the `case` a null-week pull would answer `[]` and mean
-- the opposite of what it said.

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
    select cm.circle_id
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
  my_circle as (
    select c.id, c.name, c.invite_code
      from public.circles c
     where c.id in (select circle_id from my_circles)
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

-- `create or replace` keeps the existing grant, but re-stating it costs
-- nothing and means this file can be read on its own.
grant execute on function public.pull_world(date, int) to authenticated;

comment on function public.pull_world(date, int) is
  'One round trip for everything a launch needs: the directory, the circle, '
  'notifications, both halves of the week, reactions, notes, rollups, cheer '
  'counts, and the photos on any goal it gathered. SECURITY INVOKER — every '
  'CTE runs under the caller''s own RLS, so no audience rule is restated here '
  'and a policy change changes the answer without touching this function. '
  '`my_tasks` and `media` are null rather than empty when there is no week to '
  'ask about, because the client treats empty as authoritative.';
