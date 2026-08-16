/**
 * The Global feed is the first screen a new account lands on, so it is where
 * someone learns what a stake looks like in this app. That makes its four goals
 * documentation, and these are the properties that keep them worth copying.
 *
 * A wording test would be worthless — it would pass for "Get fitter" and fail
 * for a better sentence. What is checkable is the shape a copyable goal has:
 * a price the composer would really charge, an author, and a day.
 */
import { GLOBAL_MOMENTS } from '../fixtures';
import { isValidPoints } from '../../lib/points';
import { DAY_NAMES } from '../week';
import { OZ_PEOPLE } from '../people';

const OZ_IDS = OZ_PEOPLE.map((p) => p.id);

describe('the Global feed’s goals', () => {
  it('are priced at something the composer would charge', () => {
    // This used to check membership of `CATEGORY_POINTS`, which was the right
    // check while the category *was* the price. A rated goal is priced on what
    // it says, so a feed goal at 40 is now perfectly legal even though no
    // category costs 40.
    //
    // What survives is the reason the old check existed: a goal shown at a
    // price you could not actually stake is describing a world this app does
    // not have. The stakeable set is now the band, not the map.
    for (const post of GLOBAL_MOMENTS) {
      // A feed goal with no price at all is the same failure by another route:
      // nothing to copy, and nothing to stake.
      expect(post.pts).toBeDefined();
      expect(isValidPoints(post.pts!)).toBe(true);
    }
  });

  it('are each attributed to a bot the directory can name', () => {
    // The whole reason the cast exists: an author the demo directory misses
    // renders as "Someone", which is what the fixture it replaced looked like.
    for (const post of GLOBAL_MOMENTS) {
      expect(OZ_IDS).toContain(post.who);
    }
  });

  it('spread across the cast rather than being one person’s week', () => {
    expect(new Set(GLOBAL_MOMENTS.map((p) => p.who)).size).toBe(GLOBAL_MOMENTS.length);
  });

  it('land on a real day, since a stake is something you owe by a date', () => {
    for (const post of GLOBAL_MOMENTS) {
      expect(post.day).toBeGreaterThanOrEqual(0);
      expect(post.day).toBeLessThan(DAY_NAMES.length);
    }
  });

  it('say what was done, not how it felt', () => {
    // The old feed's titles were narration — "Day 77 — still going" is a
    // status, not something you can put in your own week. The check that
    // survives rewording: a title is a short line, not a paragraph.
    for (const post of GLOBAL_MOMENTS) {
      expect(post.title?.length ?? 0).toBeGreaterThan(0);
      expect(post.title!.length).toBeLessThanOrEqual(50);
    }
  });
});
