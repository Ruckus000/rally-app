-- A photo obeys a block, exactly as the task it hangs off now does.
--
-- Two changes landed on the same day and did not know about each other.
-- `20260819164832_reports_and_blocks.sql` taught every SELECT policy about
-- blocks, and it did so by *pairing* a guard with the audience helper at each
-- call site — `not private.block_between(...) and private.can_see_task(...)`
-- — deliberately leaving `can_see_task` itself as a statement about audience
-- and nothing else. `20260819180000_task_media.sql` was written before that
-- convention existed and calls `can_see_task` alone.
--
-- The consequence, had both simply shipped: block someone, and their own
-- `tasks_select` stops showing you their week — but `task_media_select` and
-- the storage policy behind it keep answering, because the helper they lean
-- on never learned the new rule. You would lose sight of the goal and keep
-- the photograph of it.
--
-- This closes that by adopting the convention rather than working around it:
-- the guard goes beside the helper, in both places, and `can_see_task` stays
-- what the other migration decided it should be.
--
-- Belt and braces on purpose: the row policy and the object policy are
-- checked independently — a signed URL is minted against `storage.objects`,
-- not against `task_media` — so a guard on only one of them would leave the
-- file readable to somebody who cannot read the row that names it.

drop policy task_media_select on task_media;

create policy task_media_select on task_media for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (not private.block_between(owner_id) and private.can_see_task(task_id))
  );

/**
 * The storage half. The path is `<owner_id>/<task_id>/<media_id>.jpg`, so the
 * block can be answered from the first segment without reading any table —
 * and the audience from the second, as before. Both casts stay guarded: the
 * object name is client-chosen, and a malformed one must answer false rather
 * than raise inside a policy, which would be an error on somebody else's read
 * rather than a refusal of this one.
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

  if owner <> (select auth.uid()) and private.block_between(owner) then
    return false;
  end if;

  return private.can_see_task(target);
end;
$$;

revoke execute on function private.can_see_media(text) from public, anon;
grant execute on function private.can_see_media(text) to authenticated;

comment on function private.can_see_media(text) is
  'Whether the caller may read a task-media object, from its name alone: the '
  'first path segment is the owner (blocks), the second is the task '
  '(audience). Pairs the block guard with can_see_task rather than folding it '
  'into that helper — the convention 20260819164832 set for every other '
  'select policy.';
