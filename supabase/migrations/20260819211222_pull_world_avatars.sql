-- The face, through the one round trip too.
--
-- `pull_world` was written the week before avatars existed, so its `people`
-- and `bots` CTEs select the three columns a directory row used to need. The
-- per-table fallback (`pullCircle`, `pullBots`) has since grown two more —
-- `avatar_path` and `avatar_state` — and the two paths have to answer with the
-- same row or the photo appears only on servers too old to have this function.
-- Both CTEs gain the columns, because a bot can have a face too and the
-- client maps both lists through the same `rowToPerson`.
--
-- ─── and your own row ─────────────────────────────────────────────────────
--
-- `people` was "everyone in a circle with me", which contains me only as a
-- by-product of being in a circle. That was fine while a profile was a name
-- you had typed yourself: you already knew it. It stopped being fine the
-- moment the row carries a column *only the server can write*. `avatar_state`
-- moves from `pending` to `ready` or `refused` in `mark_avatar_screened`,
-- which no client may call — so this pull is the only place a screening
-- verdict ever arrives. An account on its own would never hear it: it would
-- sit on `pending`, render initials forever, and Settings would keep offering
-- to add a photo that was already uploaded and already approved.
--
-- `pullCircle` closed the same gap by always asking for the caller's id; this
-- closes it on the primary path. Nothing is widened by it: `profiles_select`
-- still decides which rows are readable, this only decides which to ask
-- about, and your own row has always been readable to you.
--
-- Everything else below is `20260819160000_pull_world.sql` unchanged — same
-- signature, same CTEs, same payload keys, same SECURITY INVOKER for the same
-- reason.

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
  'The whole pull in one round trip: circle (including your own row, which is '
  'where a screened avatar''s state arrives from), bots, notifications, this '
  'week''s tasks (own and feed), own reactions, notes, rollups, and '
  'server-counted cheers. SECURITY INVOKER on purpose — every subquery runs '
  'under the caller''s own RLS, so this restates no visibility rule and cannot '
  'drift from the policies. Clients older than the function fall back to the '
  'per-table pulls; servers older than a client answer PGRST202 and the '
  'client falls back the same way.';
