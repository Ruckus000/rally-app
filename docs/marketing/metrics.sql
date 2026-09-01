-- The marketing funnel, readable in the Supabase SQL editor.
--
-- Rally has no analytics by policy (docs/legal/privacy.html promises none), so
-- the only place the funnel exists is these tables. Run this on Mondays; every
-- query excludes the Oz bots (`is_bot`) and accounts scheduled for deletion
-- (`deleted_at`), and every "week" is the Monday-start ISO week the app uses
-- (`tasks.week_start`, `week_rollups.week_start`).
--
-- Targets for the founding cohort are in README.md. Nothing here writes.

-- 1. Real accounts per join week. The top of the funnel.
select
  date_trunc('week', joined_at)::date as week_start,
  count(*)                            as accounts
from profiles
where not is_bot and deleted_at is null
group by 1
order by 1;

-- 2. Circle sizes. Below three members, one absence empties the room.
select
  c.name,
  c.created_at::date                          as created,
  count(m.profile_id)                         as members,
  count(m.profile_id) filter (where not p.is_bot) as humans
from circles c
left join circle_members m on m.circle_id = c.id
left join profiles p on p.id = m.profile_id
group by c.id, c.name, c.created_at
order by members desc, c.created_at;

-- 3. Solo accounts: signed up, never joined or made a circle. The invite loop's leak.
select
  count(*)                                              as solo_accounts,
  round(100.0 * count(*) / nullif((select count(*) from profiles
     where not is_bot and deleted_at is null), 0), 1)   as pct_of_accounts
from profiles p
where not p.is_bot and p.deleted_at is null
  and not exists (select 1 from circle_members m where m.profile_id = p.id);

-- 4. Activation: staked at least one task in the week they joined.
with joined as (
  select id, date_trunc('week', joined_at)::date as join_week
  from profiles where not is_bot and deleted_at is null
)
select
  count(*)                                                    as accounts,
  count(*) filter (where exists (
    select 1 from tasks t where t.owner_id = j.id
      and t.week_start = j.join_week))                        as staked_first_week,
  round(100.0 * count(*) filter (where exists (
    select 1 from tasks t where t.owner_id = j.id
      and t.week_start = j.join_week)) / nullif(count(*), 0), 1) as pct
from joined j;

-- 5. Cheers per active member per week. The product thesis, as a number.
with weekly as (
  select
    t.week_start,
    count(distinct t.owner_id)                          as active_members,
    count(r.id) filter (where r.kind = 'cheer')         as cheers
  from tasks t
  join profiles o on o.id = t.owner_id and not o.is_bot
  left join reactions r
    on r.target_type = 'task' and r.target_id = t.id
   and exists (select 1 from profiles a where a.id = r.actor_id and not a.is_bot)
  group by t.week_start
)
select
  week_start, active_members, cheers,
  round(cheers::numeric / nullif(active_members, 0), 2) as cheers_per_member
from weekly
order by week_start;

-- 6. Week-over-week retention: staked in week N and again in week N+1.
with weeks as (
  select distinct owner_id, week_start
  from tasks t join profiles p on p.id = t.owner_id
  where not p.is_bot and p.deleted_at is null
)
select
  a.week_start,
  count(*)                                                  as staked,
  count(b.owner_id)                                         as staked_next_week,
  round(100.0 * count(b.owner_id) / nullif(count(*), 0), 1) as pct_retained
from weeks a
left join weeks b
  on b.owner_id = a.owner_id and b.week_start = a.week_start + 7
group by a.week_start
order by a.week_start;

-- 7. Closed weeks: rollups, perfect weeks, streaks held. Quote material.
select
  week_start,
  count(*)                              as closed_weeks,
  sum(done)                             as tasks_done,
  sum(total)                            as tasks_staked,
  count(*) filter (where perfect)       as perfect_weeks,
  count(*) filter (where streak_held)   as streaks_held
from week_rollups w
join profiles p on p.id = w.profile_id
where not p.is_bot
group by week_start
order by week_start;

-- 8. Circles that survived: members who staked in three consecutive weeks.
with weeks as (
  select distinct t.circle_id, t.owner_id, t.week_start
  from tasks t join profiles p on p.id = t.owner_id
  where not p.is_bot and t.circle_id is not null
)
select
  c.name,
  count(distinct a.owner_id) as members_with_3_straight_weeks
from weeks a
join weeks b on b.owner_id = a.owner_id and b.circle_id = a.circle_id and b.week_start = a.week_start + 7
join weeks d on d.owner_id = a.owner_id and d.circle_id = a.circle_id and d.week_start = a.week_start + 14
join circles c on c.id = a.circle_id
group by c.id, c.name
order by 2 desc;

-- 9. The build-in-public line, in one row. Paste the numbers; never round up.
select
  (select count(*) from circles)                                                   as circles,
  (select count(*) from profiles where not is_bot and deleted_at is null)          as people,
  (select count(*) from tasks t join profiles p on p.id = t.owner_id where not p.is_bot) as stakes,
  (select count(*) from tasks t join profiles p on p.id = t.owner_id where not p.is_bot and t.done_at is not null) as closed,
  (select count(*) from reactions r join profiles p on p.id = r.actor_id where not p.is_bot and r.kind = 'cheer') as cheers,
  (select count(*) from week_rollups w join profiles p on p.id = w.profile_id where not p.is_bot and w.perfect) as perfect_weeks;
