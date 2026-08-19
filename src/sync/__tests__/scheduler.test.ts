/**
 * The only fake-timer test in the sync layer, because the scheduler is the only
 * thing in it that owns a clock.
 *
 * `drain` is mocked away on purpose: what is under test is *when* it is called,
 * and nothing else. `advanceTimersByTimeAsync` rather than the sync variant
 * because it flushes microtasks between ticks, which is why a drain that
 * resolves on a promise does not leave this flaky.
 */
import { startScheduler, stopScheduler } from '../scheduler';
import { drain, QueueTransport } from '../outbox';

// The enqueue hook is faked alongside drain so a test can play the outbox's
// part: `announce()` below is what a real `enqueue()` would broadcast.
const mockEnqueueListeners = new Set<() => void>();
const announce = () => {
  for (const fn of mockEnqueueListeners) fn();
};

jest.mock('../outbox', () => ({
  drain: jest.fn().mockResolvedValue({ sent: 0, failed: 0, dead: 0 }),
  onEnqueued: (fn: () => void) => {
    mockEnqueueListeners.add(fn);
    return () => {
      mockEnqueueListeners.delete(fn);
    };
  },
}));

const drained = drain as jest.MockedFunction<typeof drain>;

const transport: QueueTransport = {
  ownerId: () => 'owner',
  send: async () => ({ ok: true }),
};

beforeEach(() => {
  jest.useFakeTimers();
  drained.mockClear();
  drained.mockResolvedValue({ sent: 0, failed: 0, dead: 0 });
});

afterEach(() => {
  stopScheduler();
  jest.useRealTimers();
});

it('drains immediately, then on every interval', async () => {
  startScheduler(transport, 5000);
  // Foregrounding with unsent work should not cost the user five seconds.
  expect(drained).toHaveBeenCalledTimes(1);

  await jest.advanceTimersByTimeAsync(15000);
  expect(drained).toHaveBeenCalledTimes(4);
  expect(drained).toHaveBeenLastCalledWith(transport);
});

it('is idempotent — a second start does not double the rate', async () => {
  startScheduler(transport, 5000);
  startScheduler(transport, 5000);
  expect(drained).toHaveBeenCalledTimes(1);

  await jest.advanceTimersByTimeAsync(10000);
  expect(drained).toHaveBeenCalledTimes(3);
});

it('stops, and can be started again', async () => {
  startScheduler(transport, 5000);
  await jest.advanceTimersByTimeAsync(5000);
  stopScheduler();

  await jest.advanceTimersByTimeAsync(60000);
  expect(drained).toHaveBeenCalledTimes(2);

  startScheduler(transport, 5000);
  expect(drained).toHaveBeenCalledTimes(3);
});

it('drains shortly after an enqueue instead of waiting out the interval', async () => {
  startScheduler(transport, 5000);
  expect(drained).toHaveBeenCalledTimes(1);

  // A burst of taps coalesces into one nudge, well before the 5s tick.
  announce();
  announce();
  announce();
  await jest.advanceTimersByTimeAsync(300);
  expect(drained).toHaveBeenCalledTimes(2);

  // …and the safety-net tick still fires on its own clock.
  await jest.advanceTimersByTimeAsync(4700);
  expect(drained).toHaveBeenCalledTimes(3);
});

it('stops listening for enqueues once stopped', async () => {
  startScheduler(transport, 5000);
  stopScheduler();

  announce();
  await jest.advanceTimersByTimeAsync(1000);
  expect(drained).toHaveBeenCalledTimes(1);
});

it('survives a drain that rejects', async () => {
  drained.mockRejectedValue(new Error('boom'));
  startScheduler(transport, 5000);

  // An unhandled rejection on a timer is a redbox for something the user has
  // no part in. The next tick still has to happen.
  await expect(jest.advanceTimersByTimeAsync(10000)).resolves.toBeUndefined();
  expect(drained).toHaveBeenCalledTimes(3);
});
