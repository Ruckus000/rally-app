/**
 * The Global feed is the first screen a new account lands on, so it is where
 * someone learns what a stake looks like in this app. That makes its four goals
 * documentation, and these are the properties that keep them worth copying.
 *
 * A wording test would be worthless — it would pass for "Get fitter" and fail
 * for a better sentence. What is checkable is the shape a copyable goal has:
 * a price the composer would really charge, an author, and a day.
 */
import { CATEGORY_POINTS, GLOBAL_MOMENTS } from '../fixtures';
import { DAY_NAMES } from '../week';
import { OZ_PEOPLE } from '../people';

const PRICES = Object.values(CATEGORY_POINTS);
const OZ_IDS = OZ_PEOPLE.map((p) => p.id);

describe('the Global feed’s goals', () => {
  it('are priced at something the composer would charge', () => {
    // A goal shown at 30 points is one you cannot stake for 30 points — the
    // number would be describing a world the app does not have.
    for (const post of GLOBAL_MOMENTS) {
      expect(PRICES).toContain(post.pts);
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
