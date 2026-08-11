-- Make last-write-wins actually compare the writes.
--
-- `updated_at` shipped with a clamp and a comment claiming it stops a stake
-- queued offline on Monday from beating a Wednesday edit on another device.
-- It does not: the client upserts a full row with `onConflict: 'id'`, so the
-- losing write is an UPDATE that overwrites every column, and *arrival* order
-- decides. The column was a clock nobody read.
--
-- Two holes, one trigger:
--
--   1. Nothing compared `updated_at`. Now a write whose clock is older than
--      the stored row is a no-op.
--   2. `least(x, now() + 5min)` bounds forward drift and leaves backdating
--      unbounded. A client could write 1970 at will — which, once (1) exists,
--      is worse than harmless: the row survives but sorts before every
--      "changed since" cursor, so it becomes invisible to future pulls rather
--      than merely losing. Bounded below as well as above.
--
-- ─── Why one trigger and not two ──────────────────────────────────────────
--
-- The comparison is only sound *after* the clamp: a device claiming the year
-- 3000 must lose on the clamped value, not win on the raw one and get clamped
-- afterwards. Same-timing triggers fire in name order, so a separate guard
-- would depend on staying alphabetically after `tasks_clamp_updated_at` —
-- true today, and a rename away from silently inverting the two. Folding both
-- into one function makes the order a statement order instead.

drop trigger tasks_clamp_updated_at on public.tasks;
drop function private.clamp_updated_at();

create function private.tasks_lww_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- An UPDATE that does not touch `updated_at` is not a competing write —
  -- it is someone changing a column (`aud`, a title) against the row as it
  -- already stands. It has no clock to compare and nothing to clamp, and
  -- re-clamping the inherited value would silently move the timestamp on a
  -- row that legitimately predates the floor.
  if tg_op = 'UPDATE' and new.updated_at is not distinct from old.updated_at then
    return new;
  end if;

  new.updated_at := least(
    greatest(coalesce(new.updated_at, now()), now() - interval '90 days'),
    now() + interval '5 minutes'
  );

  -- The floor is wide on purpose. The outbox holds a tap for as long as the
  -- user is offline, and that timestamp is the whole point of the column, so
  -- the bound has to sit far past any credible offline stretch — this is a
  -- weekly app, and its own history is weeks. 90 days is "obviously a broken
  -- clock, not a long flight", while still landing the row somewhere a
  -- changed-since pull will reach.

  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    -- The stale write loses. Returning OLD rather than NULL, deliberately:
    -- NULL skips the row, and PostgREST reports a skipped row as `[]` with no
    -- error — which in this schema already means "RLS refused you" (see the
    -- refused-update tests). Overloading that one signal would make losing a
    -- race indistinguishable from being denied, and telling those apart is
    -- the outbox's entire job. Returning OLD keeps the row counted, so a
    -- client that asks for `.select()` gets the row that won back and can
    -- reconcile against it.
    --
    -- The cost is a no-op heap write plus a realtime UPDATE carrying values
    -- identical to the ones subscribers already hold. Idempotent, and cheap
    -- next to an ambiguous error code.
    return old;
  end if;

  -- Strictly older loses; equal passes. Two devices that genuinely tapped in
  -- the same millisecond have no ordering to recover, and refusing both would
  -- be worse than letting the second land — an equal write is also what a
  -- retry of a write that already succeeded looks like.
  --
  -- Note what this costs `done_at` toggling, the app's commonest write: a
  -- device up to 5 minutes fast (the forward clamp's slack) can park
  -- `updated_at` ahead of a slower device's real clock, and that device's
  -- close is then dropped without an error. That window is the price of
  -- client clocks; it is bounded by the clamp, and the alternative — server
  -- `now()` — makes drain order authoritative, which is the bug this file
  -- exists to fix.
  return new;
end;
$$;

create trigger tasks_lww_guard
  before insert or update on public.tasks
  for each row execute function private.tasks_lww_guard();

-- DELETE is deliberately not guarded. A delete carries no `updated_at` to
-- compare, and the client's delete path is written to be idempotent against a
-- missing row; a stale queued delete beating a newer edit is a real hole, but
-- closing it needs a tombstone, not a trigger.
