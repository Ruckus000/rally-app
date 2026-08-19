-- A photo on a goal, and the one rule it must not get its own copy of.
--
-- "No way to add images/vids on goals" — the owner, on the audit. This is the
-- server half: somewhere to put the file, a row that says which task it
-- belongs to, and policies that decide who may see it.
--
-- ─── the rule this does not restate ───────────────────────────────────────
--
-- Who can see a task is `private.can_see_task`, written once in init.sql:
-- owner always, circle on `friends`, anyone on `everyone`, owner-and-pairs on
-- `private`. A photo attached to a task is not a second question — it is the
-- same question about the same row. So both policies below *call* that
-- function rather than re-deriving the audience, and a change to the audience
-- model changes what a photo is worth without anything here being touched.
--
-- That is the whole design. The expensive version of this feature is the one
-- where the storage policy grows its own copy of the audience rule, the two
-- drift, and a `private` task's photo stays readable to a circle that lost
-- sight of the task months ago.
--
-- ─── one photo, for now ───────────────────────────────────────────────────
--
-- `unique (task_id)` is v1's whole scope decision, and it is a line that can
-- be dropped later without touching anything else. Video is deliberately not
-- here: it needs size limits, transcoding and a player, and none of that
-- changes the shape below.

create table task_media (
  -- Client-minted, like `notes.id` and for the same reason: it is what makes
  -- a replayed insert collide with itself instead of attaching the same photo
  -- twice.
  id         uuid primary key,
  task_id    uuid not null references tasks (id) on delete cascade,
  owner_id   uuid not null references profiles (id) on delete cascade,
  -- The object name in the `task-media` bucket. Not a URL: the bucket is
  -- private, so what a client gets is a signed URL minted per read, and a URL
  -- stored here would be one that expires in the database.
  path       text not null,
  -- So a card can reserve the right space before the image arrives, instead
  -- of reflowing the feed when it does.
  width      integer check (width is null or width > 0),
  height     integer check (height is null or height > 0),
  created_at timestamptz not null default now(),
  unique (task_id)
);

create index task_media_task_idx on task_media (task_id);

alter table task_media enable row level security;

-- Read: exactly what the task's own audience says, and nothing else.
create policy task_media_select on task_media for select to authenticated
  using (private.can_see_task(task_id));

-- Write: your own, on your own task. `with check` pins both halves — a client
-- that names someone else's task, or someone else as owner, is refused rather
-- than trusted.
create policy task_media_insert on task_media for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from tasks t where t.id = task_id and t.owner_id = (select auth.uid())
    )
  );

-- Delete: the owner's, so a photo can be taken back. No update policy: a
-- photo is replaced by removing it and attaching another, which keeps the
-- storage object and the row in step with one operation each.
create policy task_media_delete on task_media for delete to authenticated
  using (owner_id = (select auth.uid()));

grant select, insert, delete on public.task_media to authenticated;

-- ─── the bucket ───────────────────────────────────────────────────────────
--
-- Private. A public bucket would move visibility out of RLS and into "does
-- anyone know the URL", which for a `private` task is exactly the wrong
-- answer — see docs/backend.md on where the audience model is allowed to
-- live. Reads are signed URLs, minted per pull, which require the select
-- policy below to pass.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-media',
  'task-media',
  false,
  5242880, -- 5 MB; the client downscales to a few hundred KB before upload
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

/**
 * Which task an object belongs to, read off its own name.
 *
 * The path is `<owner_id>/<task_id>/<media_id>.jpg`, so the second segment is
 * the task. It is untrusted input like any other — a client picks its own
 * object names — so the cast is guarded: a name that is not a uuid answers
 * false rather than raising 22P02 inside a policy, which would turn a
 * malformed upload into an error on somebody else's read.
 */
create or replace function private.can_see_media(object_name text)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  target uuid;
begin
  begin
    target := (storage.foldername(object_name))[2]::uuid;
  exception when others then
    return false;
  end;
  return private.can_see_task(target);
end;
$$;

revoke execute on function private.can_see_media(text) from public, anon, authenticated;
grant execute on function private.can_see_media(text) to authenticated;

-- Read an object when you may read the task it hangs off. One rule, one place.
create policy task_media_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'task-media' and private.can_see_media(name));

-- Write into your own folder, and only there. The first segment is the owner,
-- which is what makes this checkable without reading any other table.
create policy task_media_objects_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Replace and remove your own. `update` is granted because an upload with
-- `upsert: true` — which is what makes a retried upload idempotent rather
-- than a duplicate — is an update when the object already exists.
create policy task_media_objects_update on storage.objects for update to authenticated
  using (
    bucket_id = 'task-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'task-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy task_media_objects_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

comment on table task_media is
  'One photo per task (v1). Read access delegates to private.can_see_task, so '
  'the audience model is stated once and a photo can never outlive the '
  'visibility of the goal it is attached to. The row carries the storage '
  'object name, never a URL: the bucket is private and reads are signed.';
