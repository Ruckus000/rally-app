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
 * else" is also the honest answer when the block came from a refusal, where
 * nothing was ever said about the picture at all.
 */
export const IMAGE_BLOCKED_COPY = 'That photo can’t be used here. Try a different one.';

/** Model-written text, kept short enough to log and to sit on a card. */
const REASON_MAX = 160;

/**
 * @param {{status: 'ok', value: {harmful?: boolean, reason?: string}}
 *        | {status: 'refused'}
 *        | {status: 'unavailable'}} screening
 * @returns {{verdict: 'ok' | 'blocked' | 'unproven', reason: string}}
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

  // ─── the call that never arrived ─────────────────────────────────────────
  //
  // Held back, like everything else that is not an explicit `false` — an
  // unscreened avatar is a picture on the screens of people who have never met
  // its owner, and failing open there publishes exactly what app stores remove
  // apps for. That much this file has always said, and it is still right.
  //
  // What it did not separate is *held back* from *destroyed*. Both callers read
  // `blocked` as "refuse it and delete the object", which is correct when the
  // model has spoken and wrong when it never did. A timeout, a 429, or a
  // dropped connection is not evidence about the picture; it is the absence of
  // evidence, and deleting on it means a Gemini outage silently destroys the
  // photo of every person who uploads one during it — each of them told only
  // `IMAGE_BLOCKED_COPY`, which by design does not explain, and each retry
  // failing the same way for as long as the incident lasts.
  //
  // `unproven` is that third answer: do not publish, and do not delete. Both
  // callers already have somewhere to put it. An avatar stays `pending`, which
  // renders initials — `resumePendingAvatar` in `src/sync/transport.ts` finds
  // it on the next launch and asks again, and its comment has always described
  // this exact case ("a screener having a bad day"). A goal photo stays in the
  // media lane's `screen` phase, which retries on its own backoff. The retry
  // machinery for this was built on both sides before there was a state that
  // could reach it.
  if (screening?.status === 'unavailable') {
    return { verdict: 'unproven', reason: '' };
  }

  // A refusal is not an absent answer. A hosted model's safety filter stopping
  // its own response is the answer arriving by another route, on exactly the
  // images this prompt exists to catch — so it blocks and deletes, as it did.
  //
  // So does any shape this function does not recognise, and that is not the
  // same judgement as the one above. `unavailable` is a status this module
  // knows and expects to see again in a minute; an unreadable reply is a
  // surprise, and resolving a surprise as `unproven` would leave the image
  // retrying against a fault that is not going to clear on its own.
  return { verdict: 'blocked', reason: '' };
}
