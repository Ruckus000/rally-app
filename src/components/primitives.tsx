/**
 * Type, surfaces and the two signature treatments (gradient hairline, glow
 * bloom). Every screen composes from here so the tokens stay in one place.
 */
import React from 'react';
import {
  AccessibilityRole,
  LayoutChangeEvent,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  TextProps,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import {
  capsLabel,
  font,
  gradientAngle,
  hairlineGradient,
  HIT_TARGET,
  MAX_FONT_SCALE,
} from '../theme/tokens';
import { useColors } from '../theme/ThemeProvider';

type Weight = 400 | 500 | 600 | 700 | 800;

// Moved to `tokens.ts`, because `displayLeading` has to apply the same cap and
// tokens cannot import from here — this file already imports from tokens, so
// the other direction would be a cycle. Re-exported so the name still resolves
// where it always did.
export { MAX_FONT_SCALE };

type TypeProps = TextProps & {
  size?: number;
  weight?: Weight;
  tracking?: number;
  lineHeight?: number;
  color?: string;
  children?: React.ReactNode;
};

/** Display face: numbers, headings, names in stat positions, badge labels. */
export function Bri({
  size = 16,
  weight = 800,
  tracking,
  lineHeight,
  color: c,
  style,
  ...rest
}: TypeProps) {
  // The default used to live in the parameter list — `color: c = color.ink` —
  // which a hook cannot reach, because you cannot call one in a parameter
  // default. It moves into the body, with `??` rather than `||`: a parameter
  // default fires only on `undefined`, and `||` would additionally swallow an
  // empty string. Same behaviour as before, exactly. This is the shape the
  // rest of the migration follows.
  //
  // `textPrimary`, not `ink`: uncoloured type only ever lands on the ground
  // or a card, both of which flip. Anything drawn on a dark surface passes an
  // `onDark` rung explicitly and never reaches this default.
  const colors = useColors();
  const w = (weight < 500 ? 500 : weight) as 500 | 600 | 700 | 800;
  return (
    <Text
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      {...rest}
      style={[
        {
          fontFamily: font.bri[w],
          fontSize: size,
          color: c ?? colors.textPrimary,
          ...(tracking !== undefined ? { letterSpacing: tracking } : null),
          ...(lineHeight !== undefined ? { lineHeight } : null),
        },
        style,
      ]}
    />
  );
}

/** Body face: everything that isn't a display number or heading. */
export function Sans({
  size = 13.5,
  weight = 400,
  tracking,
  lineHeight,
  color: c,
  style,
  ...rest
}: TypeProps) {
  const colors = useColors();
  const w = (weight > 700 ? 700 : weight) as 400 | 500 | 600 | 700;
  return (
    <Text
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      {...rest}
      style={[
        {
          fontFamily: font.sans[w],
          fontSize: size,
          color: c ?? colors.textPrimary,
          ...(tracking !== undefined ? { letterSpacing: tracking } : null),
          ...(lineHeight !== undefined ? { lineHeight } : null),
        },
        style,
      ]}
    />
  );
}

/** Uppercase tracked section label. */
export function Caps({
  size = 11,
  tracking = 1.4,
  color: c,
  style,
  ...rest
}: Omit<TypeProps, 'weight'>) {
  const colors = useColors();
  return (
    <Text
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      {...rest}
      style={[capsLabel(size, tracking), { color: c ?? colors.muted }, style]}
    />
  );
}

/**
 * Tappable with a guaranteed 44px target. Padding grows via hitSlop rather than
 * the visual box, so the dense card grammar survives.
 */
export function Tap({
  style,
  minSize = HIT_TARGET,
  accessibilityRole = 'button',
  children,
  ...rest
}: Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  minSize?: number;
  accessibilityRole?: AccessibilityRole;
  children?: React.ReactNode;
}) {
  const declared = declaredSize(style);
  /**
   * What the control turned out to be, for the ones that never said.
   *
   * A `Tap` sized by its own text declares no height, so the slop below had
   * nothing to read and the 44pt "guarantee" quietly wasn't one — several
   * shipped controls sat near 30pt that way. Measuring closes that hole for
   * every such control at once, rather than depending on each call site
   * remembering to declare a `minHeight`.
   *
   * Only the controls that need it pay anything: the layout handler is
   * attached solely where a dimension is missing, and it commits state only
   * when what it measured is genuinely under the target. Everything with a
   * declared size — most of the app — renders exactly as before.
   */
  const [measured, setMeasured] = React.useState<{ w: number; h: number } | null>(null);
  const needsMeasure =
    minSize > 0 && (declared.h === undefined || declared.w === undefined);

  const onLayout = React.useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      if (width >= minSize && height >= minSize) return;
      setMeasured((prev) =>
        prev && prev.w === width && prev.h === height ? prev : { w: width, h: height },
      );
    },
    [minSize],
  );

  const h = declared.h ?? measured?.h;
  const w = declared.w ?? measured?.w;

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      hitSlop={slopFor(h, w, minSize)}
      onLayout={needsMeasure ? onLayout : undefined}
      style={({ pressed }) => [style, pressed && { opacity: 0.72 }]}
      {...rest}
    >
      {children}
    </Pressable>
  );
}

/** What the style says the box is, where it says anything at all. */
function declaredSize(style: StyleProp<ViewStyle> | undefined): {
  h: number | undefined;
  w: number | undefined;
} {
  const flat = StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {};
  const h = typeof flat.height === 'number' ? flat.height : (flat.minHeight as number | undefined);
  const w = typeof flat.width === 'number' ? flat.width : undefined;
  return { h: typeof h === 'number' ? h : undefined, w: typeof w === 'number' ? w : undefined };
}

/** Grows the touch area up to `minSize` without changing layout. */
function slopFor(h: number | undefined, w: number | undefined, minSize: number) {
  const vertical = h !== undefined && h < minSize ? Math.ceil((minSize - h) / 2) : 0;
  const horizontal = w !== undefined && w < minSize ? Math.ceil((minSize - w) / 2) : 0;
  return { top: vertical, bottom: vertical, left: horizontal, right: horizontal };
}

/**
 * The signature treatment: a 1px gradient wrapper around a card one radius
 * step smaller. Used on your own task rows, the perfect-week cards and the
 * Plan composer.
 */
export function GradientHairline({
  radius,
  variant = 'light',
  style,
  children,
}: {
  /** Outer radius of the 1px wrapper. The inner card sits a step smaller. */
  radius: number;
  variant?: 'light' | 'dark' | 'composer';
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const angle = variant === 'composer' ? 158 : 150;
  const colors =
    variant === 'light'
      ? hairlineGradient.light
      : variant === 'dark'
        ? hairlineGradient.dark
        : hairlineGradient.composer;
  const locations =
    variant === 'light'
      ? hairlineGradient.lightLocations
      : variant === 'dark'
        ? hairlineGradient.darkLocations
        : hairlineGradient.composerLocations;

  return (
    <LinearGradient
      colors={colors as unknown as [string, string, ...string[]]}
      locations={locations as unknown as [number, number, ...number[]]}
      {...gradientAngle(angle)}
      style={[{ padding: 1, borderRadius: radius }, style]}
    >
      {children}
    </LinearGradient>
  );
}

/**
 * The lime bloom on dark cards: a large offset circle clipped by the card.
 * RN has no radial gradient, so this is an SVG square with a radial fill.
 */
export function GlowBloom({
  size,
  top,
  right,
  opacity = 0.22,
}: {
  size: number;
  top: number;
  right: number;
  opacity?: number;
}) {
  // Gradient ids share a namespace on web, so each bloom needs its own.
  const id = `bloom-${React.useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const colors = useColors();
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top, right, width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={colors.lime} stopOpacity={opacity} />
            <Stop offset="68%" stopColor={colors.lime} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={size} height={size} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

export const row: ViewStyle = { flexDirection: 'row', alignItems: 'center' };
export const rowTop: ViewStyle = { flexDirection: 'row', alignItems: 'flex-start' };
export const fill: ViewStyle = { flex: 1, minWidth: 0 };

