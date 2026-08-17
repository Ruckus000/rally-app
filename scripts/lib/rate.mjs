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
 * the slow part. Returns what a task row would actually carry, not what the
 * model happened to say — the clamp is applied here so no caller can forget it.
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
    points: clamp(priced.points),
    harmful: screened.harmful === true,
    reason: screened.reason ?? '',
  };
}

/** The same clamp the server applies: snapped to the step, held in the band. */
export function clamp(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return POINT_MIN;
  const snapped = Math.round(value / POINT_STEP) * POINT_STEP;
  return Math.min(POINT_MAX, Math.max(POINT_MIN, snapped));
}
