-- Rally — initial schema.
--
-- DESIGN ONLY. This has never been executed against a database, so it is
-- unverified. Before adopting it, regenerate the filename with
-- `supabase migration new init` (the timestamp here is a placeholder), run it
-- against a local stack, and check `supabase db advisors`.
--
-- The shape follows the client's existing state: see docs/backend.md for the
-- slice-by-slice mapping.

create schema if not exists private;
comment on schema private is
  'Not exposed to the Data API. Holds SECURITY DEFINER helpers that RLS policies
   call to break circular policy dependencies.';

-- ─── enums ────────────────────────────────────────────────────────────────

create type audience as enum ('friends', 'everyone', 'private');
create type task_source as enum ('staked', 'quicklog');
create type reaction_kind as enum ('cheer', 'in', 'cosign', 'nod', 'share');
create type reaction_target as enum ('task', 'post');
create type notif_tier as enum ('needs', 'week', 'circle');

-- ─── people and circles ───────────────────────────────────────────────────

create table profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  handle      text unique not null check (handle ~ '^[a-z0-9_.]{3,30}$'),
  name        text not null,
  joined_at   timestamptz not null default now()
);

create table circles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- The shareable half of rally.app/join/<code>.
  invite_code text unique not null,
  created_by  uuid not null references profiles (id) on delete restrict,
  created_at  timestamptz not null default now()
);

create table circle_members (
  circle_id   uuid not null references circles (id) on delete cascade,
  profile_id  uuid not null references profiles (id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (circle_id, profile_id)
);

create index circle_members_profile_idx on circle_members (profile_id);

-- ─── the week ─────────────────────────────────────────────────────────────

-- `week_start` is the Monday, as a date. Deliberately not an ISO week number:
-- week 33 is ambiguous across years, and a date sorts and ranges natively.
create table tasks (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references profiles (id) on delete cascade,
  circle_id   uuid references circles (id) on delete set null,
  week_start  date not null,
  day         smallint not null check (day between 0 and 6), -- Monday = 0
  title       text not null check (length(trim(title)) > 0),
  category    text not null,
  points      integer not null check (points >= 0),
  aud         audience not null default 'friends',
  source      task_source not null default 'staked',
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index tasks_owner_week_idx on tasks (owner_id, week_start);
create index tasks_circle_week_idx on tasks (circle_id, week_start) where aud <> 'private';

create table task_pairs (
  task_id     uuid not null references tasks (id) on delete cascade,
  profile_id  uuid not null references profiles (id) on delete cascade,
  -- Joint pairs track each side separately; loose ones just witness.
  done_at     timestamptz,
  primary key (task_id, profile_id)
);

create index task_pairs_profile_idx on task_pairs (profile_id);

-- ─── the cheer ledger ─────────────────────────────────────────────────────

-- The unique constraint *is* the toggle: one cheer per actor per target. The
-- client currently prevents a double-count by hand; here the database does.
create table reactions (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid not null references profiles (id) on delete cascade,
  target_type  reaction_target not null,
  target_id    uuid not null,
  kind         reaction_kind not null,
  created_at   timestamptz not null default now(),
  unique (actor_id, target_type, target_id, kind)
);

create index reactions_target_idx on reactions (target_type, target_id);

-- ─── notes ────────────────────────────────────────────────────────────────

-- A note hangs off a task, or is addressed to a person. Exactly one, never
-- both — the client already models these as two separate slices.
create table notes (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references profiles (id) on delete cascade,
  task_id       uuid references tasks (id) on delete cascade,
  recipient_id  uuid references profiles (id) on delete cascade,
  body          text not null check (length(trim(body)) > 0),
  created_at    timestamptz not null default now(),
  constraint notes_exactly_one_target check (num_nonnulls(task_id, recipient_id) = 1)
);

create index notes_task_idx on notes (task_id) where task_id is not null;
create index notes_recipient_idx on notes (recipient_id) where recipient_id is not null;

-- ─── rollups and notifications ────────────────────────────────────────────

-- Written when a week closes. The client derives these today; on a server they
-- become the record that Me, the ledger and the year grid read.
create table week_rollups (
  profile_id   uuid not null references profiles (id) on delete cascade,
  week_start   date not null,
  points       integer not null default 0,
  done         integer not null default 0,
  total        integer not null default 0,
  perfect      boolean not null default false,
  streak_held  boolean not null default false,
  closed_at    timestamptz not null default now(),
  primary key (profile_id, week_start)
);

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references profiles (id) on delete cascade,
  tier          notif_tier not null,
  kind          text not null,
  -- Rendering data: names, faces, aging, the route to open.
  payload       jsonb not null default '{}'::jsonb,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- The bell badge counts unread 'needs' only, so index for exactly that.
create index notifications_unread_idx
  on notifications (recipient_id, tier)
  where read_at is null;

create table invites (
  id           uuid primary key default gen_random_uuid(),
  circle_id    uuid not null references circles (id) on delete cascade,
  inviter_id   uuid not null references profiles (id) on delete cascade,
  invitee_id   uuid references profiles (id) on delete set null,
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index invites_circle_idx on invites (circle_id);

-- ─── policy helpers ───────────────────────────────────────────────────────
--
-- These are SECURITY DEFINER because the alternative recurses: a policy on
-- `tasks` that reads `circle_members` triggers that table's policy, which
-- reads `circle_members` again. Postgres aborts with "infinite recursion
-- detected in policy for relation".
--
-- They live in `private` (not exposed to the Data API) and every one of them
-- is scoped to the calling user, so being SECURITY DEFINER cannot be used to
-- read anyone else's rows.

create or replace function private.is_circle_member(target_circle uuid)
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
  );
$$;

create or replace function private.shares_circle_with(other_profile uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.circle_members mine
    join public.circle_members theirs using (circle_id)
    where mine.profile_id = (select auth.uid())
      and theirs.profile_id = other_profile
  );
$$;

create or replace function private.is_paired_on(target_task uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.task_pairs
    where task_id = target_task
      and profile_id = (select auth.uid())
  );
$$;

-- Can the caller see this task? The audience model, expressed once.
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
        or t.aud = 'everyone'
        or (t.aud = 'friends' and private.shares_circle_with(t.owner_id))
        or (t.aud = 'private' and private.is_paired_on(t.id))
      )
  );
$$;

revoke execute on all functions in schema private from public, anon, authenticated;

-- ─── row level security ───────────────────────────────────────────────────
--
-- Every table in `public` gets RLS. `TO authenticated` alone would be
-- authentication without authorization, so each policy also carries an
-- ownership or membership predicate. Update policies carry both USING and
-- WITH CHECK so a row cannot be reassigned to someone else.

alter table profiles       enable row level security;
alter table circles        enable row level security;
alter table circle_members enable row level security;
alter table tasks          enable row level security;
alter table task_pairs     enable row level security;
alter table reactions      enable row level security;
alter table notes          enable row level security;
alter table week_rollups   enable row level security;
alter table notifications  enable row level security;
alter table invites        enable row level security;

-- profiles: yourself, and anyone you share a circle with.
create policy profiles_select on profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_circle_with(id));
create policy profiles_update on profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- circles: members only.
create policy circles_select on circles for select to authenticated
  using (private.is_circle_member(id));
create policy circles_insert on circles for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy circle_members_select on circle_members for select to authenticated
  using (private.is_circle_member(circle_id));
-- You may add and remove only yourself; invites are the way in.
create policy circle_members_insert on circle_members for insert to authenticated
  with check (profile_id = (select auth.uid()));
create policy circle_members_delete on circle_members for delete to authenticated
  using (profile_id = (select auth.uid()));

-- tasks: the audience model, straight from the handoff. Owner always; the
-- circle when 'friends'; anyone when 'everyone'; owner and pairs when
-- 'private'.
create policy tasks_select on tasks for select to authenticated
  using (
    owner_id = (select auth.uid())
    or aud = 'everyone'
    or (aud = 'friends' and private.shares_circle_with(owner_id))
    or (aud = 'private' and private.is_paired_on(id))
  );
create policy tasks_insert on tasks for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy tasks_update on tasks for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy tasks_delete on tasks for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy task_pairs_select on task_pairs for select to authenticated
  using (profile_id = (select auth.uid()) or private.can_see_task(task_id));
-- Only your own side of a joint stake is yours to tick.
create policy task_pairs_update on task_pairs for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- reactions: visible with whatever they're attached to; only ever yours to
-- write or withdraw. Withdrawing is how a cheer is taken back.
create policy reactions_select on reactions for select to authenticated
  using (
    actor_id = (select auth.uid())
    or (target_type = 'task' and private.can_see_task(target_id))
    or target_type = 'post'
  );
create policy reactions_insert on reactions for insert to authenticated
  with check (actor_id = (select auth.uid()));
create policy reactions_delete on reactions for delete to authenticated
  using (actor_id = (select auth.uid()));

create policy notes_select on notes for select to authenticated
  using (
    author_id = (select auth.uid())
    or recipient_id = (select auth.uid())
    or (task_id is not null and private.can_see_task(task_id))
  );
create policy notes_insert on notes for insert to authenticated
  with check (author_id = (select auth.uid()));

-- Rollups and notifications are yours alone. Both are written server-side.
create policy week_rollups_select on week_rollups for select to authenticated
  using (profile_id = (select auth.uid()) or private.shares_circle_with(profile_id));

create policy notifications_select on notifications for select to authenticated
  using (recipient_id = (select auth.uid()));
create policy notifications_update on notifications for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

create policy invites_select on invites for select to authenticated
  using (inviter_id = (select auth.uid()) or invitee_id = (select auth.uid()));
create policy invites_insert on invites for insert to authenticated
  with check (inviter_id = (select auth.uid()) and private.is_circle_member(circle_id));
