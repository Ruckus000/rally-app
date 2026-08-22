/**
 * The one rule the identity spec puts above the others: **the wedges always
 * touch the core**.
 *
 * Everything Rally claims — that people show up for each other, and that
 * showing up compounds — is carried by that contact point. Open the gap and
 * nobody arrived; the mark still looks like a mark, which is exactly why this
 * needs to be arithmetic rather than a glance.
 *
 * `npm run icons` asserts the same thing, and then again in pixels on every
 * rendered asset. This is here because that command is run when the artwork
 * changes, and `mark.ts` is a file somebody could edit at three in the morning
 * without running anything.
 */
import {
  MARK_ANGLES,
  MARK_CENTER,
  MARK_CORE_R,
  MARK_CORE_R_SMALL,
  MARK_CORE_R_SOLID,
  MARK_WEDGE,
  MARK_WEDGE_SMALL,
} from '../mark';

const points = (d: string) =>
  [...d.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);

/** A wedge is base, base, tip — the tip last, being the end that arrives. */
const tip = (d: string) => points(d)[points(d).length - 1];

const reach = (d: string) => {
  const [x, y] = tip(d);
  return Math.hypot(x - MARK_CENTER, y - MARK_CENTER);
};

const bearing = ([x, y]: number[]) =>
  (Math.atan2(y - MARK_CENTER, x - MARK_CENTER) * 180) / Math.PI;

describe('the Rally mark', () => {
  it.each([
    ['two-tone', MARK_WEDGE, MARK_CORE_R],
    ['one-colour', MARK_WEDGE, MARK_CORE_R_SOLID],
    ['small', MARK_WEDGE_SMALL, MARK_CORE_R_SMALL],
  ])('%s: the wedge tips reach inside the core', (_name, wedge, core) => {
    expect(reach(wedge)).toBeLessThan(core);
  });

  it('is five wedges, evenly spaced', () => {
    // Not "five angles" — five angles 72° apart. The spacing is the mark, and
    // the misuse panel's first entry is what happens when it is not.
    expect(MARK_ANGLES).toHaveLength(5);
    const steps = MARK_ANGLES.slice(1).map((a, i) => a - MARK_ANGLES[i]);
    expect(steps).toEqual([72, 72, 72, 72]);
  });

  it.each([
    ['standard', MARK_WEDGE],
    ['small', MARK_WEDGE_SMALL],
  ])('%s: keeps the wedges clear of each other', (_name, wedge) => {
    // They may only ever meet at the core. A base wide enough to reach its
    // neighbour would turn the huddle into a solid disc, and the mark stops
    // being five of anything.
    const [a, b] = points(wedge);
    expect(Math.abs(bearing(b) - bearing(a))).toBeLessThan(72);
  });

  it('points every wedge tip off its own axis', () => {
    // The 7-unit skew is what makes the group read as arriving rather than as
    // a finished pinwheel. Straighten it and the mark goes static.
    for (const wedge of [MARK_WEDGE, MARK_WEDGE_SMALL]) {
      expect(tip(wedge)[0]).not.toBe(MARK_CENTER);
    }
  });

  it('grows the core when the mark is one colour', () => {
    // A single-colour huddle has to fuse, or the join reads as a printing
    // fault rather than as a decision.
    expect(MARK_CORE_R_SOLID).toBeGreaterThan(MARK_CORE_R);
    expect(MARK_CORE_R_SMALL).toBeGreaterThan(MARK_CORE_R_SOLID);
  });
});
