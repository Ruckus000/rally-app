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

/**
 * The digest algorithms, as values rather than a TypeScript enum.
 *
 * `appleAuth.ts` passes `CryptoDigestAlgorithm.SHA256` through to
 * `digestStringAsync`, so the constant has to exist at runtime under test or the
 * call throws on a property of `undefined` before it reaches the mock below.
 */
export const CryptoDigestAlgorithm = { SHA256: 'SHA-256' } as const;

/**
 * Not a hash, and it must not pretend to be one.
 *
 * The only property any test depends on is that hashing is *not* the identity
 * function: `appleAuth` sends this to Apple and the raw nonce to Supabase, and a
 * mock that returned its input would let the two be swapped with every test still
 * green — which is precisely the bug the real code's comment warns about.
 */
export async function digestStringAsync(algorithm: string, data: string): Promise<string> {
  return `${algorithm}:${data}`;
}
