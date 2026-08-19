-- Let a closed week reach the server, so an account can bring its history back.
--
-- `week_rollups` has existed since `init.sql` with a select policy and a select
-- grant, and nothing has ever written it. The comment above that policy still
-- says "Both are written server-side", which was a plan rather than a
-- description: rollover happens on the device, in the reducer, and no trigger
-- can see it. So history, streaks and every number on the Me screen have lived
-- in one phone's AsyncStorage and nowhere else.
--
-- That was survivable while an account could not be recovered anyway. Now that
-- Apple sign-in can bring one back, it is the difference between recovering an
-- account and recovering an account that remembers anything.
--
-- ─── 1. Insert only, and deliberately not an upsert ───────────────────────
--
-- A week closes once. There is no second version of Week 33 to write, so an
-- UPDATE policy would exist to support an operation nothing performs — and it
-- would have to carry both `using` and `with check` to stop a row being
-- reassigned, which is two more branches to get right for no behaviour.
--
-- What the queue *does* need is for a **replay** to be harmless. An outbox entry
-- that was sent, acknowledged slowly, and retried must not fail forever and land
-- in dead letters. The client writes it with `on conflict do nothing`, so the
-- second attempt is a no-op rather than a 23505 — the same trick `reaction.add`
-- uses for the same reason, and it needs no privilege beyond insert.

create policy week_rollups_insert on week_rollups for insert to authenticated
  with check (profile_id = (select auth.uid()));

grant insert on public.week_rollups to authenticated;

-- ─── 1b. What a client can now claim, and why that is not new ─────────────
--
-- The test this replaces put it plainly: "if a client could author one it could
-- mint its own points and streaks". True, and worth answering rather than
-- deleting.
--
-- It could already. `tasks.points` is `integer not null check (points >= 0)`
-- and `tasks.category` is free text — the database has never enforced the
-- category-to-points relationship, as `20260815094200_goal_ratings.sql` says in
-- as many words. A client willing to lie can stake a task worth a million and
-- close it, and every number on the Me screen follows from that. Writing the
-- rollup directly is a cheaper way to tell the same lie, not a new one.
--
-- So the ceiling is unchanged. What is worth adding is the floor: a rollup that
-- is *internally* incoherent — five done out of two staked — corrupts the
-- aggregates rebuilt from it on the owner's own device, and no honest client
-- ever sends one. These constraints cost nothing and are not a trust boundary;
-- the trust boundary is, and remains, that a client states its own week.

alter table week_rollups
  add constraint week_rollups_counts_sane
    check (points >= 0 and done >= 0 and total >= 0 and done <= total);

-- ─── 2. What this does not open ───────────────────────────────────────────
--
-- No update and no delete, so a closed week cannot be rewritten or made to
-- disappear by the device that closed it. `with check` pins the row to the
-- caller, so it cannot be written on somebody else's behalf either: the worst a
-- client can do to this table is tell the truth about its own week, once.
--
-- The select policy is untouched. Circle members can already read each other's
-- rollups — that is `shares_circle_with` in `init.sql`, and it is what a
-- leaderboard would eventually read.

comment on table week_rollups is
  'One closed week per person. Written by the device that closed it (insert '
  'only, own rows only) and read back to restore history on a reinstall. Not '
  'updatable: a week closes once, and a replayed queue entry is absorbed by '
  'on-conflict-do-nothing rather than by an update path nobody needs.';
