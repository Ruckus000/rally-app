/** Single-slot toast, `bPop` in, auto-dismissed by the store. */
import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { color, shadows } from '../theme/tokens';
import { POP_DURATION, popEasing, useReducedMotion } from '../theme/motion';
import { Bri } from './primitives';

export function Toast({ message, seq }: { message: string | null; seq: number }) {
  const reduced = useReducedMotion();
  const anim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!message) return;
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
  }, [message, seq, reduced, anim]);

  if (!message) return null;

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
          {message}
        </Bri>
      </Animated.View>
    </View>
  );
}
