/**
 * Avatars are generated initials on tinted circles. The initials are
 * decorative — the accessible name is the person's full name.
 */
import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { color, PersonKey, tint as TINT } from '../theme/tokens';
import { INITIALS, NAME } from '../data/fixtures';
import { Bri } from './primitives';

export function Avatar({
  who,
  size = 36,
  initials,
  tint,
  label,
  style,
}: {
  who?: PersonKey;
  size?: number;
  /** For people outside the circle (global feed handles). */
  initials?: string;
  tint?: string;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const ini = initials ?? (who ? INITIALS[who] : '?');
  const bg = tint ?? (who ? TINT[who] : color.chip);
  const name = label ?? (who ? NAME[who] : undefined);

  return (
    <View
      accessible={!!name}
      accessibilityLabel={name}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Bri size={Math.round(size * 0.4)} weight={700} color={color.avatarText}>
        {ini}
      </Bri>
    </View>
  );
}

/** Overlapping faces, each ringed so they read as separate people. */
export function FaceStack({
  people,
  size = 20,
  ringColor = color.paper,
  ringWidth = 2,
}: {
  people: PersonKey[];
  size?: number;
  ringColor?: string;
  ringWidth?: number;
}) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {people.map((k, i) => (
        <Avatar
          key={k}
          who={k}
          size={size}
          style={{
            borderWidth: ringWidth,
            borderColor: ringColor,
            marginLeft: i ? -(size * 0.28) : 0,
          }}
        />
      ))}
    </View>
  );
}

/**
 * The circle's follow-through ring: r=43 in a 100-unit box, dasharray 270.4,
 * offset scaled by completion, rotated -90° so it starts at twelve o'clock.
 */
export const RING_CIRCUMFERENCE = 2 * Math.PI * 43;

export function ProgressRing({
  size,
  pct,
  stroke = 7,
  ringColor = color.lime,
  trackColor = 'rgba(25,30,22,.08)',
}: {
  size: number;
  pct: number;
  stroke?: number;
  ringColor?: string;
  trackColor?: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ position: 'absolute', top: 0, left: 0, transform: [{ rotate: '-90deg' }] }}
    >
      <Circle cx={50} cy={50} r={43} fill="none" stroke={trackColor} strokeWidth={stroke} />
      <Circle
        cx={50}
        cy={50}
        r={43}
        fill="none"
        stroke={ringColor}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - pct)}
      />
    </Svg>
  );
}
