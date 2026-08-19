/** Single-slot toast, `bPop` in, a short fade out, auto-dismissed by the store. */
import React, { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';
import { color, shadows } from '../theme/tokens';
import { POP_DURATION, popEasing, useReducedMotion } from '../theme/motion';
import { Bri } from './primitives';

/** See <Presence>: Jest never runs the exit timer, so exits are instant there. */
const INSTANT_EXIT = typeof process !== 'undefined' && !!process.env?.JEST_WORKER_ID;

const EXIT_MS = 150;

export function Toast({ message, seq }: { message: string | null; seq: number }) {
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
        bottom: 104,
        zIndex: 95,
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
            opacity: anim,
            transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }) }],
          },
          shadows.toast,
        ]}
      >
        <Bri size={13.5} weight={800} color={color.lime}>
          {shown}
        </Bri>
      </Animated.View>
    </View>
  );
}
