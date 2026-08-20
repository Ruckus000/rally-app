/**
 * The guard on the hero numbers' line box.
 *
 * `display-leading` exists to reproduce one CSS declaration — `line-height`
 * below the font size — that React Native does not have. In CSS a short line
 * box lets the glyph overflow it and still draw whole; the box only decides
 * how much room the line takes in layout. React Native has no such split. Set
 * `lineHeight` below what the font needs and the paragraph style clamps the
 * line, the ascent is squeezed out, and the top of the numeral is sliced off —
 * on *both* platforms. React Native's own iOS code says so out loud:
 * `RCTAttributedTextUtils.mm` bails out of its half-leading correction with
 * `if (maximumLineHeight < maximumFontLineHeight) return;`, leaving the clamp
 * with nothing to compensate it.
 *
 * So the tightness cannot live in `lineHeight`. It has to live in a margin,
 * which moves the *next* thing up without touching the glyph's own box. That
 * is the invariant below, and it is the whole of what a unit test can check.
 *
 * What it cannot check: whether the glyph is actually whole on a screen.
 * `@testing-library/react-native` does not lay text out and has no font, so no
 * assertion here can see a clipped numeral. The evidence that the numerals
 * draw in full is the simulator screenshots taken for this change; this test
 * only stops the shape of the style from regressing back to the one that
 * clipped.
 */
import { PixelRatio, Platform } from 'react-native';

import { displayLeading, MAX_FONT_SCALE } from '../tokens';

/**
 * Every case pins the OS text-size multiplier, because the margin is scaled by
 * it and the default here is not 1. `PixelRatio.getFontScale()` reads
 * `Dimensions.get('window').fontScale` and falls back to the *pixel* density
 * when that is missing, which under jest-expo it is — so the unmocked value in
 * this suite is 2, the simulator's density. Left alone the assertions would be
 * measuring the test environment.
 */
const atFontScale = (scale: number) =>
  jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(scale);

afterEach(() => jest.restoreAllMocks());

/**
 * `marginBottom` is typed as the whole `DimensionValue` union — percent string
 * and animated node included — so it needs narrowing before it can be added to
 * anything. Asserting the narrowing rather than casting past it: a style that
 * arrived as `'-15%'` would satisfy every other assertion here and lay out
 * nothing like the intended 15 points.
 */
const points = (value: unknown): number => {
  expect(typeof value).toBe('number');
  return value as number;
};

/** The two places the app actually asks for a tightened display number. */
const CALLERS = [
  { where: 'Plan · staked this week', fontSize: 76, tight: 61 },
  { where: 'Me · points all time', fontSize: 48, tight: 41 },
] as const;

describe('displayLeading', () => {
  it.each(CALLERS)(
    'never sets a line box shorter than the font at $fontSize ($where)',
    ({ fontSize, tight }) => {
      atFontScale(1);
      const style = displayLeading(fontSize, tight);
      // The bug, stated as an assertion: `lineHeight: tight` is what clipped.
      expect(style.lineHeight).toBeGreaterThanOrEqual(fontSize);
      expect(style.lineHeight).not.toBe(tight);
    },
  );

  it.each(CALLERS)(
    'takes the tightening out in margin instead at $fontSize ($where)',
    ({ fontSize, tight }) => {
      atFontScale(1);
      const style = displayLeading(fontSize, tight);
      // The number the reference asked for still governs layout: the space the
      // line occupies, box plus margin, is exactly the tight leading.
      expect(points(style.lineHeight) + points(style.marginBottom)).toBe(tight);
      expect(points(style.marginBottom)).toBeLessThan(0);
    },
  );

  it.each(CALLERS)(
    'holds the reference ratio as the OS text size grows at $fontSize ($where)',
    ({ fontSize, tight }) => {
      // React Native scales `lineHeight` by the text-size multiplier but never
      // touches `marginBottom`, so the margin has to be scaled by hand or the
      // leading loosens exactly as the setting goes up. The line React Native
      // will actually lay out is `lineHeight * scale + marginBottom`, and it
      // has to stay the reference's proportion of the grown font.
      atFontScale(MAX_FONT_SCALE);
      const style = displayLeading(fontSize, tight);
      const occupied = points(style.lineHeight) * MAX_FONT_SCALE + points(style.marginBottom);
      expect(occupied).toBeCloseTo(tight * MAX_FONT_SCALE, 10);
      // Same statement as a ratio, which is the thing the reference specified:
      // .8 on Plan and ~.854 on Me, at every text size rather than only at 1.
      expect(occupied / (fontSize * MAX_FONT_SCALE)).toBeCloseTo(tight / fontSize, 10);
    },
  );

  it('clamps the multiplier the way the faces that use it are clamped', () => {
    // `Bri` caps its text at `MAX_FONT_SCALE`, so past that point the glyphs
    // stop growing; a margin that kept scaling would pull the next thing up
    // through them. The low clamp matters just as concretely: with no window
    // `fontScale`, `getFontScale()` returns the pixel density instead — 2 or 3
    // — and this suite is one of the places that happens.
    atFontScale(3);
    const clamped = displayLeading(76, 61);
    atFontScale(MAX_FONT_SCALE);
    expect(clamped.marginBottom).toBe(displayLeading(76, 61).marginBottom);

    atFontScale(0.5);
    const shrunk = displayLeading(76, 61);
    atFontScale(1);
    expect(shrunk.marginBottom).toBe(displayLeading(76, 61).marginBottom);
  });

  it('asks Android, and only Android, to drop its extra font padding', () => {
    atFontScale(1);
    const style = displayLeading(76, 61);
    // `includeFontPadding` is an Android-only style, and the padding it removes
    // is Android-only too. Written as a branch rather than as an assertion that
    // the runner is iOS, so that the test keeps meaning what it says if the
    // suite is ever pointed at the other platform.
    if (Platform.OS === 'android') expect(style.includeFontPadding).toBe(false);
    else expect(style).not.toHaveProperty('includeFontPadding');
  });

  it.each(CALLERS)(
    'agrees across platforms on the numbers that decide layout at $fontSize ($where)',
    ({ fontSize, tight }) => {
      // Before this fix the two platforms disagreed by the whole of the
      // tightening: Android kept the glyph whole and paid for the tightness in
      // margin, iOS clamped the line box and clipped. That these assertions
      // need no `Platform.select` to hold is the point of the change — the only
      // branch left is the Android-only padding flag above.
      atFontScale(1);
      expect(displayLeading(fontSize, tight)).toEqual(
        expect.objectContaining({ lineHeight: fontSize, marginBottom: tight - fontSize }),
      );
    },
  );
});
