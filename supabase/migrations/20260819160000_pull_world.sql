-- One round trip where there were five.
--
-- The client's pull was a waterfall: circle membership (itself three sequential
-- queries), then the feed's tasks (a second wave, because it can only ask about
-- people the first wave named), then cheer counts (a third, for the same
-- reason) — around thirteen queries and five serial round trips per cycle. On a
-- phone radio at 100–300ms each, that is up to a second and a half of latency
-- paid every 60s tick, every foreground, and every realtime nudge. The waves
-- exist because the *client* cannot ask a dependent question without first
-- hearing the answer to the previous one. The database can: every wave here is
-- a CTE reading the one before it, inside one statement, on one connection.
--
-- ─── SECURITY INVOKER, and why that is the whole design ───────────────────
--
-- Every subquery below runs as the caller, under the same RLS policies the
-- client's thirteen queries ran under. This function restates *no* visibility
-- rule: what you can see of a task is still `tasks_select`'s business, whose
-- profiles you can read is still `profiles_select`'s, and a change to a policy
-- changes this function's answer without this function changing. A SECURITY
-- DEFINER version would have had to re-derive every audience rule by hand and
-- keep it in step forever — the exact bug factory the policies exist to avoid.
--
-- The one privilege this adds over the client's own queries: none. Anything
-- readable through this function is readable today, one query at a time.
--
-- ─── shape ─────────────────────────────────────────────────────────────────
--
-- Rows are returned as `to_jsonb(row)`, so the client sees exactly the columns
-- `select('*')` gave it and the existing mappers keep working unchanged. The
-- keys mirror the transport's pulls one-for-one; `my_tasks` is null (not empty)
-- when no week was asked for, because "no week on screen yet" and "a week with
-- nothing staked" are different answers and the engine treats them differently.
--
-- `cheer_counts` moves the counting server-side: the client used to transfer
-- every raw reaction row and count them in JS — O(total cheers) payload growing
-- with the circle's whole history. It still excludes the caller's own cheers,
-- for the reason the transport documents: the screen adds the tap it already
-- knows about, so the number is never off by one while the outbox is busy.

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
    select p.id, p.handle, p.name
      from public.profiles p
     where p.id in (select profile_id from member_ids)
  ),
  bots as (
    select p.id, p.handle, p.name
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

-- The same audience the thirteen queries had. Anonymous sessions are
-- `authenticated` in Supabase terms; a caller with no session gets RLS's empty
-- answers, which is what their thirteen queries would have said too.
grant execute on function public.pull_world(date, int) to authenticated;

comment on function public.pull_world(date, int) is
  'The whole pull in one round trip: circle, bots, notifications, this week''s '
  'tasks (own and feed), own reactions, notes, rollups, and server-counted '
  'cheers. SECURITY INVOKER on purpose — every subquery runs under the '
  'caller''s own RLS, so this restates no visibility rule and cannot drift '
  'from the policies. Clients older than the function fall back to the '
  'per-table pulls; servers older than a client answer PGRST202 and the '
  'client falls back the same way.';
