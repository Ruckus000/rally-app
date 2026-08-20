/**
 * Design tokens, read directly from the design reference.
 * Nothing in the app hardcodes a colour or a type size — it comes from here.
 */
import { Platform, TextStyle, useWindowDimensions, ViewStyle } from 'react-native';

/**
 * How far the OS text-size setting may inflate this app's type.
 *
 * Scaling is left on — turning it off is the wrong answer to a dense layout —
 * but this app draws a lot of fixed-height chrome: 44pt pills, a 46pt input,
 * the 54pt CTA. Past about a third larger, the label stops fitting the control
 * it names and starts being clipped by it, which is worse for the person who
 * turned the setting on than a slightly smaller label. Every face here shares
 * the cap so one number governs the whole scale.
 *
 * It lives here rather than beside the faces in `primitives.tsx` because
 * `displayLeading` below has to apply the identical cap, and that file already
 * imports from this one.
 */
export const MAX_FONT_SCALE = 1.35;

/**
 * The light palette — the only one that exists today. `ThemeProvider` serves
 * this through context so the app can be handed a different one later; until
 * the dark palette lands, every scheme resolves to exactly these values.
 */
export const lightColors = {
  ink: '#191E16',
  lime: '#C3F53C',
  paper: '#F1F2EC',
  muted: '#6E7663',
  moss: '#4B6A0B',
  card: '#FFFFFF',
  planBg: '#12170F',
  planCard: '#1B2116',
  tabbar: 'rgba(19,24,13,.94)',
  faintInk: '#A6AC9C',
  quoteInk: '#5A6350',
  divider: 'rgba(25,30,22,.12)',
  avatarText: '#3B4630',

  /** Surfaces that recur but aren't named tokens in the handoff. */
  chip: '#EAEDE2',
  askTint: '#F7FBE4',
  limeTintChip: '#EDF7D2',
  dash: '#C6CDB8',
  exchangeTrack: '#E3E8D8',
  /**
   * The quiet-comeback line. Was `#9AA28D` — about 2.4:1 on paper, which is
   * under the 4.5:1 floor for 13px body copy: the row meant to be gentle was
   * actually the one some people could not read. `muted` clears the floor,
   * and the de-emphasis was never the colour's job anyway — the row has no
   * card, no avatar and a smaller size, which is what makes it recede.
   */
  quietText: '#6E7663',

  /**
   * Onboarding. `onboardBg` is a shade above `planBg` — the first and last
   * screens sit slightly warmer than the Plan sheet so the flow reads as its
   * own place rather than as Plan with the chrome removed.
   */
  onboardBg: '#101408',
  /** Inset field inside an already-white card, where `card` would disappear. */
  inputFill: '#F7F8F3',
  /** A step already behind you, on light. `onDark.limeEdgeSoft` does it on dark. */
  dotDone: '#B9C2A8',
  /** A control that is present but not yet earned — fill under `faintInk`. */
  disabledFill: 'rgba(25,30,22,.08)',
} as const;

/**
 * The static export, unchanged. 31 files read `color.*` directly and will keep
 * doing so until each is migrated onto `useColors()`; the two are the same
 * object for the whole migration, which is what makes every intermediate PR
 * verifiable by "nothing may look different". Deleted in the last PR.
 */
export const color = lightColors;

/**
 * Everything drawn on a ground that is dark in both schemes.
 *
 * `planBg`, `planCard`, `onboardBg`, the tab bar and every `ink` card stay
 * near-black whichever palette is in force, so nothing in here has a light
 * counterpart and nothing in here comes through a hook. That is the whole
 * reason this is a plain module export sitting outside the palette: there is
 * no second value for a scheme to choose between.
 *
 * **Text is the handoff's, verbatim.** `.45` tertiary, `.55` secondary, `.62`
 * body-secondary, `1.0` primary, and never below `.45` — that floor was set to
 * pass contrast on small caps labels. `bodyStrong` at `.85` is the one rung
 * that is ours, filling the gap the handoff leaves between body copy and a
 * heading. Type belongs on one of those five and nowhere between them. The app
 * had drifted to `.58`, `.60`, `.70`, `.72` and `.75` as well — five invented
 * steps that made five labels look like five different intentions when all of
 * them mean the same thing, "quieter than what is beside me".
 *
 * **Surfaces are ours.** The handoff names two paper alphas in the whole
 * document and authors no border, fill, track or rule at all, so this ramp is
 * a decision rather than a transcription — and the decision it replaces was
 * fifteen alphas between `.035` and `.25`, most of them within a percentage
 * point of a neighbour and none of them meaning anything the one beside it did
 * not. Six do that work now: three edges at `.10 / .16 / .24`, each about half
 * again the last, and four fills at `.04 / .06 / .10 / .16`, plus `dot`.
 *
 * The two ladders share their middle rungs deliberately. At equal alpha a 1px
 * edge and a filled pill read as completely different weights, because weight
 * on dark is alpha times area; holding them to the same numbers is what keeps
 * a pill and the chip it sits inside from drifting apart the way `.08` and
 * `.12` had, when both were drawing the same audience pill in two files.
 *
 * `dot` is named rather than numbered because it is not a surface — it is the
 * 3px bullet between two runs of text in the points bar, and at 3px it needs
 * about twice the strongest fill just to be visible. Reading it as text and
 * snapping it to `.45` would be the opposite mistake: the contrast floor
 * governs glyphs, and this is punctuation drawn as a box.
 *
 * **Lime is ours too**, and had eleven alphas from `.08` to `.75` for what is
 * really five jobs: a wash over something already spent, the fill of a control
 * in its after state, and an edge on something at rest, something current, or
 * something selected right now.
 *
 * Every rung below is within two or three points of the values it replaced, so
 * this is a tightening rather than a re-colouring — but it is a visual change,
 * and the ordering is what was actually protected: wherever one thing was
 * heavier than another before, it still is.
 */
export const onDark = {
  primary: color.paper,
  /** Body copy that has to hold its own against `primary` beside it. */
  bodyStrong: 'rgba(241,242,236,.85)',
  bodySecondary: 'rgba(241,242,236,.62)',
  secondary: 'rgba(241,242,236,.55)',
  tertiary: 'rgba(241,242,236,.45)',

  /** An edge you feel rather than see: a rule, a divider, a chip at rest. */
  hairline: 'rgba(241,242,236,.10)',
  /** An edge that has to be seen: buttons, inputs, the empty-state dash. */
  hairlineStrong: 'rgba(241,242,236,.16)',
  /** The loudest edge on dark — an outline button, an unticked checkbox. */
  hairlineBold: 'rgba(241,242,236,.24)',

  /** An unselected chip, which must not compete with its selected sibling. */
  fillFaint: 'rgba(241,242,236,.04)',
  /** A control at rest: chip, icon button, list row, a disabled CTA. */
  fill: 'rgba(241,242,236,.06)',
  /** A fill that has to read on top of another fill — a small pill, a track. */
  fillStrong: 'rgba(241,242,236,.10)',
  /** A fill carrying an element on its own: a wide track, a pill on `ink`. */
  fillBold: 'rgba(241,242,236,.16)',
  /** The 3px bullet between two runs of text. Punctuation, not a surface. */
  dot: 'rgba(241,242,236,.30)',

  /** Lime already spent: a used suggestion, a row you have already picked. */
  limeWash: 'rgba(195,245,60,.10)',
  /** A lime control in its after state — posted, staked, chosen. */
  limeFill: 'rgba(195,245,60,.16)',
  /** A lime edge at rest: available to press, or done and behind you. */
  limeEdgeSoft: 'rgba(195,245,60,.40)',
  /** A lime edge on the thing that is current. */
  limeEdge: 'rgba(195,245,60,.50)',
  /** A lime edge on the thing selected right now. */
  limeEdgeStrong: 'rgba(195,245,60,.72)',
  /**
   * The dark end of the Plan hero's progress gradient, whose other stop is
   * `lime` itself. It is a real design value that never had a name: lime taken
   * down to roughly two-fifths of its luminance so a bar with one goal on it
   * still reads as a bar rather than as a lit sliver, while the full lime at
   * the far end is what a full week arrives at.
   */
  limeDeep: '#6E9418',
} as const;

/**
 * The same colour at zero alpha — the stop a scrim has to start from.
 *
 * `'transparent'` is not that colour. React Native resolves it to black at
 * zero alpha, so a gradient running from it to a coloured ground darkens
 * through the middle. A scrim therefore has to name its ground twice, once
 * solid and once invisible, and the Plan footer did the invisible half by
 * hand-copying `planBg`'s channels into an `rgba(…)` triplet: two literals
 * obliged to agree, one of which the palette could not reach. Nudge `planBg`
 * and the footer silently grows a coloured fringe. This derives the fade from
 * whatever the ground actually is, so there is only one value to change.
 */
export const fadeOut = (hex: string): string => {
  const h = hex.replace('#', '');
  const full = h.length < 6 ? h.slice(0, 3).replace(/./g, (c) => c + c) : h.slice(0, 6);
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0)`;
};

/**
 * Avatar tints. The demo circle carries its own tint per person, straight from
 * the reference; this palette is what an id we've never seen falls back to.
 */
export const personTints = ['#E0E6D3','#D5E2BD','#E9E0C2','#E8CFBE','#C9D9CE','#EFE3AE','#CBD6C4'] as const;

export const hashTint = (id: string): string => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return personTints[(h >>> 0) % personTints.length];
};

/** Year-grid cell levels: 0 nothing · 1 partial · 2 good · 3 perfect */
export const yearLevelColor: Record<number, string> = {
  0: '#EDF0E4',
  1: '#DCE3CE',
  2: '#A9D93C',
  3: '#C3F53C',
};

export const font = {
  /** Display only: numbers, headings, names in stat positions, badge labels. */
  bri: {
    500: 'BricolageGrotesque_500Medium',
    600: 'BricolageGrotesque_600SemiBold',
    700: 'BricolageGrotesque_700Bold',
    800: 'BricolageGrotesque_800ExtraBold',
  },
  /** Everything else: body, labels, buttons, inputs. */
  sans: {
    400: 'InstrumentSans_400Regular',
    500: 'InstrumentSans_500Medium',
    600: 'InstrumentSans_600SemiBold',
    700: 'InstrumentSans_700Bold',
  },
} as const;

export const radius = {
  smallCard: 14,
  chip: 16,
  row: 18,
  largeCard: 26,
  sheet: 28,
  tabbar: 26,
} as const;

/** Screen gutter. Plan overlay uses its own 20px. */
export const gutter = 18;
export const planGutter = 20;

type Shadow = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'
>;

const shadow = (c: string, y: number, blur: number, opacity: number, elevation: number): Shadow => ({
  shadowColor: c,
  shadowOffset: { width: 0, height: y },
  shadowOpacity: opacity,
  shadowRadius: blur / 2,
  elevation,
});

export const shadows = {
  card: shadow('rgb(25,30,22)', 1, 2, 0.05, 1),
  cardStrong: shadow('rgb(25,30,22)', 1, 2, 0.08, 2),
  tabbar: shadow('rgb(10,14,6)', 16, 34, 0.4, 18),
  fab: shadow('rgb(195,245,60)', 6, 18, 0.35, 8),
  tooltip: shadow('rgb(0,0,0)', 14, 34, 0.45, 20),
  toast: shadow('rgb(16,20,8)', 10, 30, 0.35, 14),
  needsRow: shadow('rgb(143,191,35)', 4, 14, 0.14, 3),
  addCta: shadow('rgb(195,245,60)', 8, 26, 0.22, 6),
  doneCta: shadow('rgb(195,245,60)', 10, 30, 0.2, 8),
} satisfies Record<string, Shadow>;

/**
 * The handoff asks for 44px hit targets while keeping the dense card grammar.
 * Padding grows, type does not.
 */
export const HIT_TARGET = 44;

/** Uppercase tracked section label. 10px floor, only at >= .45 alpha. */
export const capsLabel = (size = 11, tracking = 1.4): TextStyle => ({
  fontFamily: font.sans[700],
  fontSize: size,
  letterSpacing: tracking,
  textTransform: 'uppercase',
});

/**
 * The signature gradient hairline, expressed as expo-linear-gradient props.
 * CSS `linear-gradient(Adeg, …)` points A degrees clockwise from screen-up.
 */
export const gradientAngle = (deg: number) => {
  const rad = (deg * Math.PI) / 180;
  const dx = Math.sin(rad) / 2;
  const dy = -Math.cos(rad) / 2;
  return { start: { x: 0.5 - dx, y: 0.5 - dy }, end: { x: 0.5 + dx, y: 0.5 + dy } };
};

export const hairlineGradient = {
  light: ['rgba(195,245,60,.45)', 'rgba(255,255,255,.75)', 'rgba(255,255,255,0)'],
  lightLocations: [0, 0.35, 0.7],
  dark: ['rgba(195,245,60,.55)', 'rgba(195,245,60,0)'],
  darkLocations: [0, 0.55],
  composer: ['rgba(195,245,60,.60)', 'rgba(195,245,60,.06)', 'rgba(241,242,236,.05)'],
  composerLocations: [0, 0.42, 0.8],
} as const;

/**
 * The bloom behind the Plan hero number. Android clips a text shadow to the
 * glyph box, which shows up as a lit rectangle, so the glow is iOS-only —
 * the lime on near-black already carries the emphasis without it.
 */
export const heroGlow: TextStyle = Platform.select({
  ios: { textShadowColor: 'rgba(195,245,60,.32)', textShadowRadius: 44 },
  default: {},
}) as TextStyle;

/**
 * The tight leading the display numbers are drawn with, without cropping them.
 *
 * The reference sets these line boxes *below* the font size on purpose — 48/41
 * on Me, 76/61 on Plan — because that is what makes a hero number sit tight to
 * its label. CSS can do that safely: a short line box decides only how much
 * room the line takes up, and the glyph is free to overflow it and still draw
 * whole. React Native has no such split. `lineHeight` sets the paragraph
 * style's minimum *and* maximum, the line is clamped to it, and the ascent is
 * what gets squeezed out — so the tops of the numerals are sliced off.
 *
 * That is true on both platforms, which this used to get wrong: it treated the
 * clipping as an Android quirk and left iOS asking for `lineHeight: tight`.
 * React Native's iOS text code is explicit that nothing rescues it — the
 * half-leading correction in `RCTAttributedTextUtils.mm` opens with
 * `if (maximumLineHeight < maximumFontLineHeight) return;`, so below the font's
 * natural line height (1.2em for Bricolage) the clamp is applied with no
 * compensating baseline offset at all. At 76/61 that cost the Plan hero 9.7pt
 * off the top of a 50.2pt digit: the zero rendered as a U.
 *
 * So the tightness cannot live in `lineHeight`. The line box goes back to the
 * font size — enough for a numeral, whose cap height is 0.66em, to clear the
 * 0.27em descent the clamp reserves below the baseline — and the optical
 * tightness is recovered with a negative margin, which pulls the next thing up
 * without touching the glyph's own box. Both platforms now compute the same
 * two numbers; `includeFontPadding: false`, which removes Android's own extra
 * leading so its box is exactly `lineHeight`, is the only part still per-
 * platform.
 *
 * Sized for digits and their separators. A caller wanting tall ascenders here
 * would need the line box raised towards 1.2em to match.
 *
 * The margin is scaled by hand because React Native will not do it. It scales
 * `lineHeight` with the OS text-size multiplier — literally
 * `lineHeight * RCTEffectiveFontSizeMultiplierFromTextAttributes(…)` — but
 * `marginBottom` is a layout property and is never touched, so a fixed margin
 * would hold 15pt back from a line box that had grown to 102.6pt and the ratio
 * the reference asked for would drift as the setting goes up. Multiplying the
 * difference restores it: the line occupies `tight * scale` at every size.
 *
 * The multiplier is clamped the way the text that uses it is clamped: `Bri`
 * caps its faces at `MAX_FONT_SCALE`, and past that point the glyphs stop
 * growing while an unclamped margin would keep pulling. Clamped below at 1 too,
 * so a missing or zero scale falls back to the designed numbers rather than
 * collapsing the margin to nothing.
 *
 * Takes the scale rather than reading it, so that it stays a pure function of
 * its arguments and the reading — which has to be a *subscription* — happens in
 * one place, `useDisplayLeading`. Prefer that; this is exported for the test.
 */
export const displayLeading = (fontSize: number, tight: number, fontScale: number): TextStyle => {
  const scale = Math.min(Math.max(fontScale || 1, 1), MAX_FONT_SCALE);
  return {
    lineHeight: fontSize,
    marginBottom: (tight - fontSize) * scale,
    ...Platform.select({ android: { includeFontPadding: false }, default: null }),
  };
};

/**
 * `displayLeading`, subscribed to the OS text-size setting.
 *
 * Reading the scale once during render is not enough. When the setting changes
 * — Control Center, or Settings and back — iOS posts a notification that
 * `RCTTextViewManager` acts on directly, so the *text* re-lays out at the new
 * multiplier with no JavaScript involved. The margin is ordinary style data and
 * only changes when React renders again, which nothing here would otherwise
 * ask for: the change reaches JS as a `Dimensions` event, and an event nobody
 * subscribes to re-renders nothing. The hero would keep a margin cut for the
 * old scale against a line box drawn at the new one until the screen happened
 * to be remounted.
 *
 * `useWindowDimensions` is that subscription, which is the whole reason this is
 * a hook and not a second argument the caller is trusted to remember.
 */
export const useDisplayLeading = (fontSize: number, tight: number): TextStyle =>
  displayLeading(fontSize, tight, useWindowDimensions().fontScale);
