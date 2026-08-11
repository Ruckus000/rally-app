/**
 * When to drain. That is the whole job.
 *
 * It lives apart from `outbox.ts` so the queue's logic — ordering, coalescing,
 * refusals — can be tested on real time, and the one piece that genuinely needs
 * a fake clock is this file and nothing else.
 */
import { drain, QueueTransport } from './outbox';

const EVERY_MS = 5_000;

let timer: ReturnType<typeof setInterval> | null = null;

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
  tick();
}

export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
