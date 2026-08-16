/**
 * The rating call, and the promise that it cannot throw.
 *
 * These tests exist because the composer's whole failure story rests on one
 * sentence — "rateGoal returns null instead of throwing" — and that sentence
 * was false on every real device while the unit suite was green. Jest runs on
 * Node, which has `AbortSignal.timeout`; React Native polyfills `AbortSignal`
 * from the `abort-controller` package, which does not. The call threw a
 * TypeError before it reached its own try block, so goal rating never worked
 * outside of tests that mocked it.
 *
 * The first block therefore runs with those statics deleted, which is what a
 * phone actually looks like.
 */
import { rateGoal } from '../rateGoal';

const mockInvoke = jest.fn();
jest.mock('../supabase', () => ({
  hasSupabaseConfig: () => true,
  getSupabase: () => ({ functions: { invoke: mockInvoke } }),
}));

const OK = { verdict: 'ok' as const, points: 30, reason: '' };

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue({ data: OK, error: null });
});

describe('on a runtime without AbortSignal.timeout or .any — i.e. a phone', () => {
  const saved = {
    timeout: (AbortSignal as { timeout?: unknown }).timeout,
    any: (AbortSignal as { any?: unknown }).any,
  };

  beforeEach(() => {
    delete (AbortSignal as { timeout?: unknown }).timeout;
    delete (AbortSignal as { any?: unknown }).any;
  });

  afterEach(() => {
    (AbortSignal as { timeout?: unknown }).timeout = saved.timeout;
    (AbortSignal as { any?: unknown }).any = saved.any;
  });

  it('still returns a rating rather than throwing', async () => {
    await expect(rateGoal('Walk 30 minutes every morning', 'Fitness')).resolves.toEqual(OK);
  });

  it('still passes an abort signal through to the call', async () => {
    await rateGoal('Walk 30 minutes every morning', 'Fitness');
    expect(mockInvoke.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('honours a caller signal that has already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await rateGoal('Walk 30 minutes every morning', 'Fitness', controller.signal);
    expect(mockInvoke.mock.calls[0][1].signal.aborted).toBe(true);
  });
});

describe('every failure is a null, never a throw', () => {
  it('a rejected invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('network down'));
    await expect(rateGoal('Walk 30 minutes every morning', 'Fitness')).resolves.toBeNull();
  });

  it('an error in the response envelope', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(rateGoal('Walk 30 minutes every morning', 'Fitness')).resolves.toBeNull();
  });

  it('a body of the wrong shape', async () => {
    // Points as a string is the shape that would otherwise reach the button and
    // render as NaN, which is the reason `valid()` exists at all.
    mockInvoke.mockResolvedValue({ data: { verdict: 'ok', points: '30', reason: '' }, error: null });
    await expect(rateGoal('Walk 30 minutes every morning', 'Fitness')).resolves.toBeNull();
  });

  it('a verdict that is neither ok nor blocked', async () => {
    mockInvoke.mockResolvedValue({ data: { verdict: 'maybe', points: 30, reason: '' }, error: null });
    await expect(rateGoal('Walk 30 minutes every morning', 'Fitness')).resolves.toBeNull();
  });

  it('a non-finite number', async () => {
    mockInvoke.mockResolvedValue({ data: { verdict: 'ok', points: NaN, reason: '' }, error: null });
    await expect(rateGoal('Walk 30 minutes every morning', 'Fitness')).resolves.toBeNull();
  });
});
