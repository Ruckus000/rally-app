/**
 * The seeded world, and the single place its handles are spelled.
 *
 * `supabase/seed.sql` is written by hand from this file; `world.test.ts`
 * asserts the two still agree, so adding a seventh person to the demo circle
 * fails loudly rather than quietly desyncing the suites.
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
