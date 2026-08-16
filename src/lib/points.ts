/**
 * The band a rated goal can land in.
 *
 * A mirror of `supabase/functions/_shared/points.ts`, and deliberately a thin
 * one — the server clamps every price before it leaves the function, so nothing
 * here is a second line of defence. What the app needs these numbers for is
 * checking its own fixtures, which are written by hand and have to stay
 * stakeable.
 *
 * The duplication is real and is the cost of a Deno function and a React Native
 * app sharing a rule. `__tests__/points.test.ts` reads the other file and
 * asserts the two agree, because this repo already has one hand-copied constant
 * (`POINTS` in scripts/seed-bots.mjs) whose comment did not stop it drifting.
 */
import { CATEGORY_POINTS } from '../data/fixtures';

export const POINT_MIN = 10;
export const POINT_MAX = 60;
export const POINT_STEP = 5;

/** True for any price the rating function could have returned. */
export function isValidPoints(n: number): boolean {
  return Number.isInteger(n) && n >= POINT_MIN && n <= POINT_MAX && n % POINT_STEP === 0;
}

/** What a goal in this category is worth when nothing has rated it. */
export function categoryPoints(cat: string): number {
  return CATEGORY_POINTS[cat as keyof typeof CATEGORY_POINTS] ?? 30;
}
