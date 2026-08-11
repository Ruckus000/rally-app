/**
 * Per-worker setup, and the rail that keeps this suite off the real database.
 */
import { resetDomainTables, closePool } from './support/reset';
import { signInAllSeedUsers, disposeClients } from './support/clients';

const url = process.env.RALLY_IT_URL ?? '';

// These tests truncate tables. The hosted project must never be one keystroke
// away from that, so refuse anything that is not obviously local. `.env` is
// deliberately never loaded in this project — it points at the hosted project.
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  throw new Error(
    `Integration tests refuse to run against a non-local Supabase. Got: ${url || '(unset)'}`,
  );
}

// Sign in once for the whole worker. `[auth.rate_limit]` allows 30 sign-ins an
// hour, and bcrypt is the most expensive thing in the suite — doing this per
// test would be both slow and self-throttling.
beforeAll(async () => {
  await signInAllSeedUsers();
});

// Auth users, profiles, circles and memberships come from seed.sql and are
// left alone. Only the per-test domain rows are cleared.
beforeEach(async () => {
  await resetDomainTables();
});

afterAll(async () => {
  disposeClients();
  await closePool();
});
