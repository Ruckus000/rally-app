/**
 * What you look at while the app gets ready.
 *
 * There are two launch screens on a cold start, not one: the native splash the
 * OS shows before any JavaScript exists, and whatever React paints first. This
 * is the second. It begins as the *same picture* the splash is showing — the
 * core alone, same colour, same size, centred the same way — so the handover is
 * invisible and the app appears to have been on screen the whole time. Before
 * this, the first React frame was a bare paper rectangle, which made the mark
 * vanish and come back.
 *
 * Then the five wedges arrive, one at a time, each sliding down its own spoke
 * onto the core that was already there. That is the mark being assembled —
 * separate people converging on one point — which is also what the app is for.
 *
 * **Why the core is already there, rather than landing last.** The identity
 * spec's loading-state row reads "wedges may fade in one at a time, 72° apart,
 * then the core lands", and this does it the other way round. Not preference:
 * the splash is a static PNG, so whatever it shows is the state this screen
 * must start in. Show the finished mark there — which is what shipped before —
 * and an entrance animation is impossible, because by the time the splash lifts
 * it is over. Filmed, the mark was already complete in the boot screen's first
 * visible frame, and had been for the three-R mark before it. Putting the core
 * on the splash is what buys an arrival anyone can see, and it happens to say
 * the truer thing: the point is already there, and people arrive at it. See
 * `design-reference/DEVIATIONS.md`.
 *
 * **And why nothing waits for the splash to lift.** It briefly did, gated on a
 * `revealed` flag threaded down from the entry file. The worry was that
 * starting on mount would show the mark disassembling as the splash came away —
 * but that could only happen while the splash showed the *finished* mark. Once
 * it shows the core alone, this screen's first frame is the splash's picture
 * whenever the animation starts, because the wedges only ever add to what is
 * already there. The gate defended against a problem the splash art had already
 * solved, so it went.
 *
 * **How often is any of this actually seen? On a warm device, never.** Painting
 * the boot screen magenta and filming a cold start shows no magenta at all:
 * `ready` resolves before the native splash is even hidden, so `Root` goes
 * straight to `App` and this component is never on screen. What the user sees
 * end to end is the splash. That is not a bug to fix — it means the app was
 * ready, which is the outcome you want — and it is exactly why the splash and
 * this screen must keep drawing the same picture. This exists for the slow
 * case: a cold start on a loaded phone, a first launch after install, fonts not
 * yet cached. Do not go looking for the arrival on a fast simulator launch and
 * conclude it is broken; hold `ready` false and it plays exactly as designed.
 *
 * **No spinning**, which the spec is explicit about, and it is right: a
 * rotating logo is a spinner, and a spinner says "waiting" where this should
 * say "arriving". The rotation here is static, baked into the geometry; only
 * the radial slide moves.
 *
 * It is over in under half a second and nobody should consciously notice it; a
 * launch animation you have time to admire is a launch animation that is
 * costing somebody their morning. Under reduced motion the mark is simply
 * there.
 *
 * This draws `mark.ts` directly rather than using `src/components/Logo.tsx`,
 * and must keep doing so: the lockups in that file contain real text, and this
 * screen is on the glass precisely while the fonts are still loading. The mark
 * being geometry instead of a glyph is the whole reason this works.
 */
import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import {
  MARK_ANGLES,
  MARK_CANVAS,
  MARK_CENTER,
  MARK_CORE_R,
  MARK_NUDGE_Y,
  MARK_WEDGE,
} from '../theme/mark';
import { useColors, useTheme } from '../theme/ThemeProvider';
import { useReducedMotion } from '../theme/motion';

/** Matches `imageWidth` in app.json's splash config, so nothing jumps. */
const MARK_WIDTH = 132;

/**
 * Five wedges have to fit inside the window the boot screen is actually on
 * screen for, which was measured at about 670ms on a warm simulator start.
 * 4 × 55 + 190 = 410ms leaves room for that to be an unlucky reading.
 */
const STAGGER = 55;
const FADE = 190;

/** How far up its own spoke a wedge starts, in px at `MARK_WIDTH`. */
const APPROACH = 12;

/**
 * Each wedge is its own layer, and the animation is on a plain `Animated.View`
 * wrapping it rather than on the SVG.
 *
 * This is not a stylistic choice. `<G opacity={someAnimatedValue}>` does not
 * work in react-native-svg: the first render hands the group an Animated.Value
 * where it expects a number, the parser falls back to fully opaque, and no
 * later update ever lands. It fails *silently and in the visible direction* —
 * the mark looks perfect and simply never animates. The three-R climb this
 * replaced was written the same way and had been dead for its entire life;
 * filming a cold start is what finally showed it, after the code, the tests
 * and two rounds of review all read as correct.
 *
 * `Animated.View` has none of that problem, opacity and transform are exactly
 * what it is for, and both run on the native driver.
 *
 * The layers cost five extra `Svg` elements on a screen that draws one shape,
 * which is a fair price for an animation that exists.
 */

export function BootScreen() {
  const color = useColors();
  const { scheme } = useTheme();
  const reduced = useReducedMotion();

  // One value per wedge, created once so a re-render never restarts the
  // arrival halfway through. Lazy `useState` rather than a ref, matching the
  // rest of the app — a ref read during render is exactly what it looks like,
  // a value the render depends on, and the lint rule is right to say so.
  //
  // The core has no value of its own. It is on screen from the first frame
  // because the splash behind it is already showing it.
  const [rise] = useState(() => MARK_ANGLES.map(() => new Animated.Value(0)));

  useEffect(() => {
    if (reduced) {
      rise.forEach((v) => v.setValue(1));
      return;
    }
    const arrive = Animated.stagger(
      STAGGER,
      rise.map((v) => Animated.timing(v, { toValue: 1, duration: FADE, useNativeDriver: true })),
    );
    arrive.start();
    return () => arrive.stop();
  }, [reduced, rise]);

  // The colorway follows the ground, which is the one thing about this screen
  // that does flip: ink and olive on paper, bone and lime on the dark ground.
  // Olive at `#4B6A0B` on `#070A06` would be a hole where the core should be.
  const coreFill = scheme === 'dark' ? color.lime : color.moss;

  const frame = { width: MARK_WIDTH, height: MARK_WIDTH };
  const viewBox = `0 0 ${MARK_CANVAS} ${MARK_CANVAS}`;

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
      <View style={frame}>
        {MARK_ANGLES.map((a, i) => {
          // Outward along this wedge's own spoke. In the wedge's local frame
          // that direction is -y; rotated onto the screen it is this vector,
          // so the five wedges converge rather than sliding in parallel.
          const rad = (a * Math.PI) / 180;
          const out = rise[i].interpolate({ inputRange: [0, 1], outputRange: [APPROACH, 0] });
          return (
            <Animated.View
              key={a}
              style={[
                StyleSheet.absoluteFill,
                {
                  opacity: rise[i],
                  transform: [
                    { translateX: Animated.multiply(out, Math.sin(rad)) },
                    { translateY: Animated.multiply(out, -Math.cos(rad)) },
                  ],
                },
              ]}
            >
              <Svg {...frame} viewBox={viewBox}>
                {/* Five-fold symmetry has no mirror across the horizontal, so
                    the ink box does not sit on the rotation centre. The splash
                    art carries the same nudge; omitting it here would show up
                    as a jump at the handover. */}
                <G transform={`translate(0 ${MARK_NUDGE_Y})`}>
                  <G transform={`rotate(${a} ${MARK_CENTER} ${MARK_CENTER})`}>
                    <Path d={MARK_WEDGE} fill={color.textPrimary} />
                  </G>
                </G>
              </Svg>
            </Animated.View>
          );
        })}
        {/* Last, so the wedge tips pass under it, and never animated: this
            circle is the splash art, still on screen. */}
        <Svg {...frame} viewBox={viewBox} style={StyleSheet.absoluteFill}>
          <G transform={`translate(0 ${MARK_NUDGE_Y})`}>
            <Circle cx={MARK_CENTER} cy={MARK_CENTER} r={MARK_CORE_R} fill={coreFill} />
          </G>
        </Svg>
      </View>
    </View>
  );
}
