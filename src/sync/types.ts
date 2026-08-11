/**
 * Shapes shared across the sync layer. Small on purpose — the outbox and its
 * operation types land in a later change.
 */

/**
 * What came back from the server for one pull, already narrowed to the rows the
 * reducer knows how to fold in.
 *
 * This is a *merge*, not a replacement: the reducer stays the source of truth,
 * and a merge that arrives while the user is mid-tap must never clobber the
 * local value. `at` is the server clock for the newest row in the batch and is
 * what the next pull sends as its cursor — never the device clock, which drifts.
 */
export type ServerMerge<T> = {
  rows: T[];
  /** ISO-8601, server-generated. Cursor for the next pull. */
  at: string;
};

/** How a sync attempt ended. Failure is expected and is not an error path. */
export type SyncOutcome =
  | { ok: true }
  | { ok: false; reason: 'offline' }
  | { ok: false; reason: 'auth' }
  | { ok: false; reason: 'server'; message: string };
