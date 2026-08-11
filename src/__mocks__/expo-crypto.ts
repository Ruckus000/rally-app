/**
 * A real v4 uuid, in tests.
 *
 * Picked up automatically for every unit test, the same way the supabase-js
 * mock is. jest-expo stubs the native module behind `expo-crypto`, so the real
 * `randomUUID()` returns `undefined` under test — which would hand every task
 * the same id and quietly break every assertion that looks one up.
 *
 * Counter-based rather than random: a duplicate id in a suite is a confusing
 * failure a long way from its cause, and determinism costs nothing here.
 */
let n = 0;

export function randomUUID(): string {
  n += 1;
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}
