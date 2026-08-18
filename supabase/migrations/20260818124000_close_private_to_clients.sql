-- Shut the front door of `private`, and leave the policies' side door open.
--
-- `docs/backend.md` claimed for months that the `private` helpers were "none
-- executable by `anon` or `authenticated`". That was not true of
-- `authenticated`, which held USAGE on the schema and EXECUTE on eight of the
-- ten functions in it. The page has been corrected; this migration closes the
-- half of the gap that can actually be closed.
--
-- ─── What must NOT be revoked, and why ────────────────────────────────────
--
-- EXECUTE on the four policy helpers stays exactly where it is. An RLS policy
-- is evaluated as the *calling* role, so revoking it breaks every policy that
-- calls one — profiles, circles, circle_members, the friends and private
-- branches of tasks_select, task_pairs, reactions, notes, week_rollups and
-- invites_insert.
--
-- This is not a prediction. `20260810000000_init.sql` ended with exactly that
-- revoke, `20260811025743_repair_write_paths.sql` §1b took it back out, and
-- re-running it against the seeded local database still fails the same way:
--
--     revoke execute on function private.shares_circle_with(uuid)
--       from public, anon, authenticated;
--     -- then, as a signed-in user reading a friend's task:
--     ERROR: permission denied for function shares_circle_with
--
-- It hides on an empty database, because `tasks_select` short-circuits on
-- `owner_id = auth.uid() or aud = 'everyone'` and never reaches a helper. It
-- takes one `aud = 'friends'` row belonging to somebody else to surface it.
--
-- ─── What can be revoked, and why it is worth doing ───────────────────────
--
-- Schema USAGE is checked when a *name* is resolved, not when a stored policy
-- expression runs: the policy already holds the function's OID, so it never
-- consults the schema again. Revoking USAGE therefore blocks a client calling
-- `private.shares_circle_with(...)` by name, and leaves every policy working.
-- Measured both ways on the seeded local stack before this was written.
--
-- The gain is defence in depth rather than a hole closed. `private` is absent
-- from `[api] schemas`, so PostgREST answers PGRST202 and there is no route to
-- these functions today; and each helper is scoped to `auth.uid()`, so a
-- caller who found one would learn nothing about anyone else. This is the
-- second lock on a door that is already shut — which is precisely what the
-- documentation spent months claiming was already fitted.

revoke usage on schema private from authenticated;

comment on schema private is
  'Helpers RLS policies call, and triggers fire. Not exposed to PostgREST, and '
  'no client role holds USAGE: a policy reaches these by resolved OID, which '
  'needs no schema privilege, so blocking name resolution costs the app '
  'nothing. EXECUTE on the four policy helpers must stay granted to '
  '`authenticated` — see 20260811025743_repair_write_paths.sql section 1b.';
