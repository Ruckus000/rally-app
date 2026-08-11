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

-- ─── circles ──────────────────────────────────────────────────────────────

insert into public.circles (id, name, invite_code, created_by) values
  ('11111111-1111-4111-8111-111111111111', 'The Basement', 'basement-9x2',
   '00000000-0000-4000-8000-00000000000b'),
  ('22222222-2222-4222-8222-222222222222', 'Gym',          'gym-4k7',
   '00000000-0000-4000-8000-00000000000b'),
  ('33333333-3333-4333-8333-333333333333', 'Outsiders',    'outsiders-1a3',
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
