-- Seed world for the integration suite. LOCAL ONLY — never pushed to a hosted
-- project. Loaded automatically by `supabase db reset` via [db.seed].
--
-- Written by hand from integration/fixtures/world.ts, which is the single
-- source of truth for handles and ids. integration/world.test.ts asserts the
-- two still agree.
--
-- The circle shape exists to make the negative RLS assertions sharp:
--   basement   maya, dre, nana     the ordinary shared circle
--   gym        maya, sofia         shares a circle, but not *that* circle
--   outsiders  jordan, tomas       shares nothing with maya
--
-- No tasks, reactions or notes here: those are built per test, so a test's
-- setup stays readable inside the test.

set search_path = '';

do $$
declare
  seed_password constant text := 'rally-test-password';
  person record;
  uid uuid;
begin
  for person in
    select * from (values
      ('you_rally', 'Alex Rivera', 'you@rally.test',    '00000000-0000-4000-8000-00000000000a'::uuid),
      ('maya',      'Maya Chen',   'maya@rally.test',   '00000000-0000-4000-8000-00000000000b'::uuid),
      ('dre',       'Dre Okafor',  'dre@rally.test',    '00000000-0000-4000-8000-00000000000c'::uuid),
      ('jordan',    'Jordan Lee',  'jordan@rally.test', '00000000-0000-4000-8000-00000000000d'::uuid),
      ('sofia',     'Sofia Park',  'sofia@rally.test',  '00000000-0000-4000-8000-00000000000e'::uuid),
      ('nana',      'Nana Rosa',   'nana@rally.test',   '00000000-0000-4000-8000-00000000000f'::uuid),
      ('tomas',     'Tomas Vega',  'tomas@rally.test',  '00000000-0000-4000-8000-000000000010'::uuid)
    ) as t(handle, name, email, id)
  loop
    uid := person.id;

    -- Fails loudly here rather than confusingly inside a policy later.
    if person.handle !~ '^[a-z0-9_.]{3,30}$' then
      raise exception 'seed handle % violates profiles.handle check', person.handle;
    end if;

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
      person.email,
      extensions.crypt(seed_password, extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('handle', person.handle, 'name', person.name),
      '', '', '', ''
    )
    on conflict (id) do nothing;

    -- gotrue refuses to sign in a user with no matching identity row.
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      extensions.uuid_generate_v4(), uid, uid::text,
      jsonb_build_object('sub', uid::text, 'email', person.email),
      'email', now(), now(), now()
    )
    on conflict (provider, provider_id) do nothing;

    -- Once the repair migration lands, handle_new_user will have created this
    -- row already; overwrite the generated handle with the readable one.
    insert into public.profiles (id, handle, name)
    values (uid, person.handle, person.name)
    on conflict (id) do update
      set handle = excluded.handle, name = excluded.name;
  end loop;
end $$;

-- ─── the oz bots ──────────────────────────────────────────────────────────
--
-- Openly fictional accounts, readable by everyone — which is what makes them
-- the control on `profiles_select`: if a stranger can read Dorothy but still
-- cannot read Jordan, the policy was widened rather than opened.
--
-- All four, at fixed ids, and that is the point of the loop. `scripts/
-- seed-bots.mjs` creates whichever of them it cannot find by handle, and
-- `auth.admin.createUser` picks the uuid — so on a stack seeded before this
-- block existed, three of the four were re-minted with new ids on every
-- `db reset`, while Dorothy's stayed put. The app keyed its people directory by
-- id, so each reset left the composer offering the same character twice: once
-- as the row it had, once as the row it has. That directory prunes itself now
-- (see `SERVER_MERGE`), but a cast whose ids change under a local database is
-- still a cast nothing else can name — including this file's own tests.
--
-- The addresses have to be the ones the script names, for the reason its
-- comment gives: it adopts these rows rather than making a second set.
--
-- No `auth.identities` rows, because nothing ever signs in as one. The password
-- column is left as the empty string gotrue writes for a user who cannot
-- authenticate; there is no credential here to leak.

do $$
declare
  bot record;
begin
  for bot in
    select * from (values
      ('dorothy.gale',  'Dorothy Gale',   'dorothy@rally.test',   '00000000-0000-4000-8000-0000000000b0'::uuid),
      ('the.scarecrow', 'The Scarecrow',  'scarecrow@rally.test', '00000000-0000-4000-8000-0000000000b1'::uuid),
      ('tin.man',       'Tin Man',        'tinman@rally.test',    '00000000-0000-4000-8000-0000000000b2'::uuid),
      ('cowardly.lion', 'Cowardly Lion',  'lion@rally.test',      '00000000-0000-4000-8000-0000000000b3'::uuid)
    ) as t(handle, name, email, id)
  loop
    if bot.handle !~ '^[a-z0-9_.]{3,30}$' then
      raise exception 'seed handle % violates profiles.handle check', bot.handle;
    end if;

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', bot.id,
      'authenticated', 'authenticated', bot.email, '',
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('handle', bot.handle, 'name', bot.name),
      '', '', '', ''
    )
    on conflict (id) do nothing;

    insert into public.profiles (id, handle, name, is_bot)
    values (bot.id, bot.handle, bot.name, true)
    on conflict (id) do update
      set handle = excluded.handle, name = excluded.name, is_bot = excluded.is_bot;
  end loop;
end $$;

-- ─── circles ──────────────────────────────────────────────────────────────

insert into public.circles (id, name, invite_code, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'The Basement', 'the-basement-1111111111111111',
   '00000000-0000-4000-8000-00000000000b'),
  ('22222222-2222-4222-8222-222222222222', 'Gym',          'gym-2222222222222222',
   '00000000-0000-4000-8000-00000000000b'),
  ('33333333-3333-4333-8333-333333333333', 'Outsiders',    'outsiders-3333333333333333',
   '00000000-0000-4000-8000-00000000000d')
on conflict (id) do nothing;

insert into public.circle_members (circle_id, profile_id) values
  -- basement: maya, dre, nana
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-00000000000b'),
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-00000000000c'),
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-00000000000f'),
  -- gym: maya, sofia
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-4000-8000-00000000000b'),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-4000-8000-00000000000e'),
  -- outsiders: jordan, tomas
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-4000-8000-00000000000d'),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-4000-8000-000000000010')
on conflict (circle_id, profile_id) do nothing;
