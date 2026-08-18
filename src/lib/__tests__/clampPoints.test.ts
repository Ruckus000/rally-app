/**
 * `clampPoints` is the last thing between a model's number and a button.
 *
 * Nothing imported it before this file — `points.test.ts` reads the band off
 * disk with a regex to check the app's copy agrees, which pins the constants
 * and none of the behaviour. The behaviour worth pinning is the fallback: every
 * failure in this feature is designed to arrive here as `undefined`, and what
 * this function does with it is the whole of "staking still works when the
 * model is down".
 */
import { CATEGORY_POINTS, clampPoints, isValidPoints } from '../../../supabase/functions/_shared/points';

describe('a price that never arrived', () => {
  // Not zero, and not the bottom of the band: the goal falls back to what its
  // category was worth before any model existed.
  it.each(Object.entries(CATEGORY_POINTS))('%s falls back to %i', (cat, expected) => {
    expect(clampPoints(undefined, cat)).toBe(expected);
  });

  it('falls back to 30 for a category it has never heard of', () => {
    expect(clampPoints(undefined, 'Gardening')).toBe(30);
  });

  it.each([NaN, null, 'forty', {}, [], Infinity, -Infinity])(
    'treats %p as no answer at all',
    (value) => {
      expect(clampPoints(value, 'Work')).toBe(CATEGORY_POINTS.Work);
    },
  );

  // Infinity is the one that looks like a number and is not finite. Clamping it
  // to the top of the band would read as "the model said this was enormous".
  it('does not read Infinity as the most expensive goal possible', () => {
    expect(clampPoints(Infinity, 'Work')).not.toBe(60);
  });
});

describe('a price that did arrive', () => {
  it('takes a number the model sent as a string', () => {
    expect(clampPoints('40', 'Work')).toBe(40);
  });

  it.each([
    [32, 30],
    [33, 35],
    [57, 55],
    [58, 60],
  ])('snaps %i to %i', (given, expected) => {
    expect(clampPoints(given, 'Work')).toBe(expected);
  });

  it.each([
    [0, 10],
    [-100, 10],
    [1000, 60],
  ])('holds %i inside the band at %i', (given, expected) => {
    expect(clampPoints(given, 'Work')).toBe(expected);
  });
});

// The promise the handler makes to the client: whatever comes back, the number
// on the button is one this app can charge.
it('only ever returns a stakeable price', () => {
  const junk = [undefined, null, NaN, Infinity, '', 'forty', {}, [], true];
  const numbers = Array.from({ length: 200 }, (_, i) => i * 0.37 - 20);
  for (const value of [...junk, ...numbers]) {
    for (const cat of [...Object.keys(CATEGORY_POINTS), 'Gardening']) {
      expect(isValidPoints(clampPoints(value, cat))).toBe(true);
    }
  }
});
