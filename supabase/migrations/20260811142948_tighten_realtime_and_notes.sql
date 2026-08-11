-- Close what turning realtime on actually exposed.
--
-- The publication and `replica identity full` were added before these tables
-- held anything, so nothing was at risk. This wave is what fills them.

-- ─── 1. DELETE payloads were shipping whole rows to every subscriber ──────
--
-- Realtime does not apply row-level security to DELETE, and `replica identity
-- full` is precisely what makes the *old* record be sent. Together they meant
-- every delete on these tables broadcast the entire prior row — a note's body,
-- its author and recipient, a task's title and owner — to every socket bound
-- to the table. The project URL and publishable key are both public by design,
-- so anyone could sign in anonymously, bind DELETE on `notes`, and passively
-- collect every note anyone deleted.
--
-- The client never reads a payload: an event only ever means "something
-- changed, go and ask properly", because a DELETE is unfiltered and a single
-- row can arrive out of order. So the primary key is all it needs, and
-- `default` sends exactly that.

alter table public.tasks     replica identity default;
alter table public.reactions replica identity default;
alter table public.notes     replica identity default;

-- ─── 2. A note could be addressed to anyone at all ────────────────────────
--
-- `notes_insert` checked authorship and nothing else, so any signed-in user —
-- and anyone can become one, instantly and anonymously — could write a note
-- naming any profile as recipient, or any task as target. `notes_select` then
-- delivers it. That is unsolicited messaging from strangers, straight onto
-- someone's screen, in an app whose entire premise is a small closed circle.
--
-- A note now has to be addressed to someone you share a circle with, or
-- attached to a task you can actually see. Both checks already exist as
-- policy helpers; this is the first place that asks them about a write.

drop policy notes_insert on public.notes;

create policy notes_insert on public.notes for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      (recipient_id is not null and (
        recipient_id = (select auth.uid())
        or private.shares_circle_with(recipient_id)
      ))
      or (task_id is not null and private.can_see_task(task_id))
    )
  );

-- Same shape, same reasoning: you may only react to something you can see.
-- Harmless today because nobody reads anyone else's reaction counts yet, which
-- is exactly why it is cheap to fix now rather than after they do.

drop policy reactions_insert on public.reactions;

create policy reactions_insert on public.reactions for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and (target_type <> 'task' or private.can_see_task(target_id))
  );

-- ─── 3. A note body is not a payload ─────────────────────────────────────
--
-- `text` with only a not-blank check. Nothing between the keyboard and the
-- column bounded it, so a hand-rolled insert was limited only by Postgres.
-- 2000 is far past anything the composer can produce and far short of
-- anything worth storing by accident.

alter table public.notes add constraint notes_body_length
  check (length(body) <= 2000);
