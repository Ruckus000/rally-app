/**
 * What you look at while the app gets ready.
 *
 * There are two launch screens on a cold start, not one: the native splash the
 * OS shows before any JavaScript exists, and whatever React paints first. This
 * is the second. It draws the same mark, in the same colour, at the same size,
 * centred the same way — so the handover is invisible and the app appears to
 * have been on screen the whole time. Before this, the first React frame was a
 * bare paper rectangle, which made the mark vanish and come back.
 *
 * The letters arrive one at a time, bottom first. The mark is three R's
 * climbing a stack, and this is that stack being built — which is also what the
 * app is for. It is over in under half a second and nobody should consciously
 * notice it; a launch animation you have time to admire is a launch animation
 * that is costing somebody their morning.
 *
 * Under reduced motion the letters are simply there.
 */
import React, { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { MARK_CANVAS, MARK_GAP, MARK_LETTERS, MARK_PATH } from '../theme/mark';
import { useColors } from '../theme/ThemeProvider';
import { useReducedMotion } from '../theme/motion';

/** Matches `imageWidth` in app.json's splash config, so nothing jumps. */
const MARK_WIDTH = 132;

const STAGGER = 90;
const FADE = 260;

const AnimatedG = Animated.createAnimatedComponent(G);

export function BootScreen() {
  const color = useColors();
  const reduced = useReducedMotion();

  // One value per letter, created once so a re-render never restarts the climb
  // halfway through. Lazy `useState` rather than a ref, matching the rest of
  // the app — a ref read during render is exactly what it looks like, a value
  // the render depends on, and the lint rule is right to say so.
  const [rise] = useState(() => MARK_LETTERS.map(() => new Animated.Value(0)));

  useEffect(() => {
    if (reduced) {
      rise.forEach((v) => v.setValue(1));
      return;
    }
    const climb = Animated.stagger(
      STAGGER,
      rise.map((v) =>
        Animated.timing(v, { toValue: 1, duration: FADE, useNativeDriver: true }),
      ),
    );
    climb.start();
    return () => climb.stop();
  }, [reduced, rise]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.paper,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessibilityRole="image"
      accessibilityLabel="Rally"
    >
      <Svg width={MARK_WIDTH} height={MARK_WIDTH} viewBox={`0 0 ${MARK_CANVAS} ${MARK_CANVAS}`}>
        {MARK_LETTERS.map((letter, i) => (
          <AnimatedG
            key={i}
            opacity={rise[i]}
            // A short lift rather than a slide: the letter settles onto the
            // stack instead of flying in from somewhere it was never going to be.
            translateY={rise[i].interpolate({ inputRange: [0, 1], outputRange: [34, 0] })}
          >
            <G x={letter.x} y={letter.y}>
              {/* The separation channel, and it is not optional. Without it the
                  three letters weld into one shape — which is exactly what the
                  icon assets did until a component count caught them. Here the
                  ground is a known flat colour, so the channel can be a fat
                  paper-coloured copy under the ink rather than the alpha mask
                  the generator needs. Drawn per letter in stack order, a letter
                  carves the ones already beneath it. */}
              <Path
                d={MARK_PATH}
                fill={color.paper}
                stroke={color.paper}
                strokeWidth={MARK_GAP * 2}
                strokeLinejoin="round"
              />
              <Path d={MARK_PATH} fill={color.textPrimary} />
            </G>
          </AnimatedG>
        ))}
      </Svg>
    </View>
  );
}
