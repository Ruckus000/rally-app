/**
 * The band, and the fact that two files agree about it.
 *
 * `src/lib/points.ts` and `supabase/functions/_shared/points.ts` state the same
 * three numbers in two runtimes that cannot import from each other. That is a
 * copy, and a copy asked to stay in step by a comment is a copy that will not.
 *
 * So the parity check reads the other file off disk rather than trusting the
 * comment. It fails on the edit, not months later on a goal priced 62.
 * `scripts/lib/__tests__/rate.test.ts` does the same for the third copy, the
 * one in `scripts/lib/rate.mjs`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { POINT_MAX, POINT_MIN, POINT_STEP, categoryPoints, isValidPoints } from '../points';
import { CATEGORY_POINTS } from '../../data/fixtures';

describe('the point band', () => {
  it('accepts the prices the rating function can return', () => {
    expect(isValidPoints(POINT_MIN)).toBe(true);
    expect(isValidPoints(POINT_MAX)).toBe(true);
    expect(isValidPoints(35)).toBe(true);
  });

  it('rejects anything off the step, out of the band, or not a whole number', () => {
    expect(isValidPoints(POINT_MIN - POINT_STEP)).toBe(false);
    expect(isValidPoints(POINT_MAX + POINT_STEP)).toBe(false);
    expect(isValidPoints(32)).toBe(false);
    expect(isValidPoints(32.5)).toBe(false);
    expect(isValidPoints(NaN)).toBe(false);
  });

  it('leaves every category price stakeable', () => {
    // The fallback has to be a legal price too, or an offline goal would be
    // one the band says could not exist.
    for (const price of Object.values(CATEGORY_POINTS)) {
      expect(isValidPoints(price)).toBe(true);
    }
  });

  it('falls back to the category, and to something sane for a category it has never heard of', () => {
    expect(categoryPoints('Work')).toBe(CATEGORY_POINTS.Work);
    expect(isValidPoints(categoryPoints('Gardening'))).toBe(true);
  });
});

describe('the server’s copy of the band', () => {
  const server = readFileSync(
    join(__dirname, '../../../supabase/functions/_shared/points.ts'),
    'utf8',
  );

  const constant = (name: string): number => {
    const match = server.match(new RegExp(`export const ${name} = (\\d+)`));
    if (!match) throw new Error(`${name} is not exported from the server's points.ts`);
    return Number(match[1]);
  };

  it('states the same band as the app', () => {
    expect(constant('POINT_MIN')).toBe(POINT_MIN);
    expect(constant('POINT_MAX')).toBe(POINT_MAX);
    expect(constant('POINT_STEP')).toBe(POINT_STEP);
  });

  it('states the same category prices as the app', () => {
    // The server needs these for its own fallback, on a request that never
    // reached a model. A drift here means an offline goal and a rate-limited
    // goal are worth different amounts.
    for (const [cat, price] of Object.entries(CATEGORY_POINTS)) {
      // Quoted or bare, depending on whether the name is a valid identifier.
      const declared = server.match(new RegExp(`'?${cat}'?: (\\d+),`));
      expect(declared?.[1]).toBe(String(price));
    }
  });
});
