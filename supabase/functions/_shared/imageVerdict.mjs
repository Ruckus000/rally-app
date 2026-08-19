/**
 * What an image screening call means, including when it did not answer.
 *
 * The same three-way shape as `verdict.mjs` — an answer, a refusal, and a call
 * that never arrived — and deliberately **not** the same resolution. Read the
 * two side by side and one of them looks like a bug; neither is. The difference
 * is the subject, and it is written out below where it happens rather than left
 * for the next reader to guess at.
 *
 * A `.mjs` for the reason the rest of `_shared` is: it is the one extension Deno
 * and Node both import, so the edge function that decides and the unit suite
 * that pins the decision are reading one file rather than two copies.
 */

/**
 * The single line shown to the person whose photo was not accepted.
 *
 * It does not say what the model objected to and it does not argue. Naming the
 * category would be wrong twice over: on a false positive it accuses somebody of
 * something over a picture of their kitchen, and on a true one it hands the
 * person a checklist for getting the next attempt past the guard. "Something
 * else" is also the honest answer when the block came from a refusal or an
 * outage, where nothing was ever said about the picture at all.
 */
export const IMAGE_BLOCKED_COPY = 'That photo can’t be used here. Try a different one.';

/** Model-written text, kept short enough to log and to sit on a card. */
const REASON_MAX = 160;

/**
 * @param {{status: 'ok', value: {harmful?: boolean, reason?: string}}
 *        | {status: 'refused'}
 *        | {status: 'unavailable'}} screening
 * @returns {{verdict: 'ok' | 'blocked', reason: string}}
 *
 * `reason` is diagnostic — the model's own words when it gave any, an empty
 * string otherwise. What the person sees is `IMAGE_BLOCKED_COPY`, every time.
 */
export function imageVerdict(screening) {
  // Only an explicit `false` publishes — the opposite polarity to
  // `screeningVerdict`, which passes anything that is not exactly `true`. There
  // the default is the common case and a garbled field should not accuse
  // anybody; here the default is the rare one, and a field that arrived as the
  // string "false", as a 0, or not at all is a reply this module did not
  // understand. Not understanding an answer about a picture means not showing
  // the picture.
  if (screening?.status === 'ok' && screening.value?.harmful === false) {
    return { verdict: 'ok', reason: '' };
  }

  if (screening?.status === 'ok') {
    return {
      verdict: 'blocked',
      reason: String(screening.value?.reason ?? '').slice(0, REASON_MAX),
    };
  }

  // Everything else blocks: a refusal, an outage, and any shape this function
  // does not recognise.
  //
  // A refusal blocks for the reason `verdict.mjs` already gives — a hosted
  // model's safety filter stopping its own response is not an absent answer, it
  // is the answer arriving by another route, on exactly the images this prompt
  // exists to catch.
  //
  // `unavailable` is where this file inverts its sibling, and the asymmetry is
  // the point. An unscreened goal is a sentence its author typed, shown to the
  // circle they chose; failing open there costs at worst a private line of text,
  // while failing closed would stop everybody writing anything down whenever the
  // model has a bad day. An unscreened avatar is a picture that lands on the
  // screens of people who have never met its owner, and failing open there
  // publishes exactly what app stores remove apps for. The cost of a false
  // refusal is one person asked to upload again; the cost of a false pass is not
  // recoverable by the person who has already seen it. So a timeout, a 429, or a
  // garbled body holds the image back rather than letting it through.
  return { verdict: 'blocked', reason: '' };
}
