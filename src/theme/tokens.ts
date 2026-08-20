/**
 * Design tokens, read directly from the design reference.
 * Nothing in the app hardcodes a colour or a type size — it comes from here.
 */
import { Platform, TextStyle, ViewStyle } from 'react-native';

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
  /** A step already behind you, on light. Lime at .45 does this on dark. */
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

/** Text on dark. Never go below .45 — that floor passes contrast on small caps. */
export const onDark = {
  primary: color.paper,
  /** Body copy that has to hold its own against `primary` beside it. */
  bodyStrong: 'rgba(241,242,236,.85)',
  bodySecondary: 'rgba(241,242,236,.62)',
  secondary: 'rgba(241,242,236,.55)',
  tertiary: 'rgba(241,242,236,.45)',
  hairline: 'rgba(241,242,236,.11)',
  /** A border that has to be seen, not just felt: buttons, inactive dots. */
  hairlineStrong: 'rgba(241,242,236,.16)',
  /** The two fill steps under a hairline: resting control, and its track. */
  fill: 'rgba(241,242,236,.05)',
  fillFaint: 'rgba(241,242,236,.04)',
} as const;

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
 * its label. On iOS the glyphs overflow the box and draw in full; on Android
 * the text is clipped to the line box, so the tops and bottoms of the numerals
 * are literally sliced off. `includeFontPadding: false` removes Android's own
 * extra leading, and the line box goes back to the font size — the optical
 * tightness is then recovered with the negative margin the caller passes.
 */
export const displayLeading = (fontSize: number, tight: number): TextStyle =>
  Platform.select({
    ios: { lineHeight: tight },
    default: { lineHeight: fontSize, includeFontPadding: false, marginBottom: tight - fontSize },
  }) as TextStyle;
