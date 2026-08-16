/**
 * The composer's timing, and the promise that it never blocks.
 *
 * Most of these are about failure, deliberately. A rating that arrives is the
 * easy case; what has to be true is that a rating which never arrives — because
 * the phone is in a tunnel, because the free tier ran out, because the model
 * returned something that was not JSON — leaves someone able to write down
 * their week at the price it has always been.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useGoalRating } from '../useGoalRating';
import { rateGoal } from '../../lib/rateGoal';
import { CATEGORY_POINTS } from '../../data/fixtures';

jest.mock('../../lib/rateGoal', () => ({ rateGoal: jest.fn() }));
const mockRate = rateGoal as jest.MockedFunction<typeof rateGoal>;

const CONCRETE = 'Walk 30 minutes every morning';

function render(title: string, cat = 'Fitness', enabled = true) {
  const onRating = jest.fn();
  const view = renderHook(
    (props: { title: string }) => useGoalRating({ title: props.title, cat, enabled, onRating }),
    { initialProps: { title } },
  );
  return { ...view, onRating };
}

beforeEach(() => {
  jest.useFakeTimers();
  mockRate.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

/** Push past the debounce and let the promise inside it settle. */
async function settle() {
  await act(async () => {
    jest.advanceTimersByTime(700);
  });
}

describe('useGoalRating', () => {
  it('asks once for a pause in typing, not once per keystroke', async () => {
    mockRate.mockResolvedValue({ verdict: 'ok', points: 45, reason: '' });
    const { rerender } = render('Walk 30 min');

    // Four more keystrokes inside the debounce window.
    for (const title of ['Walk 30 minu', 'Walk 30 minut', 'Walk 30 minute', CONCRETE]) {
      act(() => {
        jest.advanceTimersByTime(100);
      });
      rerender({ title });
    }
    await settle();

    expect(mockRate).toHaveBeenCalledTimes(1);
    expect(mockRate).toHaveBeenCalledWith(CONCRETE, 'Fitness', expect.anything());
  });

  it('prices a rated goal at what came back', async () => {
    mockRate.mockResolvedValue({ verdict: 'ok', points: 45, reason: '' });
    const { result, onRating } = render(CONCRETE);
    await settle();

    await waitFor(() => expect(result.current.state).toBe('rated'));
    expect(result.current.points).toBe(45);
    expect(onRating).toHaveBeenLastCalledWith({ points: 45, verdict: 'ok' });
  });

  it('falls back to the category price when the call fails', async () => {
    // Offline, timed out, rate-limited, or a garbled body — `rateGoal` returns
    // null for all of them, and this is the one behaviour they must share.
    mockRate.mockResolvedValue(null);
    const { result, onRating } = render(CONCRETE);
    await settle();

    await waitFor(() => expect(result.current.state).toBe('fallback'));
    expect(result.current.points).toBe(CATEGORY_POINTS.Fitness);
    expect(result.current.verdict).toBe('ok');
    expect(onRating).toHaveBeenLastCalledWith({
      points: CATEGORY_POINTS.Fitness,
      verdict: 'ok',
    });
  });

  it('never calls out in demo mode, and still prices the goal', async () => {
    const { result, onRating } = render(CONCRETE, 'Fitness', false);
    await settle();

    expect(mockRate).not.toHaveBeenCalled();
    expect(result.current.points).toBe(CATEGORY_POINTS.Fitness);
    expect(onRating).toHaveBeenCalledWith({ points: CATEGORY_POINTS.Fitness, verdict: 'ok' });
  });

  it('does not ask about a fragment too short to be a goal', async () => {
    const { result } = render('Run');
    await settle();

    expect(mockRate).not.toHaveBeenCalled();
    expect(result.current.state).toBe('idle');
    expect(result.current.points).toBe(CATEGORY_POINTS.Fitness);
  });

  it('passes a blocked verdict through to the reducer', async () => {
    mockRate.mockResolvedValue({
      verdict: 'blocked',
      points: 35,
      reason: 'That is not something to put points on.',
    });
    const { result, onRating } = render('something the model refused');
    await settle();

    await waitFor(() => expect(result.current.verdict).toBe('blocked'));
    expect(result.current.reason).toBe('That is not something to put points on.');
    expect(onRating).toHaveBeenLastCalledWith({ points: 35, verdict: 'blocked' });
  });

  it('abandons the answer to a question that changed', async () => {
    mockRate.mockResolvedValue({ verdict: 'ok', points: 45, reason: '' });
    const { rerender, unmount } = render(CONCRETE);

    act(() => {
      jest.advanceTimersByTime(300);
    });
    rerender({ title: 'Read 50 pages before opening my phone' });
    await settle();

    // Only the goal still on screen was ever asked about.
    expect(mockRate).toHaveBeenCalledTimes(1);
    expect(mockRate).toHaveBeenCalledWith(
      'Read 50 pages before opening my phone',
      'Fitness',
      expect.anything(),
    );

    // And nothing is left in flight to answer after the composer closes.
    const signal = mockRate.mock.calls[0][2] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
