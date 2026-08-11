/**
 * Step 6 — Staked. The week is on the record; this is the receipt.
 */
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, View, ViewStyle } from 'react-native';
import { color, heroGlow, onDark } from '../../theme/tokens';
import {
  POP_DURATION,
  RISE_DISTANCE,
  RISE_DURATION,
  popEasing,
  sheetEasing,
  useReducedMotion,
} from '../../theme/motion';
import { Bri, Caps, GlowBloom, Sans, fill, row } from '../../components/primitives';
import { PillButton } from './kit';

/** The wash behind the whole celebration, and the tighter one behind the number. */
const SCREEN_BLOOM = 420;
const SCREEN_BLOOM_TOP = -140;
const HERO_BLOOM = 240;

export function StakedScreen({
  stakeSum,
  pickCount,
  circle,
  weekNumber,
  onEnter,
}: {
  stakeSum: number;
  pickCount: number;
  circle: string | null;
  weekNumber: number;
  onEnter: () => void;
}) {
  const closingLine = circle
    ? `Everyone in ${circle} can see your plan from Monday. Close it out.`
    : 'Your week is on the record. Invite a circle whenever you want witnesses.';

  // One region, one sentence: read as an announcement, not as eight fragments.
  const summary =
    `Staked. ${stakeSum} points on the line for week ${weekNumber}. ` +
    `${pickCount} commitments. ${circle ? `Your circle, ${circle}.` : 'Solo for now.'} ` +
    closingLine;

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(summary);
  }, [summary]);

  return (
    <View
      style={{
        flex: 1,
        paddingHorizontal: 26,
        paddingBottom: 34,
        backgroundColor: color.onboardBg,
      }}
    >
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: SCREEN_BLOOM_TOP,
          left: '50%',
          marginLeft: -SCREEN_BLOOM / 2,
          width: SCREEN_BLOOM,
          height: SCREEN_BLOOM,
        }}
      >
        <GlowBloom size={SCREEN_BLOOM} top={0} right={0} opacity={0.24} />
      </View>

      <View
        accessible
        accessibilityLabel={summary}
        style={[fill, { alignItems: 'center', justifyContent: 'center' }]}
      >
        <Reveal mode="pop">
          <View
            style={{
              paddingHorizontal: 16,
              paddingVertical: 7,
              borderRadius: 999,
              backgroundColor: color.lime,
            }}
          >
            <Bri size={11} weight={800} tracking={1.6} color={color.ink}>
              STAKED
            </Bri>
          </View>
        </Reveal>

        <Reveal mode="pop" delay={100} style={{ marginTop: 26 }}>
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            {/* heroGlow is iOS-only because Android clips a text shadow to the
                glyph box (see tokens); there the bloom is drawn as art instead. */}
            {Platform.OS === 'android' ? (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  width: HERO_BLOOM,
                  height: HERO_BLOOM,
                  alignSelf: 'center',
                }}
              >
                <GlowBloom size={HERO_BLOOM} top={0} right={0} opacity={0.35} />
              </View>
            ) : null}
            <Bri
              size={96}
              weight={800}
              tracking={-4.5}
              lineHeight={82}
              color={color.lime}
              style={heroGlow}
            >
              {stakeSum}
            </Bri>
          </View>
        </Reveal>

        <Caps
          size={10}
          tracking={2}
          color={onDark.secondary}
          style={{ marginTop: 10 }}
        >{`Points on the line · Week ${weekNumber}`}</Caps>

        <Reveal mode="rise" delay={250} style={{ marginTop: 30 }}>
          <View style={[row, { gap: 22 }]}>
            <Stat value={String(pickCount)} label="commitments" />
            <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: onDark.hairlineStrong }} />
            <Stat value={circle ?? 'Solo'} label={circle ? 'your circle' : 'for now'} />
          </View>
        </Reveal>

        <Reveal mode="rise" delay={350} style={{ marginTop: 26 }}>
          <Sans
            size={13}
            lineHeight={20}
            color={onDark.bodySecondary}
            style={{ maxWidth: 250, textAlign: 'center' }}
          >
            {closingLine}
          </Sans>
        </Reveal>
      </View>

      <Reveal mode="rise" delay={450}>
        <PillButton label="Enter your week" onPress={onEnter} />
      </Reveal>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View>
      <Bri size={19} weight={800} color={color.paper}>
        {value}
      </Bri>
      <Sans size={10} color={onDark.secondary} style={{ marginTop: 2 }}>
        {label}
      </Sans>
    </View>
  );
}

/**
 * The celebration arrives in five staggered beats. Local to this screen rather
 * than in the kit because nothing else in the flow staggers.
 */
function Reveal({
  mode,
  delay = 0,
  style,
  children,
}: {
  mode: 'pop' | 'rise';
  delay?: number;
  style?: ViewStyle;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const [t] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduced) {
      t.setValue(1);
      return;
    }
    const anim = Animated.timing(t, {
      toValue: 1,
      duration: mode === 'pop' ? POP_DURATION : RISE_DURATION,
      delay,
      easing: mode === 'pop' ? popEasing : sheetEasing,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [mode, delay, reduced, t]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: t,
          transform:
            mode === 'pop'
              ? [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }]
              : [
                  {
                    translateY: t.interpolate({
                      inputRange: [0, 1],
                      outputRange: [RISE_DISTANCE, 0],
                    }),
                  },
                ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
