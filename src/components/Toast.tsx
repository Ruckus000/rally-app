/** Single-slot toast, `bPop` in, a short fade out, auto-dismissed by the store. */
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { shadows } from '../theme/tokens';
import { useColors } from '../theme/ThemeProvider';
import { POP_DURATION, popEasing, useReducedMotion } from '../theme/motion';
import { Bri } from './primitives';

/** See <Presence>: Jest never runs the exit timer, so exits are instant there. */
const INSTANT_EXIT = typeof process !== 'undefined' && !!process.env?.JEST_WORKER_ID;

const EXIT_MS = 150;

export function Toast({
  message,
  seq,
  bottomInset = 0,
}: {
  message: string | null;
  seq: number;
  /** The tab bar grows with the home indicator; the toast has to clear it. */
  bottomInset?: number;
}) {
  const color = useColors();
  const reduced = useReducedMotion();
  const [anim] = useState(() => new Animated.Value(1));
  // The store nulls the message to dismiss; keeping the last one lets the
  // pill fade out instead of blinking away in a single frame. Both moves are
  // render-time adjustments; the effect below only drives animation.
  const [shown, setShown] = useState(message);
  if (message && message !== shown) setShown(message);
  if (!message && shown && (reduced || INSTANT_EXIT)) setShown(null);

  useEffect(() => {
    if (message) {
      // `accessibilityLiveRegion` is Android-only in React Native, so on iOS
      // every confirmation this app makes — cheered, staked, unstaked — was
      // silent to VoiceOver. The imperative call covers both.
      AccessibilityInfo.announceForAccessibility(message);
      if (reduced) {
        anim.setValue(1);
        return;
      }
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: POP_DURATION,
        easing: popEasing,
        useNativeDriver: true,
      }).start();
      return;
    }
    if (reduced || INSTANT_EXIT) {
      anim.setValue(0);
      return;
    }
    Animated.timing(anim, {
      toValue: 0,
      duration: EXIT_MS,
      easing: popEasing,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setShown(null);
    });
  }, [message, seq, reduced, anim]);

  if (!shown) return null;

  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        // 104 clears the tab bar on a device with no home indicator; every
        // point the bar grows by, the toast rises with it.
        bottom: 104 + Math.max(bottomInset - 26, 0),
        zIndex: 95,
        // A toast can carry a name or a circle name, so it needs room to be a
        // pill rather than a band touching both edges.
        paddingHorizontal: 24,
        alignItems: 'center',
      }}
    >
      <Animated.View
        style={[
          {
            backgroundColor: color.ink,
            borderRadius: 999,
            paddingHorizontal: 18,
            paddingVertical: 10,
            maxWidth: '100%',
            opacity: anim,
            transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }],
          },
          shadows.toast,
        ]}
      >
        <Bri size={13.5} weight={800} color={color.lime} style={{ textAlign: 'center' }}>
          {shown}
        </Bri>
      </Animated.View>
    </View>
  );
}
