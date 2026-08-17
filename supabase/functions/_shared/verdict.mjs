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

/**
 * `finishReason` values that mean the model was stopped rather than finished.
 *
 * `STOP` and `MAX_TOKENS` are deliberately absent: those are answers, complete
 * or truncated, and nothing was withheld. Truncation must not read as a refusal
 * or an ordinary long reply would block a goal.
 */
const BLOCKING_FINISH_REASONS = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'RECITATION',
  'SPII',
  'BLOCKLIST',
  'IMAGE_SAFETY',
]);

/**
 * Did the model decline to answer, given a raw Gemini response body?
 *
 * Asked about the whole body rather than about the text, because **a block does
 * not always come back empty**. The filter can fire after some tokens have been
 * emitted, leaving truncated JSON — or prose explaining itself instead of the
 * object the schema asked for. A check gated on emptiness would take those for
 * answers, fail to parse them, and report an outage: a refusal failing open,
 * which is the one thing this module exists to prevent.
 *
 * A block can also land on the prompt rather than the response, in which case
 * there is no candidate at all and `promptFeedback.blockReason` carries it.
 *
 * An empty reply with no reason given counts too. That is an unknown, and on a
 * guard the conservative direction is closed: being wrong that way costs one
 * goal the person is told did not pass, which is visible and recoverable, where
 * being wrong the other way is silence on the goals this exists to catch.
 */
export function refusedResponse(body) {
  const candidate = body?.candidates?.[0];
  if (BLOCKING_FINISH_REASONS.has(String(candidate?.finishReason ?? ''))) return true;
  if (body?.promptFeedback?.blockReason) return true;
  return responseText(body) === '';
}

/** The model's reply, joined across parts. Empty string if there is none. */
export function responseText(body) {
  const parts = body?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => p?.text ?? '').join('');
}

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
