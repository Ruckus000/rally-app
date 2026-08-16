/**
 * The composer's timing, and the promise that it never blocks.
 *
 * Everything is asserted through `onRating`, because that is the hook's entire
 * output — it hands the price to the reducer and returns nothing. There is one
 * number, it lives in the store, and the button reads it from there.
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
const FALLBACK = { points: CATEGORY_POINTS.Fitness, verdict: 'ok', reason: '' };

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
    const { onRating } = render(CONCRETE);
    await settle();

    await waitFor(() =>
      expect(onRating).toHaveBeenLastCalledWith({ points: 45, verdict: 'ok', reason: '' }),
    );
  });

  it('falls back to the category price when the call fails', async () => {
    // Offline, timed out, rate-limited, or a garbled body — `rateGoal` returns
    // null for all of them, and this is the one behaviour they must share.
    mockRate.mockResolvedValue(null);
    const { onRating } = render(CONCRETE);
    await settle();

    await waitFor(() => expect(onRating).toHaveBeenLastCalledWith(FALLBACK));
  });

  it('falls back when rateGoal throws instead of returning null', async () => {
    // rateGoal promises never to throw, and was wrong about that once: it built
    // an AbortSignal.timeout above its own try block, which is a TypeError on
    // every device. A broken promise upstream has to degrade here, not leave
    // the composer showing a price nothing will ever correct.
    mockRate.mockRejectedValue(new TypeError('AbortSignal.timeout is not a function'));
    const { onRating } = render(CONCRETE);
    await settle();

    await waitFor(() => expect(onRating).toHaveBeenLastCalledWith(FALLBACK));
  });

  it('never calls out in demo mode, and still prices the goal', async () => {
    const { onRating } = render(CONCRETE, 'Fitness', false);
    await settle();

    expect(mockRate).not.toHaveBeenCalled();
    expect(onRating).toHaveBeenCalledWith(FALLBACK);
  });

  it('does not ask about a fragment too short to be a goal', async () => {
    const { onRating } = render('Run');
    await settle();

    expect(mockRate).not.toHaveBeenCalled();
    expect(onRating).toHaveBeenCalledWith(FALLBACK);
  });

  it('sends the reason along with a blocked verdict, never one without the other', async () => {
    // The pair travels together or the composer ends up disabled with nothing
    // written under it, which is a refusal the person cannot act on.
    const reason = 'That is not something to put points on.';
    mockRate.mockResolvedValue({ verdict: 'blocked', points: 35, reason });
    const { onRating } = render('something the model refused');
    await settle();

    await waitFor(() =>
      expect(onRating).toHaveBeenLastCalledWith({ points: 35, verdict: 'blocked', reason }),
    );
  });

  it('clears a stale reason when the next goal is fine', async () => {
    const reason = 'That is not something to put points on.';
    mockRate.mockResolvedValue({ verdict: 'blocked', points: 35, reason });
    const { rerender, onRating } = render('something the model refused');
    await settle();

    mockRate.mockResolvedValue({ verdict: 'ok', points: 45, reason: '' });
    rerender({ title: CONCRETE });
    await settle();

    await waitFor(() =>
      expect(onRating).toHaveBeenLastCalledWith({ points: 45, verdict: 'ok', reason: '' }),
    );
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

  it('does not answer with a rating for a goal that is no longer on screen', async () => {
    // The in-flight call for the abandoned title resolves *after* the draft
    // changed. Answering then would price what is on screen using what is not.
    let resolveFirst: (v: null) => void = () => {};
    mockRate.mockImplementationOnce(
      () => new Promise((r) => { resolveFirst = r as (v: null) => void; }),
    );
    const { rerender, onRating } = render(CONCRETE);
    await settle();

    onRating.mockClear();
    rerender({ title: 'Read 50 pages before opening my phone' });
    await act(async () => {
      resolveFirst(null);
    });

    // Only the effect for the new title may speak, and it has not fired yet.
    expect(onRating).not.toHaveBeenCalled();
  });
});
