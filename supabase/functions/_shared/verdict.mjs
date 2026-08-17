/**
 * What a screening call means, including when it did not answer.
 *
 * This is a `.mjs` for the same reason `rubric.mjs` and `screening.mjs` are: it
 * is the one extension Deno and Node both import, so the edge function that
 * makes the decision and the unit suite that pins it are reading the same file
 * rather than two copies somebody has to keep in agreement.
 *
 * The whole of the interesting part is that **not answering** has two meanings,
 * and they resolve opposite ways.
 *
 * A call that never arrived — no network, a timeout, a 429, a garbled body —
 * says nothing about the goal. Failing closed on it would mean a model having a
 * bad day silently refusing to let anybody write anything down, which is a far
 * worse failure than the one it guards against. That is `unavailable`, and it
 * resolves `ok`.
 *
 * A call the model *declined* is different. A hosted model's safety filters
 * block the response itself: a 200, a finishReason, and no content. The goals
 * that trigger it are exactly the self-harm and violence cases `SCREENING`
 * exists to catch, so a refusal is not an absence of an answer — it is the
 * answer, arriving by another route. That is `refused`, and it resolves
 * `blocked`.
 *
 * Collapsing the two is the specific bug this file exists to prevent. Treating
 * a refusal as "nothing came back" would fail open precisely on the goals that
 * must not.
 */

/**
 * Shown to the person composing the goal, so it says what happened without
 * pretending to a judgement the model never actually returned in words.
 */
export const REFUSED_REASON = 'This one did not pass the safety check.';

/** Reasons are model-written text on a card; a paragraph would not fit. */
const REASON_MAX = 160;

/**
 * @param {{status: 'ok', value: {harmful?: boolean, reason?: string}}
 *        | {status: 'refused'}
 *        | {status: 'unavailable'}} screening
 * @returns {{verdict: 'ok' | 'blocked', reason: string}}
 */
export function screeningVerdict(screening) {
  if (screening?.status === 'refused') {
    return { verdict: 'blocked', reason: REFUSED_REASON };
  }

  // Anything that is not a completed call, including a shape this function does
  // not recognise, is an absent answer rather than an accusation.
  if (screening?.status !== 'ok') return { verdict: 'ok', reason: '' };

  if (screening.value?.harmful !== true) return { verdict: 'ok', reason: '' };

  return {
    verdict: 'blocked',
    reason: String(screening.value?.reason ?? '').slice(0, REASON_MAX),
  };
}

/**
 * Whether this pair of answers is worth remembering forever.
 *
 * Only a complete one. The cache is permanent and shared by everybody who ever
 * types the same title, so a single timed-out pricing call written here would
 * freeze that goal at its category price long after the model came back.
 *
 * A refusal is deliberately not cached either. It is a real verdict for this
 * request, but it is the one verdict produced without the model ever saying
 * anything about the goal — and a permanent block is too heavy a thing to build
 * on a filter that may have fired on the phrasing.
 */
export function cacheable(priced, screening) {
  return priced?.status === 'ok' && screening?.status === 'ok';
}
