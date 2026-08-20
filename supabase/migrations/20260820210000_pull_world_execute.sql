-- `pull_world` was refused to signed-out callers for the wrong reason.
--
-- Three migrations have written `grant execute on function public.pull_world
-- (date, int) to authenticated;` and none of them revoked anything first.
-- Postgres grants EXECUTE to PUBLIC on every new function, so that line has
-- always been a no-op sitting on top of a permission everybody already had:
-- `anon` could execute it, and could have all along.
--
-- Nothing leaked. The function is SECURITY INVOKER, so a signed-out caller
-- reaches the CTEs as `anon`, and `anon` holds no SELECT on `profiles`,
-- `tasks` or anything else they read — so the call dies at the first table
-- with 42501. `integration/rls/pull_world.test.ts` has asserted that refusal
-- since the function shipped, and it passed for that reason rather than the
-- one its name claims.
--
-- Which is exactly why this is worth fixing rather than shrugging at. The test
-- says "execute is granted to authenticated only" and that sentence was not
-- true; the protection was a table grant three joins away, and it would go on
-- being true only for as long as nobody ever granted `anon` a read on a table
-- this function happens to touch. Defence in depth is only depth if each layer
-- is actually there.
--
-- `20260819194501_avatars.sql` already writes the correct shape for
-- `set_avatar` and `mark_avatar_screened`, and says why: "Postgres grants
-- EXECUTE to PUBLIC on every new function, so a SECURITY DEFINER function is
-- callable by anyone until it is revoked." The same sentence applies to an
-- INVOKER one that reads a whole account's world in a single call.
--
-- Only this function needs it. The other four with a PUBLIC grant are trigger
-- functions in `private` — not an exposed schema, and not callable as RPCs at
-- all, since a function returning `trigger` has no other caller than the
-- table it hangs off.

revoke execute on function public.pull_world(date, int) from public, anon;
grant  execute on function public.pull_world(date, int) to authenticated;

comment on function public.pull_world(date, int) is
  'One round trip for everything a launch needs: the directory, the circle, '
  'notifications, both halves of the week, reactions, notes, rollups, cheer '
  'counts, and the photos on any goal it gathered. SECURITY INVOKER — every '
  'CTE runs under the caller''s own RLS, so no audience rule is restated here '
  'and a policy change changes the answer without touching this function. '
  '`my_tasks` and `media` are null rather than empty when there is no week to '
  'ask about, because the client treats empty as authoritative. EXECUTE is '
  'revoked from PUBLIC: a signed-out caller is refused at the function rather '
  'than three joins later at the first table anon cannot read.';
