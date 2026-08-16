/**
 * What a goal can be worth, and the one function that decides it.
 *
 * Points used to be a lookup: pick Fitness, get 35, every time. A model pricing
 * the goal itself replaces the lookup but not the guarantee behind it — that
 * the number on the button is a number this app can actually charge. So the
 * model never sets a price. It proposes one, and `clampPoints` sets it.
 *
 * The band is deliberately narrow. `CATEGORY_POINTS` today spans 20–45, and a
 * model handed an open range will happily price a marathon at 500 and make
 * every other goal in the week look like nothing. 10–60 keeps a great goal
 * worth roughly twice a modest one and no more, which is the ratio the existing
 * fixtures already assume.
 *
 * Mirrored at `src/lib/points.ts` for the app, which cannot import across the
 * Deno/React Native boundary. `src/lib/__tests__/points.test.ts` asserts the two
 * agree — this repo has one hand-copied constant already (`POINTS` in
 * scripts/seed-bots.mjs) and the comment above it has not been enough.
 */

export const POINT_MIN = 10;
export const POINT_MAX = 60;
export const POINT_STEP = 5;

/** What a goal is worth when nothing rated it. Matches `CATEGORY_POINTS`. */
export const CATEGORY_POINTS: Record<string, number> = {
  Fitness: 35,
  Work: 45,
  Home: 25,
  Mind: 25,
  'Quick log': 20,
};

export const CATEGORIES = ['Fitness', 'Work', 'Home', 'Mind'] as const;
export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);
}

/**
 * A model's number, made safe. Anything that is not a finite number — a string,
 * a null, a NaN, the `undefined` left by a key the model decided to omit —
 * falls back to what the category has always been worth, so a garbled response
 * degrades to the old behaviour rather than to zero.
 */
export function clampPoints(value: unknown, cat: string): number {
  const fallback = CATEGORY_POINTS[cat] ?? 30;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const snapped = Math.round(n / POINT_STEP) * POINT_STEP;
  return Math.min(POINT_MAX, Math.max(POINT_MIN, snapped));
}

/** True for any value `clampPoints` could have produced. Used by the tests. */
export function isValidPoints(n: number): boolean {
  return Number.isInteger(n) && n >= POINT_MIN && n <= POINT_MAX && n % POINT_STEP === 0;
}
