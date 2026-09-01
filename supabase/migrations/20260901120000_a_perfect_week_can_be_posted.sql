-- A perfect week can be posted, and the button that said so starts telling the
-- truth.
--
-- `MineWinCard` has always drawn "Post it to the circle", and it has always
-- dispatched `ACT` — a boolean in `state.acted` and a toast. No row, no op, no
-- post. Nobody else ever saw anything.
--
-- ─── why this is not a column on `week_rollups` ──────────────────────────
--
-- That was the first attempt and it does not work, for a reason worth writing
-- down so nobody tries it again. A rollup is written at *rollover* — the only
-- caller of `queueRollup` is `RolloverOverlay.commit`, on the first launch of
-- the following week. The card that offers to post is on screen during the week
-- it is about, when `allTasksDone` first becomes true. So there is no row yet
-- to set a flag on, and an RPC that flipped one would answer "nothing to share"
-- every time it was actually tapped.
--
-- Making the share *create* the rollup early is worse, and quietly so. The
-- numbers would be a snapshot taken mid-week; stake two more goals on Saturday,
-- close them on Sunday, and `rollup.add`'s upsert — `ignoreDuplicates`, because
-- a week closes once — declines to correct it. The Ledger and the year grid
-- would then show the shared snapshot forever rather than the week that
-- happened. A social post must not be able to corrupt the record.
--
-- So they are two tables because they are two facts. `week_rollups` is what the
-- week came to, written once when it ends. `week_shares` is a thing somebody
-- chose to say, true as of the moment they said it. They are allowed to
-- disagree, and nothing downstream of either has to care.
--
-- ─── why it is not scoped to a circle ────────────────────────────────────
--
-- The obvious shape, once circles are plural, is a picker: post this week to
-- The Basement and not to The Attic. A week's goals span every circle the
-- person is in, so there is no coherent sense in which somebody had a perfect
-- week in one room and not another — a `circle_id` here would not be a scope,
-- it would be a second copy of the same fact with a different label.
--
-- It reaches everyone who shares any circle with you, which is what
-- `20260831210000_a_goal_belongs_to_a_circle.sql` says per-person records are
-- for: "who you are, and how your week went. Sharing any circle with someone is
-- the right reason to see those. Only a *goal* belongs to a room."

create table public.week_shares (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  week_start  date not null,
  points      integer not null default 0,
  done        integer not null default 0,
  total       integer not null default 0,
  -- The count the card shows, which `week_rollups` cannot answer: it stores
  -- `streak_held` as a boolean and never the length.
  streak      integer not null default 0,
  shared_at   timestamptz not null default now(),
  primary key (profile_id, week_start),
  -- What makes the table mean something rather than merely hold numbers. The
  -- card only exists for a week with every goal closed, so a row that does not
  -- say so is a client with a bug, and the constraint is where that stops
  -- rather than where it starts being rendered to other people.
  constraint week_shares_complete check (total > 0 and done = total),
  constraint week_shares_sane check (points >= 0 and streak >= 0)
);

comment on table public.week_shares is
  'A finished week somebody chose to show the people they share a circle with. '
  'Deliberately separate from week_rollups: that one is written at rollover and '
  'is the Ledger''s record of what the week came to, and this one is a post '
  'made mid-week and true as of when it was made. Insert-only, like rollups — '
  'a week is posted once.';

alter table public.week_shares enable row level security;

-- Your own row and nobody else's, which is the same shape `week_rollups_insert`
-- has and for the same reason: the client writes this, so the only thing worth
-- checking is that it is writing about itself.
create policy week_shares_insert on public.week_shares for insert to authenticated
  with check (profile_id = (select auth.uid()));

-- Read by anyone you share any circle with, and guarded by `account_gone` for
-- the reason `week_rollups_select` gives: a deletion is not a per-viewer
-- opinion, and leaving a departed account's numbers in the feed would put a
-- nameless ghost in front of exactly the person who asked to be removed.
create policy week_shares_select on public.week_shares for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (
      not private.account_gone(profile_id)
      and private.shares_circle_with(profile_id)
    )
  );

-- No update and no delete, matching `week_rollups`. A post is a thing that was
-- said; editing it after the fact is a different feature with its own
-- questions, and granting the privilege now is how it arrives by accident.
grant select, insert on public.week_shares to authenticated;

-- ─── the pull ────────────────────────────────────────────────────────────
--
-- Two new keys. Built from `20260901090000_pull_world_all_circles.sql` rather
-- than retyped, so the fan-out warning in its header and the revoke/grant pair
-- below both survive — that pair exists because three migrations once granted
-- without revoking, and a `create or replace` is exactly where such a fix gets
-- dropped by accident.

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
  -- Somebody else's finished week, posted on purpose.
  --
  -- `member_ids`, not `memberships`, and not a join to `circle_members` — the
  -- header above spells out why. `member_ids` is `distinct`, so a person you
  -- share two circles with contributes one row; the edge list would give two,
  -- and the client would draw the same card twice.
  --
  -- This week only. A perfect week is news, and the Ledger is where old ones
  -- live. Self is excluded because `my_share` answers for you, and a card about
  -- your own week already exists on the Week screen.
  --
  -- No RLS restated. `week_shares_select` answers "anyone you share a circle
  -- with", which is the right reach for a per-person record and the reason this
  -- is not scoped to one room: the week's goals span every circle you are in.
  circle_shares as (
    select s.profile_id, s.week_start, s.points, s.done, s.total, s.streak, s.shared_at
      from public.week_shares s
     where p_week_start is not null
       and s.week_start = p_week_start
       and s.profile_id <> (select auth.uid())
       and s.profile_id in (select profile_id from member_ids)
  ),
  -- Your own, so the button knows it has already been pressed. On the row
  -- rather than in `acted`, which is local and does not survive a reinstall.
  my_share as (
    select s.week_start, s.shared_at
      from public.week_shares s
     where p_week_start is not null
       and s.week_start = p_week_start
       and s.profile_id = (select auth.uid())
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
    -- Null rather than empty when there is no week to ask about, for the reason
    -- `my_tasks` and `media` give: the client treats empty as authoritative.
    'circle_shares', case
                       when p_week_start is null then null
                       else coalesce(
                              (select jsonb_agg(to_jsonb(s)) from circle_shares s),
                              '[]'::jsonb
                            )
                     end,
    'my_share',      (select to_jsonb(s) from my_share s),
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
  'here that may name a person twice. `circle_shares` is the finished weeks '
  'people you share a circle with chose to post, for the week asked about — '
  'null when there is none, like `my_tasks` and `media`. `my_share` is your '
  'own for that week, or null.';
