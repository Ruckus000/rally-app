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
 * Deno/React Native boundary, and the band is restated a third time in
 * `scripts/lib/rate.mjs`, which is a `.mjs` and cannot import a `.ts` at all.
 * Every one of those copies is held against this file by a test that reads it
 * off disk — `src/lib/__tests__/points.test.ts` and
 * `scripts/lib/__tests__/rate.test.ts` — because a comment asking for two
 * numbers to stay equal is not the same thing as them being equal.
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
  // Numbers, and the numeric strings a model sometimes sends instead. Anything
  // else is an absent answer rather than a zero — `Number(null)` and `Number('')`
  // are both 0, which would clamp to the bottom of the band and read as "the
  // model priced this at almost nothing" when the model said nothing at all.
  const numeric = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  const n = numeric ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  const snapped = Math.round(n / POINT_STEP) * POINT_STEP;
  return Math.min(POINT_MAX, Math.max(POINT_MIN, snapped));
}

/** True for any value `clampPoints` could have produced. Used by the tests. */
export function isValidPoints(n: number): boolean {
  return Number.isInteger(n) && n >= POINT_MIN && n <= POINT_MAX && n % POINT_STEP === 0;
}
