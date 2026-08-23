/**
 * The onboarding kit. Seven screens share one grammar — a pill, a chip, a row,
 * a card, a push preview, the dots — so the flow is assembled from here rather
 * than restated seven times.
 */
import React, { useEffect, useState } from 'react';
import { Animated, View, ViewStyle } from 'react-native';
import { onDark, onLight } from '../../theme/tokens';
import { useColors, useShadows } from '../../theme/ThemeProvider';
import { SHEET_DURATION, sheetEasing, useReducedMotion } from '../../theme/motion';
import { Icon } from '../../components/Icon';
import { LogoMark } from '../../components/Logo';
import { Bri, Sans, Tap, fill, row, rowTop } from '../../components/primitives';

/* ------------------------------------------------------------------ buttons */

export type PillVariant = 'primary' | 'paper' | 'outline' | 'text';

export function PillButton({
  label,
  variant = 'primary',
  disabled,
  icon,
  dark,
  onPress,
  accessibilityLabel,
  style,
}: {
  label: string;
  variant?: PillVariant;
  disabled?: boolean;
  /** Free-form so the auth marks — which aren't in the app's icon set — fit. */
  icon?: React.ReactNode;
  /** Only changes the `text` variant, which has no fill to sit on. */
  dark?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
}) {
  const color = useColors();

  if (variant === 'text') {
    return (
      <Tap
        onPress={onPress}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: !!disabled }}
        style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center', ...style }}
      >
        <Sans size={13} weight={700} color={dark ? onDark.secondary : color.muted}>
          {label}
        </Sans>
      </Tap>
    );
  }

  // A disabled fill of ink-at-8% reads as a pill on paper and as nothing at all
  // on #12170F, which is where the only disabled CTA in the flow actually
  // lives. The dark screens get the paper-side equivalent so the button is
  // still a button before you have picked anything.
  const bg = disabled
    ? dark
      ? onDark.fill
      : color.disabledFill
    : variant === 'primary'
      ? color.lime
      : variant === 'paper'
        ? // Not `color.paper`. This is a light chip sitting on a dark screen —
          // a fill drawn *on* dark, not the ground itself — so it has to stay
          // light once the ground stops being light.
          onDark.primary
        : onDark.fill;
  // Not `ink`: that is now the name of a surface token this can never be. Every
  // fill above is light, so every label here is dark, on both schemes.
  const fg = disabled
    ? dark
      ? onDark.tertiary
      : color.faintInk
    : variant === 'outline'
      ? onDark.primary
      : onLight;

  return (
    <Tap
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      style={{
        ...row,
        height: 54,
        borderRadius: 999,
        justifyContent: 'center',
        gap: 9,
        backgroundColor: bg,
        ...(variant === 'outline' && !disabled
          ? { borderWidth: 1, borderColor: onDark.hairlineBold }
          : null),
        ...style,
      }}
    >
      {icon}
      <Bri size={16} weight={800} color={fg}>
        {label}
      </Bri>
    </Tap>
  );
}

/* -------------------------------------------------------------------- chips */

export function SelectChip({
  icon,
  label,
  selected,
  onPress,
}: {
  /** An emoji, not a glyph from the icon set — the design leans on colour. */
  icon?: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const color = useColors();

  return (
    <Tap
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={{
        ...row,
        gap: 8,
        minHeight: 44,
        paddingHorizontal: 17,
        paddingVertical: 12,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: selected ? color.ink : color.divider,
        backgroundColor: selected ? color.ink : color.card,
      }}
    >
      {icon ? <Sans size={16}>{icon}</Sans> : null}
      <Sans size={14} weight={600} color={selected ? color.lime : color.textPrimary}>
        {label}
      </Sans>
    </Tap>
  );
}

/* --------------------------------------------------------------------- rows */

export function CommitmentRow({
  title,
  freq,
  pts,
  selected,
  onPress,
}: {
  title: string;
  freq: string;
  pts: number;
  selected: boolean;
  onPress: () => void;
}) {
  const color = useColors();

  return (
    <Tap
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${title}, ${freq}, ${pts} points`}
      style={{
        ...row,
        gap: 12,
        paddingHorizontal: 13,
        paddingVertical: 12,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: selected ? onDark.limeEdge : onDark.hairline,
        backgroundColor: selected ? onDark.limeWash : onDark.fillFaint,
      }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 9,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1.5,
          borderColor: selected ? color.lime : onDark.hairlineBold,
          backgroundColor: selected ? color.lime : 'transparent',
        }}
      >
        {selected ? <Icon name="check" size={14} color={onLight} strokeWidth={3} /> : null}
      </View>
      <View style={fill}>
        <Sans size={14} weight={600} color={selected ? onDark.primary : onDark.bodyStrong}>
          {title}
        </Sans>
        <Sans size={11} color={onDark.tertiary} style={{ marginTop: 1 }}>
          {freq}
        </Sans>
      </View>
      <Bri size={13} weight={700} color={selected ? color.lime : onDark.tertiary}>
        +{pts}
      </Bri>
    </Tap>
  );
}

/* -------------------------------------------------------------------- cards */

export function ExpandingCard({
  icon,
  iconBg,
  title,
  subtitle,
  open,
  onPress,
  children,
}: {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle: string;
  open: boolean;
  onPress: () => void;
  children?: React.ReactNode;
}) {
  const color = useColors();
  const shadows = useShadows();

  return (
    <Tap
      onPress={onPress}
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityState={{ expanded: open }}
      style={{
        borderRadius: 22,
        paddingHorizontal: 16,
        paddingVertical: 15,
        borderWidth: 1.5,
        borderColor: open ? color.textPrimary : color.divider,
        backgroundColor: color.card,
        ...shadows.card,
      }}
    >
      <View style={[row, { gap: 12 }]}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 13,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: iconBg,
          }}
        >
          {icon}
        </View>
        <View style={fill}>
          <Sans size={15} weight={700} color={color.textPrimary}>
            {title}
          </Sans>
          <Sans size={12} color={color.muted} style={{ marginTop: 1 }}>
            {subtitle}
          </Sans>
        </View>
        {/* The set has no chevronRight; the left one turned around is the same
            path, and keeps a second copy of it out of the icon file. */}
        <View style={{ transform: [{ rotate: '180deg' }] }}>
          <Icon name="chevronLeft" size={15} color={color.faintInk} strokeWidth={2.2} />
        </View>
      </View>
      {open ? <View style={{ marginTop: 13 }}>{children}</View> : null}
    </Tap>
  );
}

/* ------------------------------------------------------------ push previews */

export function NotificationPreview({
  variant,
  time,
  children,
}: {
  variant: 'dark' | 'light';
  time: string;
  children: React.ReactNode;
}) {
  const color = useColors();
  const shadows = useShadows();
  const dark = variant === 'dark';
  return (
    <View
      accessible
      style={{
        ...rowTop,
        gap: 11,
        borderRadius: 20,
        paddingHorizontal: 15,
        paddingVertical: 14,
        backgroundColor: dark ? color.ink : color.card,
        ...(dark ? shadows.toast : shadows.card),
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 11,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: dark ? color.lime : color.previewTile,
        }}
      >
        {/* The real mark, not a stand-in — this tile is the app icon, and a
            hand-drawn copy of it is what let the old one survive here after the
            identity changed. 23px puts the ink at 58% of the 36px tile, the
            proportion `make-icons.mjs` draws the icon at, and stays above the
            22px cut-off below which `LogoMark` switches to a thicker drawing
            the icon does not use. `named={false}` because the row already says
            "Rally" and this View is `accessible`. */}
        <LogoMark
          size={23}
          tone="solid"
          solidColor={dark ? onLight : color.avatarText}
          named={false}
        />
      </View>
      <View style={fill}>
        <View style={[row, { justifyContent: 'space-between', gap: 8 }]}>
          <Sans size={13} weight={700} color={dark ? onDark.primary : color.textPrimary}>
            Rally
          </Sans>
          <Sans size={11} color={dark ? onDark.tertiary : color.faintInk}>
            {time}
          </Sans>
        </View>
        <View style={{ marginTop: 2 }}>{children}</View>
      </View>
    </View>
  );
}

/* --------------------------------------------------------------------- dots */

const DOT_WIDTH = 6;
const DOT_ACTIVE_WIDTH = 22;

/**
 * Steps are 1-based, matching the "STEP 3 OF 5" the screens print — `active`
 * is the step you're on, not an array index.
 */
export function ProgressDots({
  count,
  active,
  dark,
}: {
  count: number;
  active: number;
  dark: boolean;
}) {
  return (
    <View style={[row, { gap: 6 }]}>
      {Array.from({ length: count }, (_, i) => i + 1).map((i) => (
        <Dot key={i} on={i === active} done={i < active} dark={dark} />
      ))}
    </View>
  );
}

function Dot({ on, done, dark }: { on: boolean; done: boolean; dark: boolean }) {
  const color = useColors();
  const reduced = useReducedMotion();
  const [width] = useState(() => new Animated.Value(on ? DOT_ACTIVE_WIDTH : DOT_WIDTH));

  useEffect(() => {
    const to = on ? DOT_ACTIVE_WIDTH : DOT_WIDTH;
    if (reduced) {
      width.setValue(to);
      return;
    }
    // Width is a layout property, so this one can't ride the native driver.
    const anim = Animated.timing(width, {
      toValue: to,
      duration: SHEET_DURATION,
      easing: sheetEasing,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [on, reduced, width]);

  const bg = on
    ? color.lime
    : done
      ? dark
        ? onDark.limeEdgeSoft
        : color.dotDone
      : dark
        ? onDark.hairlineStrong
        : color.divider;

  return <Animated.View style={{ width, height: 6, borderRadius: 999, backgroundColor: bg }} />;
}

/* ------------------------------------------------------------------- header */

/**
 * Back, the dots and an optional Skip. Steps 0 and 6 are the two ends of the
 * flow and own their whole screen, so the header removes itself there rather
 * than every screen guarding its own render.
 *
 * Vertical padding assumes the caller has already applied the safe-area inset.
 */
export function OnboardHeader({
  step,
  total = 5,
  dark,
  onBack,
  onSkip,
}: {
  step: number;
  total?: number;
  dark: boolean;
  onBack: () => void;
  onSkip?: () => void;
}) {
  const color = useColors();

  if (step < 1 || step > total) return null;

  return (
    <View style={[row, { gap: 12, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 4 }]}>
      <Tap
        onPress={onBack}
        accessibilityLabel="Back"
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: dark ? onDark.hairlineStrong : color.divider,
          backgroundColor: dark ? onDark.fill : color.card,
        }}
      >
        <Icon name="chevronLeft" size={15} color={dark ? onDark.primary : color.textPrimary} />
      </Tap>

      <View style={[fill, { alignItems: 'center' }]}>
        <ProgressDots count={total} active={step} dark={dark} />
      </View>

      <View style={{ width: 38, alignItems: 'flex-end' }}>
        {onSkip ? (
          <Tap
            onPress={onSkip}
            accessibilityLabel="Skip"
            style={{ minHeight: 38, justifyContent: 'center', paddingHorizontal: 2 }}
          >
            <Sans size={13} weight={700} color={dark ? onDark.secondary : color.muted}>
              Skip
            </Sans>
          </Tap>
        ) : null}
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- pulse ring */

const PULSE_SPREAD = 10;
const PULSE_PEAK = 0.45;
const PULSE_OUT = 1300;

/**
 * The design pulses the avatar ring with an animated box-shadow *spread*
 * (0 → 10px while fading .45 → 0, every 2.6s). RN shadows have no spread, and
 * shadowRadius isn't native-driver animatable, so the halo is a second ring
 * that scales and fades instead — same read, and it stays on the UI thread.
 */
export function PulseRing({
  size,
  ringWidth = 2.5,
  ringColor,
  style,
  children,
}: {
  size: number;
  ringWidth?: number;
  ringColor?: string;
  style?: ViewStyle;
  children?: React.ReactNode;
}) {
  const color = useColors();
  // A parameter default cannot call a hook, so `ringColor`'s falls back here
  // instead. `??` and not `||`: the default only ever fired on `undefined`.
  const ring = ringColor ?? color.lime;
  const reduced = useReducedMotion();
  const [t] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration: PULSE_OUT,
          easing: sheetEasing,
          useNativeDriver: true,
        }),
        // The keyframe spends its second half back at zero spread, which draws
        // nothing — so the echo simply waits there.
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(PULSE_OUT),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, t]);

  const halo = (size + PULSE_SPREAD * 2) / size;

  return (
    <View style={{ width: size, height: size, ...style }}>
      {reduced ? null : (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: ringWidth,
            borderColor: ring,
            opacity: t.interpolate({ inputRange: [0, 1], outputRange: [PULSE_PEAK, 0] }),
            transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, halo] }) }],
          }}
        />
      )}
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: ringWidth,
          borderColor: ring,
        }}
      />
      {children ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>{children}</View>
      ) : null}
    </View>
  );
}

/* --------------------------------------------------------------- hero bar */

const SEGMENT_FILL = 500;
const SEGMENT_STAGGER = 150;
const SEGMENT_LEAD = 300;

/**
 * The seven-segment bar on Welcome. The design fills each segment with
 * `scaleX` from a left transform-origin; RN has no transformOrigin and scaling
 * from the centre would open each segment from the middle, so the lime bar
 * grows by width inside a fixed track instead.
 */
export function HeroSegments({
  count = 7,
  filled = 4,
  height = 7,
}: {
  count?: number;
  filled?: number;
  height?: number;
}) {
  return (
    <View style={[row, { gap: 5 }]}>
      {Array.from({ length: count }, (_, i) => (
        <Segment key={i} on={i < filled} index={i} height={height} />
      ))}
    </View>
  );
}

function Segment({ on, index, height }: { on: boolean; index: number; height: number }) {
  const color = useColors();
  const reduced = useReducedMotion();
  const [t] = useState(() => new Animated.Value(on ? 0 : 1));

  useEffect(() => {
    if (!on) return;
    if (reduced) {
      t.setValue(1);
      return;
    }
    const anim = Animated.timing(t, {
      toValue: 1,
      duration: SEGMENT_FILL,
      delay: SEGMENT_LEAD + index * SEGMENT_STAGGER,
      // Not popEasing: its overshoot would push the fill past the track.
      easing: sheetEasing,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [on, reduced, index, t]);

  return (
    <View
      style={{
        flex: 1,
        height,
        borderRadius: 999,
        overflow: 'hidden',
        backgroundColor: onDark.fillStrong,
      }}
    >
      {on ? (
        <Animated.View
          style={{
            height: '100%',
            borderRadius: 999,
            backgroundColor: color.lime,
            width: t.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          }}
        />
      ) : null}
    </View>
  );
}
