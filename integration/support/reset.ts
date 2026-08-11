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
  'public.reactions',
  'public.notes',
  'public.week_rollups',
  'public.notifications',
  'public.invites',
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
