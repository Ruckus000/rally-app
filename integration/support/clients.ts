/**
 * Authenticated clients, one per seeded user.
 *
 * `persistSession: false` and `autoRefreshToken: false` are not optional: the
 * refresh timer keeps the Node process alive and Jest hangs past the final
 * assertion. Tokens are valid an hour, comfortably longer than any run.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import { SEED_PASSWORD, SEED_USERS, type SeedHandle } from '../fixtures/world';

const url = () => process.env.RALLY_IT_URL as string;
const anonKey = () => process.env.RALLY_IT_ANON_KEY as string;
const serviceKey = () => process.env.RALLY_IT_SERVICE_KEY as string;

const base = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  // Node 20 has no global WebSocket and supabase-js constructs a realtime
  // client eagerly, so createClient throws without this. Test-harness only —
  // React Native provides WebSocket natively, so the app needs nothing.
  realtime: { transport: ws as unknown as never },
};

const tokens = new Map<SeedHandle, string>();
const ids = new Map<SeedHandle, string>();
const clients = new Map<string, SupabaseClient>();

export async function signInAllSeedUsers(): Promise<void> {
  if (tokens.size) return;
  const anon = createClient(url(), anonKey(), base);

  for (const handle of Object.keys(SEED_USERS) as SeedHandle[]) {
    const { data, error } = await anon.auth.signInWithPassword({
      email: SEED_USERS[handle].email,
      password: SEED_PASSWORD,
    });
    if (error || !data.session) {
      throw new Error(`could not sign in seeded user "${handle}": ${error?.message}`);
    }
    tokens.set(handle, data.session.access_token);
    ids.set(handle, data.session.user.id);
  }
}

/** The profile id of a seeded user. Available after signInAllSeedUsers(). */
export function idOf(handle: SeedHandle): string {
  const id = ids.get(handle);
  if (!id) throw new Error(`no id for "${handle}" — did signInAllSeedUsers() run?`);
  return id;
}

/** A client acting as one of the seeded people. This is what RLS is tested with. */
export function asUser(handle: SeedHandle): SupabaseClient {
  const token = tokens.get(handle);
  if (!token) throw new Error(`no session for "${handle}" — did signInAllSeedUsers() run?`);
  return memo(`user:${handle}`, () =>
    createClient(url(), anonKey(), {
      ...base,
      global: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
}

/** No JWT at all — the signed-out case, which several negatives depend on. */
export function asAnon(): SupabaseClient {
  return memo('anon', () => createClient(url(), anonKey(), base));
}

/**
 * Bypasses RLS. Seeding and verification only — an assertion made with this
 * proves nothing about authorization, so never `expect` on its result as the
 * subject of an RLS test.
 */
export function asService(): SupabaseClient {
  return memo('service', () => createClient(url(), serviceKey(), base));
}

/** A brand-new anonymous account, as the app itself would create one. */
export async function signInAnonymously(): Promise<{ client: SupabaseClient; id: string }> {
  const anon = createClient(url(), anonKey(), base);
  const { data, error } = await anon.auth.signInAnonymously();
  if (error || !data.session) throw new Error(`anonymous sign-in failed: ${error?.message}`);
  return {
    client: createClient(url(), anonKey(), {
      ...base,
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    }),
    id: data.session.user.id,
  };
}

function memo(key: string, make: () => SupabaseClient): SupabaseClient {
  const hit = clients.get(key);
  if (hit) return hit;
  const made = make();
  clients.set(key, made);
  return made;
}

export function disposeClients(): void {
  clients.clear();
}
