-- Somewhere to put a face, and a gate in front of it.
--
-- Two columns on `profiles`, a private bucket, four storage policies, and two
-- RPCs. The shape follows `task_media` — private bucket, signed reads, path
-- rooted at the owner, client-minted ids, no update policy on the row — and
-- this file only writes down where an avatar is *not* like a goal photo.
--
-- ─── why there is a state column at all ───────────────────────────────────
--
-- A goal photo is seen by the goal's audience. An avatar is seen by everyone
-- signed in, on every screen that names you: a cheer in someone's bell, a row
-- in a circle, a note on a stranger's public task. There is no audience
-- question to delegate to, so the question this column answers is a different
-- one — *has anyone looked at this image yet* — and it has to be answered
-- before the first render rather than after the first report.
--
-- `pending` therefore renders initials, **including to the owner**. That is
-- the part that looks like over-caution and is not. If an unscreened image
-- renders to its uploader, the uploader's screenshot is the distribution
-- channel, and the screening step has bought a delay rather than a decision.
-- The only state in which bytes reach a screen is `ready`.
--
-- `refused` is kept distinct from `none` so the app can say why nothing
-- appears. Collapsing them would make a refusal indistinguishable from an
-- upload that silently failed, and the user would keep retrying it.
--
-- ─── what a client may write, and the check that found it ─────────────────
--
-- The obvious hole in a design like this is that the state column is just a
-- column on a row the client already updates: if a client can write
-- `avatar_state = 'ready'`, every paragraph above is decoration.
--
-- It cannot, and the reason is already in the tree.
-- `20260813120745_oz_bots.sql` replaced the table-level UPDATE grant with
-- `grant update (name) on public.profiles to authenticated` — a column list,
-- so that anybody could not promote themselves to `is_bot`. A column-level
-- grant does not widen when the table gains columns, so `avatar_path` and
-- `avatar_state` arrive unwritable by `authenticated`, by inheritance rather
-- than by anybody's decision here. `profiles_update`'s USING/WITH CHECK never
-- even get consulted: the grant fails first, with *permission denied for table
-- profiles* — Postgres's generic wording for a column-privilege miss, and the
-- reason the accompanying HINT unhelpfully suggests granting UPDATE on the
-- whole table. Do not take the hint.
--
-- That is the gate, and it is a good one — but "safe because of a grant three
-- migrations away" is exactly the coupling the reports migration warns about
-- at length. So two things follow.
--
-- First, nothing below grants those columns. Not `avatar_path` either: the
-- temptation, when the upload screen needs somewhere to record the object
-- name, will be `grant update (name, avatar_path, avatar_state)`, and that one
-- line hands over the whole gate along with the bit that was needed. It is
-- written here so the next person reads it before typing it.
--
-- Second, the write path the client actually needs exists now rather than
-- later, so nobody has to invent one under deadline. `public.set_avatar` is
-- the whole of it, and it cannot express `ready`: the state is a literal in
-- its body, not a parameter. The transition into `ready` lives in
-- `public.mark_avatar_screened`, which is revoked from every role a client can
-- hold — the shape `register_device` uses, with the same reasoning about
-- SECURITY DEFINER functions in `public` being open endpoints until told
-- otherwise.
--
-- Both halves are testable and differ observably: a direct UPDATE is refused
-- by the grant, `set_avatar` cannot name a state at all, and
-- `mark_avatar_screened` is refused to `authenticated` by EXECUTE.

alter table public.profiles
  -- The object name in the `avatars` bucket, never a URL. Same reasoning as
  -- `task_media.path`: the bucket is private, reads are signed URLs minted per
  -- pull, and a URL stored here would be one that expires in the database.
  add column avatar_path text,

  -- Defaulted rather than nullable, because "no avatar" and "not yet decided"
  -- are different answers and a null would have to stand in for both. Every
  -- existing row gets 'none', which is true of all of them.
  add column avatar_state text not null default 'none';

alter table public.profiles
  add constraint profiles_avatar_state_known
  check (avatar_state in ('none', 'pending', 'ready', 'refused'));

-- ─── the bucket ───────────────────────────────────────────────────────────
--
-- Private, for the reason `task_media` gives: a public bucket moves visibility
-- out of RLS and into "does anyone know the URL". That argument is usually
-- made about content with a narrow audience, and an avatar's audience is every
-- signed-in account — so it is worth saying why it still applies. It is not
-- the *ready* image that a public bucket would expose. It is the `pending`
-- one and the `refused` one, which live in the same bucket under a name the
-- uploader chose and therefore knows. A public bucket would make the screening
-- gate a client-side render rule with the bytes sitting behind a guessable URL
-- the whole time, and the one image it must hold back is precisely the one
-- someone has a reason to go looking for.
--
-- 2 MB rather than task-media's 5: a face at avatar sizes is smaller than a
-- goal photo, and the client downscales to a few hundred KB before upload.
-- The ceiling is the backstop for a client that does not, not the target.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  false,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- ─── storage policies ─────────────────────────────────────────────────────
--
-- The path is `<owner_id>/<avatar_id>.jpg`, so the first segment is the owner
-- and ownership is checkable without reading another table.
--
-- Note what is *not* here: no cast of the path segment to uuid. `task_media`
-- needed the second segment as a real uuid to look a task up, and paid for it
-- with an exception handler; here the question is only "is this string the
-- caller's id", so the comparison is text against text and the malformed case
-- is a policy miss instead of a raised error. That matters more than it looks:
-- object names are client-chosen, and a 22P02 raised inside a policy is not
-- one bad upload failing, it is that policy failing for whoever evaluates it
-- next — the same trap `20260819164832` hit with `payload ->> 'actor_id'` and
-- guarded with a regex. Casting the other side, `auth.uid()::text`, is safe
-- because it is a uuid or null and never malformed.
--
-- Read: any signed-in account. Avatars are visible to everyone by product
-- decision — a face is what makes a name in a bell mean something — so there
-- is no audience helper to call and inventing one would be inventing a rule
-- the product does not have. `anon` still gets nothing: the policy is
-- `to authenticated` and the bucket is private, so an unsigned request has no
-- route to a signed URL.
--
-- The gate is not enforced here, and that is deliberate rather than an
-- oversight. Storage cannot ask `profiles.avatar_state` without another
-- SECURITY DEFINER helper joining objects to rows by name, and it would be
-- guarding the wrong thing anyway: the screener itself has to read the pending
-- bytes to judge them. The gate is `avatar_state` deciding whether the app
-- ever asks for a signed URL — which is why the state column, not the storage
-- policy, is the thing this migration guards hardest.
create policy avatars_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars');

create policy avatars_objects_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- `update` is granted for the same reason `task_media` grants it: an upload
-- with `upsert: true`, which is what makes a retried upload idempotent rather
-- than a second object, is an UPDATE when the object already exists. This is
-- not a "replace your avatar" path — replacing is delete plus insert, so the
-- new object gets a new name and a new screening pass, and no cached signed
-- URL keeps resolving to bytes that have been swapped underneath it.
create policy avatars_objects_update on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatars_objects_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ─── the two write paths ──────────────────────────────────────────────────
--
-- Both follow `register_device`: SECURITY DEFINER so the write happens as the
-- function's owner on columns the client is granted nothing on, an empty
-- `search_path` so every name resolves explicitly, and `auth.uid()` read
-- inside rather than taken as an argument — an actor you accept as a parameter
-- is an actor the caller chooses.

/**
 * Point your profile at an object you have just uploaded, or clear it.
 *
 * The state is a literal here, and that is the entire security property of
 * this function: there is no argument through which a caller can express
 * 'ready' or 'refused'. A client can move itself into 'pending' and back to
 * 'none' and nowhere else, which is the same rule stated in the task brief as
 * the alternative to a service-role-only RPC — this file does both, because
 * the client needs *a* write path and this is the one that cannot be widened
 * by accident.
 *
 * The path is checked against the caller's own folder. The storage policies
 * already stop you writing an object under someone else's prefix, but nothing
 * stops you *naming* one: without this check you could point your profile at a
 * stranger's object and wear their face. It is a text comparison for the same
 * reason the policies are — the segment is client-chosen input, and a cast
 * here would raise inside a function the client calls directly.
 */
create or replace function public.set_avatar(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- Clearing. Straight to 'none': removing your photo is not a thing anyone
  -- needs to screen, and leaving it 'pending' would queue work for an image
  -- that is no longer referenced.
  if p_path is null then
    update public.profiles
      set avatar_path = null, avatar_state = 'none'
      where id = me;
    return;
  end if;

  if coalesce((storage.foldername(p_path))[1], '') <> me::text then
    raise exception 'avatar path must be in your own folder'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.profiles
    set avatar_path = p_path, avatar_state = 'pending'
    where id = me;
end;
$$;

/**
 * The screener's verdict, and the only way into 'ready'.
 *
 * Takes the profile as a parameter — unlike every other RPC in this schema —
 * because the caller is not the subject. This runs from the edge function that
 * screens the image, holding the service-role key, on behalf of whoever
 * uploaded it. That is exactly why the revoke below is not boilerplate: a
 * function that writes any row it is told to, left executable by
 * `authenticated`, is a worse hole than the column grant this file exists to
 * avoid widening.
 *
 * `refused` is accepted; 'none' and 'pending' are not. A screener has two
 * verdicts, and letting it write the states that mean "not screened yet"
 * would let a bug walk an image backwards into a queue it already left.
 */
create or replace function public.mark_avatar_screened(p_profile uuid, p_state text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_state not in ('ready', 'refused') then
    raise exception 'not a screening verdict: %', p_state
      using errcode = 'invalid_parameter_value';
  end if;

  -- Only a profile that is actually waiting on a verdict. Without this, a
  -- replayed call could mark an avatar 'ready' after the owner had already
  -- removed it — publishing an image its subject believed was gone.
  update public.profiles
    set avatar_state = p_state
    where id = p_profile and avatar_state = 'pending';
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, so a SECURITY
-- DEFINER function in `public` is an open endpoint until told otherwise.
revoke execute on function public.set_avatar(text) from public, anon;
grant  execute on function public.set_avatar(text) to authenticated;

-- The load-bearing one. `authenticated` is named in the revoke as well as
-- `public` and `anon`: this is the function that can publish an unscreened
-- image, and the whole gate is that no role a client can hold may call it.
revoke execute on function public.mark_avatar_screened(uuid, text)
  from public, anon, authenticated;
grant  execute on function public.mark_avatar_screened(uuid, text) to service_role;

-- No `grant update (avatar_path, avatar_state)` here, and none anywhere later.
-- `authenticated` holds `update (name)` on this table and that is the complete
-- list; both new columns are written only by the two functions above.

comment on column public.profiles.avatar_path is
  'Object name in the private `avatars` bucket, never a URL. Written only by set_avatar.';

comment on column public.profiles.avatar_state is
  'none | pending | ready | refused. Only `ready` may render bytes — `pending` renders initials to everyone including the owner, so an unscreened image has no path to a screen. Clients reach `pending`/`none` via set_avatar and cannot reach `ready`: the column carries no UPDATE grant, and mark_avatar_screened is service_role only.';
