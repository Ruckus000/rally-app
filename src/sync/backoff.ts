/**
 * How long to wait before trying a failed mutation again.
 *
 * Pure, and the RNG is a parameter. Jitter that reads `Math.random()` directly
 * is jitter no test can pin, which in practice means the spread — the only part
 * that matters — goes unverified forever.
 */

/**
 * Capped at a minute. The outbox blocks head-of-line, so this is also how long
 * a single sick mutation can stall everything queued behind it; a longer cap
 * would turn one bad row into an app that looks like it stopped syncing.
 */
const STEPS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000];

/** ±20%. Enough to unsynchronise a fleet of clients reconnecting together. */
const JITTER = 0.2;

/**
 * `attempt` is 1-based: the delay before the *second* try is `backoffMs(1)`.
 * Anything below 1 clamps rather than throwing — a bad counter should slow the
 * retry down, never crash the drain that is holding the user's unsent work.
 */
export function backoffMs(attempt: number, rand: () => number = Math.random): number {
  const step = Number.isFinite(attempt) ? Math.trunc(attempt) : 1;
  const base = STEPS[Math.min(Math.max(step, 1), STEPS.length) - 1];
  const spread = 1 + (rand() * 2 - 1) * JITTER;
  return Math.round(base * spread);
}
