/**
 * The Rally logo, in the four constructions the identity spec approves.
 *
 * The mark is **Gather**: five wedges on a 72° rotation closing on one core —
 * separate people arriving at the same point. Its geometry is generated into
 * `src/theme/mark.ts`; what lives here is how the brand is *applied*, which is
 * the half a generator cannot know: which construction goes where, what the two
 * colorways are, and the size below which the drawing has to change.
 *
 *   A · horizontal  mark + wordmark, the default
 *   B · stacked     mark over wordmark, for narrow or square space
 *   C · mark        the mark alone, where "Rally" is already established
 *   D · reversed    A or B on ink — `tone="reversed"`, which moves the core to
 *                   lime and is the only thing that changes
 *
 * One rule above the rest: **the wedges always touch the core.** That contact
 * is what the mark means, and it is asserted in `scripts/make-icons.mjs` and in
 * `src/theme/__tests__/mark.test.ts` rather than left to care.
 *
 * Not usable on the launch screen. The lockups contain real text, and
 * `BootScreen` renders before the fonts have loaded — that is the whole reason
 * the mark is geometry rather than a glyph. `BootScreen` draws `mark.ts`
 * directly; see the note there.
 */
import React, { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import {
  MARK_ANGLES,
  MARK_CANVAS,
  MARK_CENTER,
  MARK_CORE_R,
  MARK_CORE_R_SMALL,
  MARK_CORE_R_SOLID,
  MARK_NUDGE_Y,
  MARK_WEDGE,
  MARK_WEDGE_SMALL,
} from '../theme/mark';
import { color, onDark } from '../theme/tokens';
import { Bri } from './primitives';

export type LogoVariant = 'horizontal' | 'stacked' | 'mark';
export type LogoTone = 'ink' | 'reversed' | 'solid';

type Props = {
  variant?: LogoVariant;
  tone?: LogoTone;
  /** The mark's box, in px — the same number the spec's artboards use. */
  size?: number;
  /** `tone="solid"` only: the single colour. Defaults to ink. */
  solidColor?: string;
};

/**
 * Below this the two-tone core stops being a colour and starts being a smudge,
 * so the drawing changes: a thicker wedge and a core grown to r17, in one
 * colour. The spec puts the switch at 22px.
 */
const SMALL_BELOW = 22;

/** Mark alone: 16px digital. The spec's floor, and it is a hard one. */
const MIN_MARK = 16;

/**
 * The lockups' minimums are stated by the spec as *rendered width* — 108px
 * horizontal, 64px stacked — which this component cannot check, because the
 * wordmark's width is not known until the text has been laid out. Exported so
 * a caller placing a lockup in a constrained space has the number to hand;
 * deliberately not enforced, since a logo does not earn a layout pass.
 */
export const MIN_LOCKUP_WIDTH = { horizontal: 108, stacked: 64 };

/**
 * Clear space is one core diameter on all four sides, and nothing enters it —
 * not type, not a photo edge, not another logo. In canvas units the core is
 * `2 × MARK_CORE_R` of `MARK_CANVAS`, so it scales with whatever size is asked
 * for.
 */
export function clearSpaceFor(size: number) {
  return ((MARK_CORE_R * 2) / MARK_CANVAS) * size;
}

/**
 * Colorways, and the reason these read from the static `color` export rather
 * than from `useColors()`: a logo's colorway is chosen by the ground it is
 * placed on, not by the device's scheme. `tone="reversed"` on ink stays bone
 * and lime whether or not the phone is in dark mode — a mark that quietly
 * repainted itself would be a mark you could not put on a photograph.
 *
 * Lime is never the wedges.
 */
function palette(tone: LogoTone, solidColor: string) {
  switch (tone) {
    case 'reversed':
      return { wedge: onDark.primary, core: color.lime };
    case 'solid':
      return { wedge: solidColor, core: solidColor };
    default:
      return { wedge: color.ink, core: color.moss };
  }
}

/** The mark alone, at any size. Variant C, and the thing A and B are built on. */
export function LogoMark({
  size = 42,
  tone = 'ink',
  solidColor = color.ink,
  /**
   * False inside a lockup, where the wordmark beside the mark is real text and
   * already carries the name. Labelled twice, a screen reader reads "Rally
   * Rally".
   */
  named = true,
}: Omit<Props, 'variant'> & { named?: boolean }) {
  const small = size < SMALL_BELOW;
  const { wedge, core } = palette(tone, solidColor);

  // One colour means the huddle has to fuse, so the core grows — at the
  // two-tone radius a single-colour mark looks like a printing fault rather
  // than a decision.
  const coreR = small ? MARK_CORE_R_SMALL : tone === 'solid' ? MARK_CORE_R_SOLID : MARK_CORE_R;

  // In an effect, not in the render body. Render has to be pure: warned inline
  // this fires twice per mount under StrictMode, again on every re-render of
  // whatever is above it, and for speculative renders React then throws away.
  // Keyed on `size`, it fires once per actual violation.
  useEffect(() => {
    if (__DEV__ && size < MIN_MARK) {
      console.warn(`Logo: ${size}px is below the mark's ${MIN_MARK}px minimum.`);
    }
  }, [size]);

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${MARK_CANVAS} ${MARK_CANVAS}`}
      accessible={named}
      accessibilityRole={named ? 'image' : undefined}
      accessibilityLabel={named ? 'Rally' : undefined}
    >
      {/* The mark is five-fold symmetric about the centre, but a five-fold
          shape has no mirror across the horizontal, so its ink box is not
          centred there. Without the nudge it sits visibly high. */}
      <G transform={`translate(0 ${MARK_NUDGE_Y})`}>
        {MARK_ANGLES.map((a) => (
          // `transform` as a string throughout, not the `rotation`/`originX`/
          // `y` props: all of those are deprecated in react-native-svg 15.
          <G key={a} transform={`rotate(${a} ${MARK_CENTER} ${MARK_CENTER})`}>
            <Path d={small ? MARK_WEDGE_SMALL : MARK_WEDGE} fill={wedge} />
          </G>
        ))}
        <Circle cx={MARK_CENTER} cy={MARK_CENTER} r={coreR} fill={core} />
      </G>
    </Svg>
  );
}

/**
 * Wordmark proportions, read off the spec's own artboards rather than invented:
 * horizontal is a 42px mark beside 36px type with 13px between; stacked is a
 * 44px mark over 27px type with 8px between. Held as ratios so any `size`
 * reproduces the drawing.
 */
const LOCKUP = {
  horizontal: { word: 36 / 42, gap: 13 / 42 },
  stacked: { word: 27 / 44, gap: 8 / 44 },
};

/** Tracking is -1.3px at 36px and -0.9px at 27px — one ratio covers both. */
const TRACKING = -0.036;

export function Logo({
  variant = 'horizontal',
  tone = 'ink',
  size = variant === 'stacked' ? 44 : 42,
  solidColor = color.ink,
}: Props) {
  if (variant === 'mark') return <LogoMark size={size} tone={tone} solidColor={solidColor} />;

  const ratio = LOCKUP[variant];
  const fontSize = size * ratio.word;
  const gap = size * ratio.gap;
  const { wedge } = palette(tone, solidColor);

  return (
    <View
      style={{
        flexDirection: variant === 'horizontal' ? 'row' : 'column',
        alignItems: 'center',
        gap,
      }}
    >
      <LogoMark size={size} tone={tone} solidColor={solidColor} named={false} />
      {/* `allowFontScaling={false}` is load-bearing, not tidiness. `Bri`
          spreads its props after its own `maxFontSizeMultiplier`, so this wins
          — and it has to, because the mark beside it is a fixed-size SVG. Let
          the word grow with the OS text size and the lockup comes apart at
          accessibility sizes. A logo is not body copy. */}
      <Bri
        size={fontSize}
        weight={800}
        tracking={fontSize * TRACKING}
        color={wedge}
        allowFontScaling={false}
      >
        Rally
      </Bri>
    </View>
  );
}
