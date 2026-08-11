-- Closes the two holes the integration suite surfaced.
--
-- 1. `circle_members_insert` checked only `profile_id = auth.uid()`, so anyone
--    who learned a circle_id could add themselves with no invite — and then
--    read that circle's invite_code, which makes the leak self-propagating.
--    An invite code is supposed to be the gate; it wasn't one.
--
-- 2. Invite codes like `basement-9x2` are guessable, and join_circle_by_code
--    is an oracle for testing guesses. The code is the only secret in the
--    join flow, so it needs real entropy.
--
-- The fix routes ALL membership changes through SECURITY DEFINER functions and
-- takes direct INSERT away from clients. Creating a circle and joining one are
-- the only two ways membership is ever granted, and both check auth.uid().

-- ─── creating a circle ────────────────────────────────────────────────────
--
-- Was: client inserts into `circles`, then inserts itself into
-- `circle_members`. Two round trips, a window where a circle exists with no
-- members, and a client-chosen invite_code. Now one call.
--
-- The code is a readable slug plus 64 bits from gen_random_bytes, so it still
-- reads like `basement-a3f19c2e77b4d081` in a share link but cannot be
-- guessed. The slug is derived from the name and carries no secrecy.

create or replace function public.create_circle(circle_name text)
returns table (id uuid, invite_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  slug   text;
  code   text;
  new_id uuid;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if circle_name is null or length(btrim(circle_name, E' \t\n\r')) = 0 then
    raise exception 'circle name is required' using errcode = '23514';
  end if;

  -- 'The Basement' -> 'the-basement'; fall back if the name is all punctuation.
  slug := nullif(btrim(regexp_replace(lower(circle_name), '[^a-z0-9]+', '-', 'g'), '-'), '');
  slug := coalesce(left(slug, 24), 'circle');
  code := slug || '-' || encode(extensions.gen_random_bytes(8), 'hex');

  insert into public.circles (name, invite_code, created_by)
  values (circle_name, code, caller)
  returning circles.id into new_id;

  insert into public.circle_members (circle_id, profile_id)
  values (new_id, caller);

  return query select new_id, code;
end;
$$;

revoke execute on function public.create_circle(text) from public, anon;
grant execute on function public.create_circle(text) to authenticated;

-- ─── membership is no longer client-writable ──────────────────────────────
--
-- Leaving is still yours to do, so DELETE stays. INSERT does not: the two
-- functions above are the only paths in, and both verify the caller.

drop policy circle_members_insert on public.circle_members;
revoke insert on public.circle_members from authenticated;

-- Same reasoning for `circles` itself — create_circle() owns creation, so a
-- client can no longer mint a circle with an invite_code of its choosing.
drop policy circles_insert on public.circles;
revoke insert on public.circles from authenticated;

-- ─── the codes that already exist ─────────────────────────────────────────
--
-- Generating strong codes from here on does nothing for the circles that
-- already have weak ones — `basement-9x2` is a 3-character suffix, about
-- 47k guesses against an oracle with no rate limit, which is minutes. The
-- migration's whole point is unmet for exactly the circles that predate it,
-- so they are rotated rather than grandfathered.
--
-- Anyone holding an old link loses it. With no real users yet that costs
-- nothing; after launch it would need a rotation notice instead.

update public.circles
set invite_code = coalesce(
      nullif(btrim(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), '-'), ''),
      'circle'
    ) || '-' || encode(extensions.gen_random_bytes(8), 'hex')
where invite_code !~ '-[0-9a-f]{16}$';

-- And make it structural, so no future path can reintroduce a weak one.
alter table public.circles add constraint circles_invite_code_entropy
  check (invite_code ~ '-[0-9a-f]{16}$');

-- ─── a name is not a payload ──────────────────────────────────────────────
--
-- lower() and regexp_replace() would otherwise run over up to a gigabyte of
-- caller-supplied text, and the whole thing lands in circles.name.

alter table public.circles add constraint circles_name_length
  check (length(name) <= 80);

-- ─── privileges nobody asked for ──────────────────────────────────────────
--
-- There is a default ACL on this database granting `anon` and `authenticated`
-- everything on any table `postgres` creates. The explicit grants above trim
-- select/insert/update/delete, but TRUNCATE, REFERENCES, TRIGGER and MAINTAIN
-- survived on all ten tables — verified directly in pg_class.relacl.
--
-- TRUNCATE ignores row-level security completely. PostgREST cannot issue one
-- today, so this is a latent footgun rather than a live hole, but it means the
-- schema's integrity would rest on no future function ever running
-- invoker-side dynamic SQL. Cheaper to not have the grant.

revoke truncate, references, trigger, maintain
  on all tables in schema public from anon, authenticated;
