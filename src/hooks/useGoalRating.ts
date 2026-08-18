/**
 * What the goal you are typing is worth, while you type it.
 *
 * The hook owns the timing and nothing else. It decides when a draft is worth
 * asking about, cancels the answer to a question you have already moved on
 * from, and hands the result to `dispatch`. It returns nothing, deliberately:
 * the price shown and the price staked have to be the same number, and the only
 * way to guarantee that is for there to be one number. It lives in the reducer,
 * next to the goal it belongs to.
 *
 * That price is never undefined and never zero. Before the first answer,
 * between answers, in demo mode, and on every failure it is what the category
 * has always been worth — which is why staking works with the network off.
 */
import { useEffect } from 'react';
import { rateGoal } from '../lib/rateGoal';
import { categoryPoints } from '../lib/points';

/**
 * Long enough that a pause mid-sentence is not a request, short enough that the
 * number has settled by the time a thumb reaches the day picker.
 */
const DEBOUNCE_MS = 600;

/**
 * Matches the function, which 400s outside this range before calling a model.
 *
 * The upper bound is load-bearing and was missing. `rateGoal` turns every error
 * into `null`, and `null` means "fall back to the category price, verdict ok" —
 * so a title over the limit was not screened *and* looked like it had passed.
 * A harmful goal is not usually short. The composer caps the input too, but the
 * cap is a courtesy and this is the contract: paste, autocorrect and any future
 * composer all arrive here.
 */
const MIN_TITLE = 8;
const MAX_TITLE = 50;

export type Rated = { points: number; verdict: 'ok' | 'blocked'; reason: string };

export function useGoalRating(opts: {
  title: string;
  cat: string;
  /** Live account with Supabase configured. Demo modes make no network calls. */
  enabled: boolean;
  /** Must be stable across renders — it is a dependency of the request. */
  onRating: (rating: Rated) => void;
}): void {
  const { title, cat, enabled, onRating } = opts;
  const trimmed = title.trim();
  const asking = enabled && trimmed.length >= MIN_TITLE && trimmed.length <= MAX_TITLE;

  useEffect(() => {
    if (!asking) {
      // Not "no answer yet" but "there is nothing to ask about" — a two-word
      // fragment has no price beyond its category's.
      onRating({ points: categoryPoints(cat), verdict: 'ok', reason: '' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      // `.catch`, not a bare async callback. `rateGoal` promises never to
      // throw, but a promise nobody is holding turns a broken promise into an
      // unhandled rejection and a composer that never updates again. The whole
      // point of this hook is that a failed rating is survivable, so the one
      // place that could drop a failure on the floor has to say what it does
      // with one.
      rateGoal(trimmed, cat, controller.signal)
        .catch(() => null)
        .then((rating) => {
          // The draft moved on while this was in flight. Cleanup already
          // aborted us, and answering now would price the goal that is on
          // screen using the one that is not.
          if (controller.signal.aborted) return;
          // Reason travels with verdict, always. Apart, they drift: a refusal
          // from one title ends up beside an explanation from another, or
          // beside none at all, and a blocked button with nothing under it is
          // a dead end.
          onRating(
            rating
              ? { points: rating.points, verdict: rating.verdict, reason: rating.reason }
              : { points: categoryPoints(cat), verdict: 'ok', reason: '' },
          );
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, cat, asking, onRating]);
}
