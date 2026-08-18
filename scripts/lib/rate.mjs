/**
 * Price a goal and screen it, the way the composer does.
 *
 * The two calls are the point: RUBRIC answers "what is this worth", SCREENING
 * answers "is this safe to stake", and they are deliberately separate prompts.
 * A 3B model once blocked "Finish module 3 of the SQL course" as a clearly
 * illegal act, having read the phrase in the pricing prompt's context — which
 * is the whole reason the safety question is asked on its own.
 *
 * Lives here rather than in one script because two scripts need it:
 * `rate-goals.mjs` prints what it would charge, and `draft-bot-goals.mjs
 * --write` stores it. Same rule, one implementation.
 */
import { RUBRIC, SCREENING, complete } from './llm.mjs';
import { screeningVerdict } from '../../supabase/functions/_shared/verdict.mjs';

// The band, restated here because the two files that own it are TypeScript and
// a .mjs script cannot import them. `src/lib/__tests__/points.test.ts` pins the
// server's copy against the app's; this is the third, and the one the scripts
// use.
export const POINT_MIN = 10;
export const POINT_MAX = 60;
export const POINT_STEP = 5;

/** The same two schemas the edge function uses, so parity means what it says. */
export const PRICE_SCHEMA = {
  type: 'object',
  properties: { points: { type: 'integer' } },
  required: ['points'],
};

export const SCREEN_SCHEMA = {
  type: 'object',
  properties: { harmful: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['harmful', 'reason'],
};

/**
 * Both questions at once, because they are independent and the round trip is
 * the slow part. Returns `{points, verdict, reason}` — the same shape the edge
 * function answers with, deliberately.
 *
 * The verdict comes from the shared `screeningVerdict`, the same call the edge
 * function makes, so a goal blocked by the model's own safety filter reads as
 * blocked here too rather than as an error.
 *
 * **`points` is null when the model did not price it**, and no caller should
 * turn that into a number. The edge function does fall back, to what the
 * category has always been worth, because somebody is mid-sentence and staking
 * has to keep working when the model is down. Nothing here is on that path: a
 * failed draft is a draft you run again. This file used to answer 10 instead —
 * the bottom of the band, indistinguishable from a real price, and stored in
 * `bot_goal_candidates` for a human to approve without ever knowing the goal
 * had not been priced.
 */
export async function rateGoal({ title, category }) {
  const [priced, screened] = await Promise.all([
    complete({
      system: RUBRIC,
      user: `Category: ${category}\nGoal: ${title}`,
      schema: PRICE_SCHEMA,
    }),
    complete({ system: SCREENING, user: title, schema: SCREEN_SCHEMA }),
  ]);

  return {
    points: priced.status === 'ok' ? clamp(priced.value.points) : null,
    ...screeningVerdict(screened),
  };
}

/**
 * A price the model gave, made storable: snapped to the step, held in the band.
 *
 * Only ever handed a number the model actually returned. An absent price is
 * `null` before it gets here — see `rateGoal`.
 */
export function clamp(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return POINT_MIN;
  const snapped = Math.round(value / POINT_STEP) * POINT_STEP;
  return Math.min(POINT_MAX, Math.max(POINT_MIN, snapped));
}
