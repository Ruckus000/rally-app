/**
 * Ask the server what a goal is worth.
 *
 * This function does not throw. Every way it can fail — no config, no network,
 * a timeout, a 500, a body that is not the shape it promised — returns null,
 * and null means "price it the way it was priced before any of this existed".
 * The composer is the only caller, and a composer that can throw while you type
 * is worse than a composer that occasionally shows an old number.
 *
 * The timeout is longer than everything the function does, so an abort here
 * means the network went away rather than the model being slow — the function
 * would have answered with a fallback price in that case.
 */
import { getSupabase, hasSupabaseConfig } from './supabase';

/**
 * This budget covers the whole request, not just the model.
 *
 * The tempting version of this number is "a bit more than the function's 4s
 * ceiling on the model call". That is wrong, and was wrong here for a while:
 * that ceiling bounds one `fetch` inside the handler, which also does an auth
 * lookup, a cache read and a usage-counter round trip before it, an upsert
 * after it, and may pay a cold start in front of all of it. Budget only for the
 * model and this aborts calls that were about to succeed — paying for an answer
 * and then throwing it away, which is the exact failure the old 2.5s produced
 * once the model became a hosted one.
 *
 * So: 4s of model, plus room for the round trips and a cold start. Nothing
 * blocks on any of it — the composer shows the fallback price immediately and
 * sharpens it when the answer lands, and a changed draft aborts this anyway
 * through its own signal. A longer ceiling costs patience nobody is spending.
 */
const TIMEOUT_MS = 8000;

export type Rating = {
  verdict: 'ok' | 'blocked';
  points: number;
  reason: string;
};

export async function rateGoal(
  title: string,
  cat: string,
  signal?: AbortSignal,
): Promise<Rating | null> {
  // Everything is inside the try, including building the signals. React Native
  // has burned this exact code once already: `AbortSignal.timeout` does not
  // exist here, and constructing it above the try turned "no rating this time"
  // into a throw the caller never expected.
  try {
    if (!hasSupabaseConfig()) return null;

    // Two reasons to stop: the draft changed, or we ran out of patience.
    // Whichever fires first ends the call.
    const combined = anyOf([signal, timeoutSignal(TIMEOUT_MS)]);

    const { data, error } = await getSupabase().functions.invoke('rate-goal', {
      body: { title, cat },
      signal: combined,
    });
    if (error) return null;
    return valid(data) ? data : null;
  } catch {
    // AbortError included. There is no failure here the caller treats
    // differently from any other.
    return null;
  }
}

/**
 * Trusts nothing off the wire. The rating drives a number the user is about to
 * be held to, so a malformed body has to read as "no rating" rather than as
 * `NaN` on the stake button.
 */
function valid(data: unknown): data is Rating {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<Rating>;
  return (
    (d.verdict === 'ok' || d.verdict === 'blocked') &&
    typeof d.points === 'number' &&
    Number.isFinite(d.points) &&
    typeof d.reason === 'string'
  );
}

/**
 * `AbortSignal.timeout` and `AbortSignal.any`, written out.
 *
 * React Native does not have either. It polyfills `AbortSignal` from the
 * `abort-controller` package (Libraries/Core/setUpXHR.js), which predates both
 * statics — so `AbortSignal.timeout(…)` is a `TypeError` on every device, in
 * release and debug alike, while Jest runs on Node and sees the real thing.
 * That gap is invisible to the unit suite, which is why these are spelled out
 * rather than feature-detected.
 */
function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function anyOf(signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      controller.abort();
      break;
    }
    s.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
