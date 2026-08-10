/**
 * Type, surfaces and the two signature treatments (gradient hairline, glow
 * bloom). Every screen composes from here so the tokens stay in one place.
 */
import React from 'react';
import {
  AccessibilityRole,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  TextProps,
  TextStyle,
  View,
  ViewProps,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import {
  capsLabel,
  color,
  font,
  gradientAngle,
  hairlineGradient,
  HIT_TARGET,
  shadows,
} from '../theme/tokens';

type Weight = 400 | 500 | 600 | 700 | 800;

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
  color: c = color.ink,
  style,
  ...rest
}: TypeProps) {
  const w = (weight < 500 ? 500 : weight) as 500 | 600 | 700 | 800;
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: font.bri[w],
          fontSize: size,
          color: c,
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
  color: c = color.ink,
  style,
  ...rest
}: TypeProps) {
  const w = (weight > 700 ? 700 : weight) as 400 | 500 | 600 | 700;
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: font.sans[w],
          fontSize: size,
          color: c,
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
  color: c = color.muted,
  style,
  ...rest
}: Omit<TypeProps, 'weight'>) {
  return <Text {...rest} style={[capsLabel(size, tracking), { color: c }, style]} />;
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
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      hitSlop={hitSlopFor(style, minSize)}
      style={({ pressed }) => [style, pressed && { opacity: 0.72 }]}
      {...rest}
    >
      {children}
    </Pressable>
  );
}

/** Grows the touch area up to `minSize` without changing layout. */
function hitSlopFor(style: StyleProp<ViewStyle> | undefined, minSize: number) {
  const flat = StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {};
  const h = typeof flat.height === 'number' ? flat.height : (flat.minHeight as number | undefined);
  const w = typeof flat.width === 'number' ? flat.width : undefined;
  const vertical = h && h < minSize ? Math.ceil((minSize - h) / 2) : 0;
  const horizontal = w && w < minSize ? Math.ceil((minSize - w) / 2) : 0;
  return { top: vertical, bottom: vertical, left: horizontal, right: horizontal };
}

export function Card({
  style,
  radius = 19,
  children,
  ...rest
}: ViewProps & { radius?: number; children?: React.ReactNode }) {
  return (
    <View
      {...rest}
      style={[{ backgroundColor: color.card, borderRadius: radius }, shadows.card, style]}
    >
      {children}
    </View>
  );
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
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top, right, width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color.lime} stopOpacity={opacity} />
            <Stop offset="68%" stopColor={color.lime} stopOpacity={0} />
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

export const hairline = (c = color.divider): ViewStyle => ({ height: 1, backgroundColor: c });

export const textStyle = (s: TextStyle) => s;
