-- The pool the Oz bots' week is drawn from, and the gate in front of it.
--
-- The Global feed is the first screen a new account lands on, so its goals are
-- the app's answer to "what does a stake look like here". A model writes the
-- candidates and prices them; a person approves them; `seed-bots.mjs` publishes
-- what was approved. This table is the middle of those three sentences — the
-- place a candidate waits between being written and being believed.
--
-- Approved is `approved_at is not null`. There is no rejected column: rejecting
-- deletes the row, because nothing in this project asks what was turned down
-- last month, and a tombstone nobody reads is a column that has to be kept
-- correct forever for no reader.
--
-- `last_staked` is the whole of the least-recently-used rule. Drawing
-- `order by last_staked asc nulls first` prefers a goal that has never run,
-- then the one that ran longest ago — so an empty pool degrades to repetition
-- rather than to a silent feed, and a person repeating a goal across weeks is
-- honest anyway.

-- ─── 1. The table ─────────────────────────────────────────────────────────
--
-- The constraints are the reason this is worth being its own table rather than
-- a staging area in `tasks`. `tasks` has none of them: `tasks_title_check` only
-- requires a non-empty title, `category` is bare `text not null`, and `points`
-- is only `>= 0`. A category the client has never heard of is silently
-- relabelled `Quick log` on the way in, and priced by a fallback that is not
-- even in the price table. None of that is wrong for a table people write to
-- from four app versions at once — but a goal a model wrote, on its way to
-- being published to every account on the service, should not reach `tasks`
-- until the shape has been checked somewhere.

create table public.bot_goal_candidates (
  id          uuid primary key default gen_random_uuid(),

  -- Which bot it was written for. Text rather than a reference to profiles:
  -- candidates are drafted long before `seed-bots.mjs` has necessarily created
  -- the account, and the handle is the stable name in both scripts.
  handle      text not null,

  title       text not null,
  category    text not null,
  points      integer not null,

  -- Null is pending. This nullable timestamp is the entire approval model.
  approved_at timestamptz,

  -- The Monday it last appeared in a staked week, for the draw.
  last_staked date,

  created_at  timestamptz not null default now(),

  -- 50 characters is the bound the drafting prompt asks for and the feed cards
  -- are laid out around; until now nothing enforced it. `btrim` of the same
  -- four characters `tasks_title_check` uses, because bare `trim()` strips
  -- spaces only and a title of tabs would pass.
  constraint bot_goal_candidates_title_shape
    check (length(btrim(title, E' \t\n\r')) between 1 and 50),

  -- The four the composer offers. `Quick log` is deliberately absent: it is the
  -- client's label for an unplanned entry, not something a bot stakes on a
  -- Monday.
  constraint bot_goal_candidates_category_known
    check (category in ('Fitness', 'Work', 'Home', 'Mind')),

  constraint bot_goal_candidates_points_band
    check (points between 10 and 60),

  -- The drafter is built to be run again and again — ask for forty, keep eight
  -- — and a model asked the same question twice writes the same good line
  -- twice. Without this, the second run fills the review queue with goals
  -- already judged. Scoped to the bot, because two people can honestly have the
  -- same goal.
  constraint bot_goal_candidates_unique_per_bot unique (handle, title)
);

-- The draw's only query: one bot's approved goals, oldest first.
create index bot_goal_candidates_draw_idx
  on public.bot_goal_candidates (handle, last_staked nulls first, created_at)
  where approved_at is not null;

comment on table public.bot_goal_candidates is
  'Drafted bot goals awaiting a person''s approval. Written and read only by the authoring scripts as service_role; approved_at is not null means publishable.';

-- ─── 2. Who may read any of it ────────────────────────────────────────────
--
-- Nobody signed in. RLS is enabled with no policy at all, which denies every
-- authenticated and anonymous request by default — the table is reached only by
-- scripts running with the service-role key, which bypasses RLS.
--
-- Enabling RLS without a policy is the whole access rule, and it is easy to
-- read as an oversight later. It is not, and the reason is not privacy: this is
-- a list of unpublished drafts, most of which were rejected. A client that
-- could read it would be reading the app's working notes, and one that could
-- write it would be choosing what every account on the service sees on its
-- first screen.

alter table public.bot_goal_candidates enable row level security;

revoke all on public.bot_goal_candidates from anon, authenticated;

-- Required, and not implied by anything above. `repair_write_paths` granted
-- `all on all tables` to service_role, which was a statement about the tables
-- that existed that day — it does not reach one created five migrations later.
-- Bypassing RLS is not permission to reach the table: without this, every one
-- of the three scripts fails with "permission denied for table
-- bot_goal_candidates".
grant all on public.bot_goal_candidates to service_role;
