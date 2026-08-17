/**
 * The seeded world, and the single place its handles are spelled.
 *
 * `supabase/seed.sql` is written by hand from this file; `integration/world.test.ts`
 * asserts the two still agree, so adding a seventh person to the demo circle
 * fails loudly rather than quietly desyncing the suites. That sentence described
 * a file that did not exist until it was written to catch something — see its
 * own header.
 *
 * The circle shape is chosen to make the *negative* RLS assertions sharp:
 *
 *   basement  maya, dre, nana        — the ordinary shared circle
 *   gym       maya, sofia            — shares a circle, but not *that* circle
 *   outsiders jordan, tomas          — shares nothing with maya
 *
 * tomas is additionally paired on one of maya's private tasks, which is the
 * only way to be able to see a private task without sharing any circle.
 */

export const SEED_PASSWORD = 'rally-test-password';

/** Handles must satisfy profiles.handle: ^[a-z0-9_.]{3,30}$ */
export const SEED_USERS = {
  you: { handle: 'you_rally', name: 'Alex Rivera', email: 'you@rally.test' },
  maya: { handle: 'maya', name: 'Maya Chen', email: 'maya@rally.test' },
  dre: { handle: 'dre', name: 'Dre Okafor', email: 'dre@rally.test' },
  jordan: { handle: 'jordan', name: 'Jordan Lee', email: 'jordan@rally.test' },
  sofia: { handle: 'sofia', name: 'Sofia Park', email: 'sofia@rally.test' },
  nana: { handle: 'nana', name: 'Nana Rosa', email: 'nana@rally.test' },
  tomas: { handle: 'tomas', name: 'Tomas Vega', email: 'tomas@rally.test' },
} as const;

export type SeedHandle = keyof typeof SEED_USERS;

/**
 * The Oz bots, seeded alongside the people.
 *
 * Deliberately outside `SEED_USERS`: everything in there gets signed in during
 * `beforeAll`, and a bot has no password and no `auth.identities` row because
 * nothing ever signs in as one. They exist to be *read* — by strangers, which
 * is the whole of their purpose and the reason `profiles_select` names them.
 *
 * They are also the seeded accounts the product's own tooling touches:
 * `scripts/seed-bots.mjs` adopts these rows by handle instead of creating a
 * second cast, which is why the addresses below have to be the ones it names.
 * Their ids are fixed here and in `seed.sql` for the same reason every other id
 * in this file is — so a `db reset` produces the same world twice.
 */
export const SEED_BOTS = [
  {
    id: '00000000-0000-4000-8000-0000000000b0',
    handle: 'dorothy.gale',
    name: 'Dorothy Gale',
    email: 'dorothy@rally.test',
  },
  {
    id: '00000000-0000-4000-8000-0000000000b1',
    handle: 'the.scarecrow',
    name: 'The Scarecrow',
    email: 'scarecrow@rally.test',
  },
  {
    id: '00000000-0000-4000-8000-0000000000b2',
    handle: 'tin.man',
    name: 'Tin Man',
    email: 'tinman@rally.test',
  },
  {
    id: '00000000-0000-4000-8000-0000000000b3',
    handle: 'cowardly.lion',
    name: 'Cowardly Lion',
    email: 'lion@rally.test',
  },
] as const;

/**
 * Dorothy, for the tests that need *a* bot rather than all of them — a cheer
 * has one author, and `bot_cheer` takes one id.
 */
export const SEED_BOT = SEED_BOTS[0];

/**
 * Every bot handle, sorted, because that is how `profiles` reads back.
 *
 * Visibility assertions are written as "the bots, plus whoever I share a circle
 * with": the bots are in every such list by design, and spelling four of them
 * into each expectation would bury the part that is actually under test.
 */
export const BOT_HANDLES: string[] = SEED_BOTS.map((b) => b.handle).sort();

/** Fixed uuids so seed.sql and these tests can name the same rows. */
export const CIRCLE_IDS = {
  basement: '11111111-1111-4111-8111-111111111111',
  gym: '22222222-2222-4222-8222-222222222222',
  outsiders: '33333333-3333-4333-8333-333333333333',
} as const;

export const MEMBERSHIPS: Record<keyof typeof CIRCLE_IDS, SeedHandle[]> = {
  basement: ['maya', 'dre', 'nana'],
  gym: ['maya', 'sofia'],
  outsiders: ['jordan', 'tomas'],
};

/** Everyone who shares at least one circle with maya. */
export const SHARES_A_CIRCLE_WITH_MAYA: SeedHandle[] = ['dre', 'nana', 'sofia'];
export const SHARES_NOTHING_WITH_MAYA: SeedHandle[] = ['jordan', 'tomas'];

export const SEED_HANDLES = Object.keys(SEED_USERS) as SeedHandle[];

/** The constraint on profiles.handle, mirrored so the seed can be checked. */
export const HANDLE_RE = /^[a-z0-9_.]{3,30}$/;
