/**
 * Per-test isolation.
 *
 * Not transaction rollback: PostgREST holds its own pooled connections, so a
 * test cannot wrap an HTTP request in a transaction it controls. Not
 * `supabase db reset` either — 10–20s per file is minutes of pure overhead.
 *
 * A truncate over a direct connection instead: ~10ms, and it deliberately
 * leaves `auth.users`, `profiles`, `circles` and `circle_members` alone, since
 * those come from seed.sql and re-creating them would mean re-hashing
 * passwords on every test.
 *
 * Doing this over `pg` rather than a helper function in the schema keeps the
 * migration honest — no test-only objects ship to production.
 */
import { Pool } from 'pg';

let pool: Pool | null = null;

const getPool = (): Pool => {
  if (!pool) pool = new Pool({ connectionString: process.env.RALLY_IT_DB_URL, max: 2 });
  return pool;
};

/** Everything a test creates. Ordered by nothing — `cascade` handles the FKs. */
const DOMAIN_TABLES = [
  'public.tasks',
  'public.task_pairs',
  'public.task_media',
  'public.reactions',
  'public.notes',
  'public.week_rollups',
  'public.week_shares',
  'public.notifications',
  'public.invites',
  'public.bot_goal_candidates',
  // Not domain data, but it cascades from `profiles` — which this deliberately
  // does not truncate — so a row written for a *seeded* account would outlive
  // the test that wrote it and be there for the next one.
  'public.apple_credentials',
] as const;

export async function resetDomainTables(): Promise<void> {
  await getPool().query(`truncate ${DOMAIN_TABLES.join(', ')} restart identity cascade`);
}

/** Run arbitrary SQL as the superuser. Setup and grant checks only. */
export async function sql<T = unknown>(text: string, values?: unknown[]): Promise<T[]> {
  const { rows } = await getPool().query(text, values);
  return rows as T[];
}

/**
 * Run several statements on one connection, then roll the whole thing back.
 * Returns the rows of the last statement.
 *
 * For side effects that have to be *caught in the act*. `pg_net` queues a push
 * by inserting into `net.http_request_queue`, and a background worker drains
 * that queue — so counting it in a later statement is a race with a process
 * this suite does not control. Inside one transaction the row is certainly
 * still there, because nothing outside can have seen it yet.
 *
 * The rollback is the other half: setting up a test needs Vault secrets that
 * would otherwise make every notification written by every later test fire a
 * real request. Created and discarded here, no other file can observe them.
 */
export async function sqlInTx<T = unknown>(statements: string[]): Promise<T[]> {
  const client = await getPool().connect();
  // An ordinary SQL error just aborts the transaction and `rollback` still
  // succeeds, so the client is genuinely clean and goes back to the pool. A
  // rollback that *fails* means the connection itself is broken — handing that
  // back would poison whichever later test happened to draw it, so it is passed
  // to `release` instead, which destroys it.
  let broken: Error | undefined;
  try {
    await client.query('begin');
    let last: unknown[] = [];
    for (const text of statements) last = (await client.query(text)).rows;
    return last as T[];
  } finally {
    await client.query('rollback').catch((err) => {
      broken = err as Error;
    });
    client.release(broken);
  }
}

/**
 * Run a statement as a given role, which is how EXECUTE and USAGE grants are
 * asserted — REST cannot express "is this callable by `authenticated`?".
 */
export async function asRole(role: string, text: string): Promise<{ error?: string }> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    await client.query(text);
    await client.query('rollback');
    return {};
  } catch (e) {
    await client.query('rollback').catch(() => {});
    return { error: (e as { code?: string; message: string }).code ?? (e as Error).message };
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
