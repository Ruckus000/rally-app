/**
 * Avatars are generated initials on tinted circles. The initials are
 * decorative — the accessible name is the person's full name.
 */
import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { color } from '../theme/tokens';
import { PersonId } from '../data/people';
import { usePeople } from '../state/store';
import { Bri, Tap } from './primitives';

export function Avatar({
  who,
  size = 36,
  initials,
  tint,
  label,
  style,
}: {
  who?: PersonId;
  size?: number;
  /** For people outside the circle (global feed handles). */
  initials?: string;
  tint?: string;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const people = usePeople();
  const ini = initials ?? (who ? people.initials(who) : '?');
  const bg = tint ?? (who ? people.tint(who) : color.chip);
  const name = label ?? (who ? people.name(who) : undefined);

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
  onPressPerson,
}: {
  people: PersonId[];
  size?: number;
  ringColor?: string;
  ringWidth?: number;
  /** When set, each face becomes a route to that person's profile. */
  onPressPerson?: (who: PersonId) => void;
}) {
  const dir = usePeople();
  return (
    <View style={{ flexDirection: 'row' }}>
      {people.map((k, i) => {
        // The ring goes *around* the face, not inside it. RN is always
        // border-box, so a border on the Avatar itself ate 2px off every side
        // — a 20px face rendering as a 16px one, initials and all. The
        // reference draws it content-box, so the wrapper carries the ring
        // colour as its background and the face keeps its full size.
        const face = (
          <View
            style={{
              padding: ringWidth,
              borderRadius: (size + ringWidth * 2) / 2,
              backgroundColor: ringColor,
              marginLeft: i ? -(size * 0.28 + ringWidth) : 0,
            }}
          >
            <Avatar who={k} size={size} />
          </View>
        );
        return onPressPerson ? (
          <Tap
            key={k}
            onPress={() => onPressPerson(k)}
            accessibilityLabel={`Open ${dir.name(k)}`}
            // The visual face stays small; the target does not. `minSize`
            // reads the style below, so the hit area grows to 44 around a
            // stack that is only 24 tall.
            style={{ width: size + ringWidth * 2, height: size + ringWidth * 2 }}
          >
            {face}
          </Tap>
        ) : (
          <React.Fragment key={k}>{face}</React.Fragment>
        );
      })}
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
  /**
   * `null` when this person's week has never been synced, which is not the
   * same as a week where they closed nothing. Coalescing it to 0 draws an
   * empty ring — visually identical to a real zero — so the one place the
   * circle is read at a glance would state a score nobody has earned.
   */
  pct: number | null;
  stroke?: number;
  ringColor?: string;
  trackColor?: string;
}) {
  // A dashed track and no arc: legibly "nothing to show" rather than "nothing
  // achieved". The text beside it already says "No week synced yet".
  const unknown = pct === null;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ position: 'absolute', top: 0, left: 0, transform: [{ rotate: '-90deg' }] }}
    >
      <Circle
        cx={50}
        cy={50}
        r={43}
        fill="none"
        stroke={trackColor}
        strokeWidth={stroke}
        strokeDasharray={unknown ? '10 9' : undefined}
      />
      {unknown ? null : (
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
      )}
    </Svg>
  );
}
