/**
 * What the goal you are typing is worth, while you type it.
 *
 * The hook owns the timing and nothing else. It decides when a draft is worth
 * asking about, cancels the answer to a question you have already moved on
 * from, and hands the result to `dispatch` so the reducer — not this hook, and
 * not the button — holds the number the stake is made at. That indirection is
 * the point: the price shown and the price staked have to be the same value,
 * and the only way to guarantee that is for there to be one value.
 *
 * `points` is never undefined and never zero. Before the first answer, between
 * answers, in demo mode, and on every failure it is what the category has
 * always been worth, which is why staking works with the network off.
 */
import { useEffect, useState } from 'react';
import { rateGoal, type Rating } from '../lib/rateGoal';
import { categoryPoints } from '../lib/points';

/**
 * Long enough that a pause mid-sentence is not a request, short enough that the
 * number has settled by the time a thumb reaches the day picker.
 */
const DEBOUNCE_MS = 600;

/** Matches the function, which rejects anything shorter before calling a model. */
const MIN_TITLE = 8;

export type RatingState = 'idle' | 'rating' | 'rated' | 'fallback';

export type GoalRating = {
  points: number;
  verdict: 'ok' | 'blocked';
  reason: string;
  state: RatingState;
};

export function useGoalRating(opts: {
  title: string;
  cat: string;
  /** Live account with Supabase configured. Demo modes make no network calls. */
  enabled: boolean;
  /** Must be stable across renders — it is a dependency of the request. */
  onRating: (rating: { points: number; verdict: 'ok' | 'blocked' }) => void;
}): GoalRating {
  const { title, cat, enabled, onRating } = opts;
  const trimmed = title.trim();

  // The question, as one value. An answer is only this hook's answer if it was
  // given to the question currently on screen — which is what makes a late
  // reply to an abandoned draft impossible to show, without a second state
  // field tracking whether one is in flight.
  const question = `${trimmed}|${cat}`;
  const asking = enabled && trimmed.length >= MIN_TITLE;

  const [answer, setAnswer] = useState<{ question: string; rating: Rating | null } | null>(null);

  useEffect(() => {
    if (!asking) {
      // Not "no answer yet" but "there is nothing to ask about" — a two-word
      // fragment has no price beyond its category's.
      onRating({ points: categoryPoints(cat), verdict: 'ok' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      // `.catch`, not a bare async callback. `rateGoal` promises never to
      // throw, but a promise nobody is holding turns a broken promise into an
      // unhandled rejection and a composer stuck on "rating" forever. The whole
      // point of this hook is that a failed rating is survivable, so the one
      // place that could drop a failure on the floor has to say what it does
      // with one.
      rateGoal(trimmed, cat, controller.signal)
        .catch(() => null)
        .then((rating) => {
          if (controller.signal.aborted) return;
          setAnswer({ question, rating });
          onRating(
            rating
              ? { points: rating.points, verdict: rating.verdict }
              : { points: categoryPoints(cat), verdict: 'ok' },
          );
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [question, trimmed, cat, asking, onRating]);

  const current = answer?.question === question ? answer.rating : null;

  return {
    points: current?.points ?? categoryPoints(cat),
    verdict: current?.verdict ?? 'ok',
    reason: current?.reason ?? '',
    // 'rating' the moment the draft changes, not when the request fires: from
    // here on the number showing is about a goal that is no longer the goal.
    state: !asking ? 'idle' : !answer || answer.question !== question ? 'rating' : current ? 'rated' : 'fallback',
  };
}
