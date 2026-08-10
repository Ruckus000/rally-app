/**
 * Design tokens, read directly from the design reference.
 * Nothing in the app hardcodes a colour or a type size — it comes from here.
 */
import { Platform, TextStyle, ViewStyle } from 'react-native';

export const color = {
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
  quietText: '#9AA28D',
} as const;

/** Text on dark. Never go below .45 — that floor passes contrast on small caps. */
export const onDark = {
  primary: color.paper,
  bodySecondary: 'rgba(241,242,236,.62)',
  secondary: 'rgba(241,242,236,.55)',
  tertiary: 'rgba(241,242,236,.45)',
  hairline: 'rgba(241,242,236,.11)',
  surface: 'rgba(241,242,236,.05)',
  surfaceBorder: 'rgba(241,242,236,.08)',
} as const;

export type PersonKey = 'you' | 'maya' | 'dre' | 'jordan' | 'sofia' | 'nana' | 'tomas';

export const tint: Record<PersonKey, string> = {
  you: '#E0E6D3',
  maya: '#D5E2BD',
  dre: '#E9E0C2',
  jordan: '#E8CFBE',
  sofia: '#C9D9CE',
  nana: '#EFE3AE',
  tomas: '#CBD6C4',
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
  pill: 999,
  smallCard: 14,
  chip: 16,
  row: 18,
  card: 21,
  bigCard: 23,
  largeCard: 26,
  composer: 26,
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

export const text = {
  screenTitle: {
    fontFamily: font.bri[800],
    fontSize: 29,
    letterSpacing: -0.7,
    lineHeight: 32,
    color: color.ink,
  },
  heroAllTime: {
    fontFamily: font.bri[800],
    fontSize: 48,
    letterSpacing: -2.2,
    lineHeight: 48 * 0.85,
  },
  heroStaked: {
    fontFamily: font.bri[800],
    fontSize: 76,
    letterSpacing: -3.5,
    lineHeight: 76 * 0.8,
  },
  perfectHeadline: { fontFamily: font.bri[800], fontSize: 26, letterSpacing: -0.6 },
  cardTitleSocial: { fontFamily: font.bri[700], fontSize: 17, letterSpacing: -0.2, lineHeight: 17 * 1.2 },
  cardTitleBig: { fontFamily: font.bri[800], fontSize: 22, letterSpacing: -0.4, lineHeight: 22 * 1.2 },
  composerInput: { fontFamily: font.bri[800], fontSize: 23, letterSpacing: -0.6 },
  sheetTitle: { fontFamily: font.bri[700], fontSize: 21, letterSpacing: -0.3, lineHeight: 21 * 1.2 },
  body: { fontFamily: font.sans[400], fontSize: 13.5 },
  bodyStrong: { fontFamily: font.sans[600], fontSize: 14 },
  secondary: { fontFamily: font.sans[400], fontSize: 12 },
} satisfies Record<string, TextStyle>;

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

export const monoDigits: TextStyle = Platform.select({
  ios: { fontVariant: ['tabular-nums'] },
  default: {},
}) as TextStyle;

/**
 * The bloom behind the Plan hero number. Android clips a text shadow to the
 * glyph box, which shows up as a lit rectangle, so the glow is iOS-only —
 * the lime on near-black already carries the emphasis without it.
 */
export const heroGlow: TextStyle = Platform.select({
  ios: { textShadowColor: 'rgba(195,245,60,.32)', textShadowRadius: 44 },
  default: {},
}) as TextStyle;
