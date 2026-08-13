-- A cheer on your task becomes a notification you can actually see.
--
-- Until now the count on the Me screen went up and nothing said who or when.
-- The client cannot write this itself and should not be able to: `notifications`
-- is granted `select, update` only and has no INSERT policy, because a table
-- where one account can write rows into another account's feed is a spam
-- surface. So the row is written here, by the database, from what it already
-- knows — the actor cannot influence any field except by genuinely cheering.
--
-- SECURITY DEFINER for that reason, with `set search_path = ''` so every name
-- below is resolved explicitly rather than through whatever the caller's path
-- happens to be.

create or replace function private.notify_on_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  task_title text;
  actor_name text;
begin
  -- Only cheers, and only on tasks. The other kinds ('in', 'cosign', 'nod',
  -- 'share') are acknowledgements rather than something landing on someone,
  -- and `post` has no backing table to name an owner.
  if new.kind <> 'cheer' or new.target_type <> 'task' then
    return new;
  end if;

  select t.owner_id, t.title into owner_id, task_title
  from public.tasks t
  where t.id = new.target_id;

  -- The row is gone, or it is your own task. Cheering yourself is not news,
  -- and a notification addressed to the person who caused it is noise.
  if owner_id is null or owner_id = new.actor_id then
    return new;
  end if;

  select p.name into actor_name from public.profiles p where p.id = new.actor_id;

  -- `payload` carries what the row renders, so the client needs no second read
  -- to draw it: `notifications_select` is scoped to the recipient, but a
  -- *profile* is only readable when you share a circle — and a cheer can come
  -- from an `aud = 'everyone'` task, where you might share none.
  insert into public.notifications (recipient_id, tier, kind, payload)
  values (
    owner_id,
    'circle',
    'cheer',
    jsonb_build_object(
      'actor_id', new.actor_id,
      'actor_name', coalesce(actor_name, 'Someone'),
      'task_id', new.target_id,
      'task_title', coalesce(task_title, '')
    )
  );

  return new;
end;
$$;

create trigger notify_on_reaction
  after insert on public.reactions
  for each row execute function private.notify_on_reaction();

-- Withdrawing a cheer takes the notification with it. Leaving it would leave a
-- claim on someone's screen that the ledger no longer supports — and the unique
-- (actor, target_type, target_id, kind) tuple means a re-cheer writes a fresh
-- one, so this cannot lose a notification that is still true.
create or replace function private.unnotify_on_reaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.kind <> 'cheer' or old.target_type <> 'task' then
    return old;
  end if;

  delete from public.notifications n
  where n.kind = 'cheer'
    and n.payload ->> 'actor_id' = old.actor_id::text
    and n.payload ->> 'task_id' = old.target_id::text;

  return old;
end;
$$;

create trigger unnotify_on_reaction
  after delete on public.reactions
  for each row execute function private.unnotify_on_reaction();

-- The feed is read newest-first and filtered by tier; both indexes it already
-- has are for the unread badge, which is a different question.
create index if not exists notifications_recipient_recent_idx
  on public.notifications (recipient_id, created_at desc);
