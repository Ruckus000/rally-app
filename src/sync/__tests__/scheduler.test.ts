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

jest.mock('../outbox', () => ({
  drain: jest.fn().mockResolvedValue({ sent: 0, failed: 0, dead: 0 }),
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

it('survives a drain that rejects', async () => {
  drained.mockRejectedValue(new Error('boom'));
  startScheduler(transport, 5000);

  // An unhandled rejection on a timer is a redbox for something the user has
  // no part in. The next tick still has to happen.
  await expect(jest.advanceTimersByTimeAsync(10000)).resolves.toBeUndefined();
  expect(drained).toHaveBeenCalledTimes(3);
});
