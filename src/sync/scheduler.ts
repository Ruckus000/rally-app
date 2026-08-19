/**
 * When to drain. That is the whole job.
 *
 * It lives apart from `outbox.ts` so the queue's logic — ordering, coalescing,
 * refusals — can be tested on real time, and the one piece that genuinely needs
 * a fake clock is this file and nothing else.
 *
 * Two clocks. The interval is the safety net — retries whose backoff has
 * elapsed, work restored by hydration. The nudge is the fast path: the outbox
 * announces every enqueue, and a short trailing debounce offers the queue to
 * the network within a beat of the tap instead of up to `EVERY_MS` later.
 * The debounce coalesces a burst of edits into one drain, and `drain` is
 * single-flight, so an eager call is always safe.
 */
import { drain, onEnqueued, QueueTransport } from './outbox';

const EVERY_MS = 5_000;
const NUDGE_MS = 300;

let timer: ReturnType<typeof setInterval> | null = null;
let nudgeTimer: ReturnType<typeof setTimeout> | null = null;
let unwatch: (() => void) | null = null;

/**
 * Idempotent. Called on foreground and after a session arrives, both of which
 * are moments worth an immediate attempt rather than a wait.
 */
export function startScheduler(transport: QueueTransport, everyMs: number = EVERY_MS): void {
  if (timer) return;
  // A rejected drain would be an unhandled rejection on a timer, which on
  // React Native is a redbox for something the user should never see.
  const tick = () => void drain(transport).catch(() => {});
  timer = setInterval(tick, everyMs);
  unwatch = onEnqueued(() => {
    if (nudgeTimer) clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => {
      nudgeTimer = null;
      tick();
    }, NUDGE_MS);
  });
  tick();
}

export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  if (nudgeTimer) clearTimeout(nudgeTimer);
  nudgeTimer = null;
  unwatch?.();
  unwatch = null;
}
