-- A goal photo has to get past the same model an avatar does.
--
-- `20260819194501_avatars.sql` put a screening gate in front of profile
-- photos and argued for it at length. This does the same for the other place
-- a picture reaches somebody else's screen, and the argument is not repeated
-- here — read that file for why an unscreened image is not a thing to hand
-- out while we sort the quota.
--
-- What is worth writing down is where this one differs.
--
-- ─── the gate is in the policy, not only in the client ────────────────────
--
-- The avatars migration puts the gate in `profiles.avatar_state` and leaves
-- `avatars_objects_select` open to every signed-in account, with a comment
-- explaining why: storage cannot ask about `avatar_state` without another
-- SECURITY DEFINER helper joining objects to rows by name.
--
-- Here that helper already exists. `private.can_see_media` was written for
-- this bucket in `20260819180000` and already resolves an object name to the
-- task it belongs to, so asking it one more question costs one more `exists`.
-- The result is a gate that does not depend on the client asking politely: an
-- unscreened object cannot be read through a signed URL by anyone it is not
-- already theirs.
--
-- That matters more here than it would have for avatars, because nothing on
-- the client reads these bytes back yet. `pull_world` returns no media, so
-- today the only photo anyone sees is their own, off the local file the
-- picker gave them. The read path is a later increment — and the point of
-- landing the gate first is that the increment cannot forget it. There is no
-- ungated route to fetch, so there is nothing for it to leave out.
--
-- ─── the owner is exempt, and that is not a hole ──────────────────────────
--
-- Both halves below keep the `owner_id = auth.uid()` branch they already had
-- and add the screening test to the *other* branch only. The gate exists to
-- stop an unscreened picture reaching somebody who did not choose it; the
-- owner chose it, and saw it full-screen in the picker one second before it
-- was uploaded. Refusing it back to them protects nobody and would make a
-- reinstalled app quietly unable to see its own photo.
--
-- The avatars migration does hide `pending` from the uploader, and this is
-- the one place the two deliberately disagree. There it buys something real:
-- every screen renders initials, so there is a single rendering path and no
-- "is this mine" branch in front of the bytes. Here the owner's photo does
-- not come from the server at all — it comes off their own disk — so the
-- exemption costs no branch anybody actually walks.
--
-- ─── `pending` is where a photo starts, including one already here ────────
--
-- The column defaults to `pending` and there is no backfill. A row written
-- before this migration is a photo no model has looked at, and the honest
-- thing to do with it is what happens to one uploaded a second from now:
-- hold it until something screens it. Marking existing rows `ready` would be
-- grandfathering unscreened content on the grounds that it arrived early,
-- which is the one reason that has never made an image safe.

alter table task_media
  add column state text not null default 'pending';

-- Two states, where the avatars column has four, and the missing one is
-- `refused`. There a refusal has to be recorded, because the row is the
-- profile and the profile cannot be deleted. Here the row *is* the photo, and
-- `unique (task_id)` makes a kept refusal actively harmful: it would occupy
-- the one media slot that task has, so the owner could never attach another
-- picture to a goal whose first attempt was blocked. A refused photo
-- therefore loses its object and its row, and the task goes back to having no
-- photo — which is the state it was in before, and the one the owner can act
-- on.
alter table task_media
  add constraint task_media_state_known
  check (state in ('pending', 'ready'));

-- ─── the path has to be the row's own ────────────────────────────────────
--
-- `20260819180000` made `path` free-form text, and until now that was
-- harmless: nothing privileged ever read it. Every reader went the other way
-- — from an object name to a task — and a row claiming a path it had no
-- business with was inert.
--
-- Screening changes that. `screen-task-media` holds the service role, and it
-- *downloads* `row.path` and, on a refusal, *deletes* it. A row is easy to
-- get: the insert policy asks that the owner is you and the task is yours,
-- and says nothing about `path`. So without the constraint below, anybody
-- could insert a perfectly legitimate row of their own naming somebody
-- else's object, and have the screener delete it for them — and getting a
-- refusal on demand needs no luck at all, because going over the daily cap
-- refuses before the image is ever looked at.
--
-- The path is fully determined by the three ids already on the row, so the
-- row is made to say exactly that and nothing downstream has to trust it.
-- The edge function derives the same string rather than reading this column,
-- which makes the two independent rather than merely agreeing.
--
-- Non-conforming rows are deleted rather than left for the constraint to trip
-- over. Any such row is either a forgery or a client that never existed, it
-- is `pending` and therefore invisible after this migration anyway, and the
-- alternative is a deploy that fails partway with the gate half-applied.
delete from task_media
  where path is distinct from
    (owner_id::text || '/' || task_id::text || '/' || id::text || '.jpg');

alter table task_media
  add constraint task_media_path_is_its_own
  check (path = owner_id::text || '/' || task_id::text || '/' || id::text || '.jpg');

-- Two jobs. It stops a second row claiming an object that already has one —
-- impossible for well-formed rows given the constraint above, and cheap
-- insurance if that constraint is ever relaxed. And it is the index
-- `can_see_media` needs: that function now looks a row up by `path` on every
-- storage read, and this table had no index on the column at all.
create unique index task_media_path_idx on task_media (path);

-- ─── the client may not write it ──────────────────────────────────────────
--
-- The shape the avatars migration leans on, arrived at deliberately here
-- rather than by inheritance: a column-list grant. `20260819180000` granted
-- `insert` on the whole table, and a table-level grant widens every time the
-- table gains a column — so it has to be narrowed now that one of the columns
-- is the gate.
--
-- Named columns only, and `state` is not among them. A client naming it is
-- refused by the grant before any policy is consulted; a client omitting it
-- gets the default. There is no UPDATE grant on this table at all, which is
-- what stops the other route to the same column.
revoke insert on public.task_media from authenticated;
grant insert (id, task_id, owner_id, path, width, height) on public.task_media to authenticated;

-- ─── the privilege nobody granted, again ──────────────────────────────────
--
-- `device_tokens` hit this exact trap and wrote it down; `task_media` walked
-- into it and nobody noticed, because until this migration no service-role
-- code had ever touched the table.
--
-- `repair_write_paths` granted `all on all tables` to service_role, which is
-- a statement about the tables that existed that day and does not reach one
-- created four migrations later. Every table added since has granted itself
-- explicitly — `goal_ratings`, `llm_usage`, `device_tokens`,
-- `bot_goal_candidates`, `blocks` — and `20260819180000` is the one that
-- forgot. It has been sitting there with `REFERENCES, TRIGGER, TRUNCATE` and
-- no DML at all.
--
-- Bypassing RLS is not permission to reach the table. Without this,
-- `screen-task-media`'s very first query comes back "permission denied for
-- table task_media", every call answers 503, and every photo stays `pending`
-- for ever — a gate with nothing behind it that can open it.
--
-- `select` to find the row, `delete` to take a refused one away. The
-- publishing UPDATE goes through `mark_task_media_ready`, which is SECURITY
-- DEFINER and so runs as its owner; `all` is granted anyway to match every
-- other table rather than leaving a fourth different shape to remember.
grant all on public.task_media to service_role;

-- Belt and braces, and not redundant: the grant above is what actually stops a
-- client naming `state`, but a grant is one line somebody widens in a hurry
-- two years from now. This is the line that fails the insert anyway when they
-- do.
drop policy task_media_insert on task_media;
create policy task_media_insert on task_media for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and state = 'pending'
    and exists (
      select 1 from tasks t where t.id = task_id and t.owner_id = (select auth.uid())
    )
  );

-- ─── the gate, on the row ─────────────────────────────────────────────────
--
-- `20260819200000`'s policy with one conjunct added. The block guard stays
-- paired with `can_see_task` exactly as that file argues it must be, and the
-- screening test joins the same branch: a photo reaches somebody else when
-- they are not blocked, they can see the task, *and* a model has passed it.
drop policy task_media_select on task_media;
create policy task_media_select on task_media for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      state = 'ready'
      and not private.block_between(owner_id)
      and private.can_see_task(task_id)
    )
  );

/**
 * The only route into `ready`, and service-role only.
 *
 * `mark_avatar_screened` with one state instead of two, for the reason given
 * at the constraint above: the other verdict deletes rather than marks, and
 * the service role can do that through the table directly.
 *
 * It moves rows that are `pending` and no others — the part of its sibling
 * that matters most. A replayed call cannot walk a photo back into view after
 * its owner removed it, because there is no longer a `pending` row to move.
 *
 * `authenticated` is named in the REVOKE rather than left to the default,
 * because a SECURITY DEFINER function that writes the gate column is the one
 * thing in this file that must never be callable by a client.
 */
create or replace function public.mark_task_media_ready(p_media uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.task_media
    set state = 'ready'
    where id = p_media and state = 'pending';
end;
$$;

revoke execute on function public.mark_task_media_ready(uuid)
  from public, anon, authenticated;
grant  execute on function public.mark_task_media_ready(uuid) to service_role;

/**
 * The gate, on the object.
 *
 * `20260819200000`'s function with one `exists` added, and the same structure
 * kept for the same reasons: both casts inside the guarded block, because the
 * object name is client-chosen and a 22P02 raised in a policy is an error on
 * somebody else's read rather than a refusal of this one; and the block
 * answered from the first path segment without reading a table.
 *
 * The lookup is by `path` rather than by the id in the name. `path` is what
 * the row actually claims, so an object whose name merely resembles a
 * screened one matches nothing.
 *
 * `security definer` is what lets this read `task_media` without the caller's
 * own RLS applying — which would otherwise be circular, since the policy
 * above is part of what this is enforcing. The screener reads with the
 * service role and bypasses RLS entirely, so gating on `ready` here does not
 * lock it out of the bytes it has to look at.
 */
create or replace function private.can_see_media(object_name text)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  owner  uuid;
  target uuid;
begin
  begin
    owner  := (storage.foldername(object_name))[1]::uuid;
    target := (storage.foldername(object_name))[2]::uuid;
  exception when others then
    return false;
  end;

  -- Your own photo, screened or not. The row policy says the same thing in
  -- its first branch, and the two must agree: a signed URL is minted against
  -- `storage.objects`, so a disagreement here is a file readable to someone
  -- who cannot read the row naming it, or the reverse.
  if owner = (select auth.uid()) then
    return private.can_see_task(target);
  end if;

  if private.block_between(owner) then
    return false;
  end if;

  if not exists (
    select 1 from public.task_media m
    where m.path = object_name and m.state = 'ready'
  ) then
    return false;
  end if;

  return private.can_see_task(target);
end;
$$;

revoke execute on function private.can_see_media(text) from public, anon;
grant execute on function private.can_see_media(text) to authenticated;

comment on column public.task_media.path is
  'The object name, and constrained to be exactly '
  '<owner_id>/<task_id>/<id>.jpg — the row''s own three ids and nothing else. '
  'Not decoration: screen-task-media holds the service role and both '
  'downloads and deletes this object, so a client-chosen string here would be '
  'a way to have one account''s photo deleted on another account''s say-so. '
  'The function derives the same name rather than reading this column, so the '
  'two guarantees stand independently.';

comment on column public.task_media.state is
  'pending | ready. Only `ready` is readable by anyone other than the owner, '
  'on this table and through the storage policy alike. There is no `refused`: '
  'a blocked photo loses its object and its row, so `unique (task_id)` does '
  'not strand the goal with a slot it can never reuse. Clients cannot reach '
  '`ready`: `state` is outside the INSERT column grant, the table has no '
  'UPDATE grant, and mark_task_media_ready is service_role only.';
