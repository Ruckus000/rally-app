-- What a goal is worth, once something has read it.
--
-- Points have always been a lookup: pick Fitness, get 35, whether the goal was
-- "Walk 30 minutes every morning" or "Get fitter". The second of those cannot
-- be lost on Sunday, which means staking it risks nothing, which means the two
-- should never have cost the same. A model now reads the goal and prices it.
--
-- Neither table below is app data. They are the two things a rated composer
-- needs that the client cannot be trusted to hold: an answer it has already
-- paid for, and a count of how much it has spent.
--
-- Note what is *not* here. `tasks.points` is already `integer not null check
-- (points >= 0)` and `tasks.category` is already free text, so the database has
-- never enforced the category-to-points relationship — it lived in a client
-- constant and a comment. Rating a goal therefore needs no change to `tasks`
-- at all.

-- ─── 1. Ratings already paid for ──────────────────────────────────────────
--
-- Goals repeat, and far more than they look like they would: within one
-- person's week, across everyone who copies a line off the Global feed, and
-- across every pause in typing that lands on a title somebody has typed
-- before. Keyed on a hash of the lowercased title and the category, because
-- the same words under a different category are a different question.
--
-- `title` is kept alongside the hash on purpose. Without it there is no way to
-- look at what the model has been doing — and the first time a price looks
-- wrong, the question will be which goals got it.

create table public.goal_ratings (
  title_hash text primary key,
  title text not null,
  category text not null,
  points integer not null check (points >= 0),
  verdict text not null check (verdict in ('ok', 'blocked')),
  reason text,
  created_at timestamptz not null default now()
);

comment on table public.goal_ratings is
  'Model-assigned prices, cached by title+category. Written only by the rate-goal function.';

-- ─── 2. What each account has spent ───────────────────────────────────────
--
-- The composer rates as you type, and the free tier it rates against is a
-- project-wide allowance rather than a per-user one. One client stuck in a
-- loop would therefore spend everybody's. This is the counter that stops it.

create table public.llm_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  count integer not null default 0,
  primary key (user_id, day)
);

comment on table public.llm_usage is
  'Per-account daily call count, so one client cannot exhaust a shared quota.';

-- ─── 3. Who may read any of it ────────────────────────────────────────────
--
-- Nobody signed in. RLS is enabled with no policy at all, which denies every
-- authenticated and anonymous request by default — the tables are reached only
-- by the edge function's service-role client, which bypasses RLS.
--
-- Enabling RLS without a policy is the whole access rule, and it is easy to
-- read as an oversight later. It is not: a rating cache is a list of what
-- every person on the service has typed into the composer, and the client has
-- no reason to hold one.

alter table public.goal_ratings enable row level security;
alter table public.llm_usage enable row level security;

revoke all on public.goal_ratings from anon, authenticated;
revoke all on public.llm_usage from anon, authenticated;
grant all on public.goal_ratings to service_role;
grant all on public.llm_usage to service_role;

-- ─── 4. Counting a call ───────────────────────────────────────────────────
--
-- Increment and read in one statement. Two round trips — read, then write —
-- would let a client with several requests in flight slip past the cap, which
-- is the exact condition the cap exists for.
--
-- Same trap as `bot_cheer`: Postgres grants EXECUTE to PUBLIC on every new
-- function, so this is an open endpoint until revoked. A signed-in caller
-- reaching it could inflate somebody else's counter and lock them out of
-- rating for the day.

create or replace function public.bump_llm_usage(u uuid, d date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.llm_usage (user_id, day, count)
  values (u, d, 1)
  on conflict (user_id, day) do update set count = public.llm_usage.count + 1
  returning count into n;
  return n;
end;
$$;

revoke execute on function public.bump_llm_usage(uuid, date) from public, anon, authenticated;
grant execute on function public.bump_llm_usage(uuid, date) to service_role;
