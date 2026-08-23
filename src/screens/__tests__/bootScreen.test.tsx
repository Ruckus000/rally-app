/**
 * The first thing anybody sees, and the things about it that can be wrong in a
 * way nobody would notice until it shipped. All four of these were found by
 * filming a cold start rather than by reading the code.
 *
 * The core is on screen from the first frame and never animates, because the
 * native splash behind this screen is already showing it — that identity is
 * the whole handover, and it is the first test below.
 *
 * The arrival starts on mount and waits for nothing. It briefly waited for the
 * splash to lift, which lost it altogether on a fast launch — `ready` resolves
 * first, and the screen unmounts before a wedge shows.
 *
 * Under reduced motion the mark has to be *there*. An arrival that is skipped
 * rather than completed leaves a bare core for however long the fonts take.
 *
 * And the colorway follows the ground. Olive `#4B6A0B` on the dark ground
 * `#070A06` is about 1.2:1 — a hole where the core should be — so the core
 * moves to lime with the scheme even though the logo component's does not. The
 * mark on a launch screen is painted *on* the app's own ground, which is the
 * one place that argument runs the other way.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import { Circle, G, Path } from 'react-native-svg';

import { BootScreen } from '../BootScreen';
import { Palette, Scheme, ThemeProvider } from '../../theme/ThemeProvider';
import { darkColors, lightColors } from '../../theme/tokens';
import { MARK_ANGLES } from '../../theme/mark';

/**
 * The static rotation groups — one per spoke. Matched on the composite `G`
 * rather than on what reaches the host: react-native-svg compiles a transform
 * string down to a `matrix` prop, so by then the angle is gone.
 */
const spokes = () =>
  screen
    .UNSAFE_getAllByType(G)
    .filter((n) => typeof n.props.transform === 'string' && n.props.transform.startsWith('rotate'));

/**
 * Everything bound to an `Animated.Value` — the five wedge groups and the core.
 *
 * Found by predicate rather than by type, and read at the wrapper rather than
 * below it, for one reason each. `Animated.createAnimatedComponent` returns a
 * component identity this file cannot reconstruct, so `getAllByType` has
 * nothing to match on; and it hands the element underneath *resolved numbers*
 * which it then keeps up to date imperatively, so those numbers are frozen at
 * whatever the first render saw. The values themselves are the only place the
 * current state is legible.
 */
// `react-test-renderer` ships no types, so `findAll`'s predicate degrades to an
// implicit `any`. This is the shape the two callers below actually rely on.
type Animatable = { __getValue(): number };
type Rendered = { props: { style?: unknown } };

/** The `Animated.Value` behind a node's opacity, if it has one. */
const opacityValue = (n: Rendered): Animatable | undefined => {
  const flat = StyleSheet.flatten(n.props?.style as never) as { opacity?: unknown } | undefined;
  const o = flat?.opacity as Animatable | undefined;
  return typeof o?.__getValue === 'function' ? o : undefined;
};

const bound = (): Animatable[] =>
  screen.UNSAFE_root
    .findAll((n: Rendered) => opacityValue(n) !== undefined, { deep: true })
    .map((n: Rendered) => opacityValue(n)!)
    // `Animated.View` renders a `View` beneath it carrying the same style, so
    // every wedge would otherwise be counted twice.
    .filter((v: Animatable, i: number, all: Animatable[]) => all.indexOf(v) === i);

const under = (scheme: Scheme) =>
  render(
    <ThemeProvider scheme={scheme}>
      <BootScreen />
    </ThemeProvider>,
  );

describe('BootScreen', () => {
  it('draws the whole mark — five wedges and a core', () => {
    under('light');
    expect(screen.UNSAFE_getAllByType(Path)).toHaveLength(MARK_ANGLES.length);
    expect(screen.UNSAFE_getAllByType(Circle)).toHaveLength(1);
  });

  it.each<[Scheme, Palette]>([
    ['light', lightColors],
    ['dark', darkColors],
  ])('paints the %s colorway on its own ground', (scheme, palette) => {
    under(scheme);
    expect(screen.UNSAFE_getAllByType(Path)[0].props.fill).toBe(palette.textPrimary);
    // `moss` on light, `lime` on dark — and `lime` is the same hex in both
    // palettes, so this says something only because the light case is `moss`.
    expect(screen.UNSAFE_getAllByType(Circle)[0].props.fill).toBe(
      scheme === 'dark' ? palette.lime : palette.moss,
    );
  });

  it('shows the core before anything else happens', () => {
    // The splash is a static PNG of exactly this circle. If it were animated,
    // or absent for a frame, the handover would flash — which is the thing
    // this screen exists to prevent. No opacity prop at all: not "animated to
    // 1", simply never animated.
    under('light');
    expect(screen.UNSAFE_getAllByType(Circle)[0].props.opacity).toBeUndefined();
  });

  /**
   * Asserted on the *start*, not on the values. The arrival runs on the native
   * driver, which does not exist under jest — so the JS-side `Animated.Value`s
   * sit at 0 for the whole test whatever happens, and "the wedges are hidden"
   * is a claim that passes just as happily on a screen that is animating. That
   * is the shape of assertion that let a dead animation ship unnoticed. Whether
   * a stagger reached the driver at all is the thing that actually differs.
   */
  it('starts the arrival on mount, waiting for nothing', () => {
    // It used to wait for the splash to lift, which cost the animation
    // entirely: `ready` can resolve first, and then this screen unmounts before
    // a wedge appears. Nothing to wait for now — the splash shows the core, so
    // the first frame matches it whenever the wedges start.
    const stagger = jest.spyOn(Animated, 'stagger');
    stagger.mockClear();
    under('light');
    expect(stagger).toHaveBeenCalledTimes(1);
    // Five of them, in the mark's own order, staggered rather than together.
    expect(stagger.mock.calls[0][1]).toHaveLength(MARK_ANGLES.length);
    expect(stagger.mock.calls[0][0]).toBeGreaterThan(0);
    stagger.mockRestore();
  });

  it('leaves the mark visible under reduced motion', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    under('light');
    // `AccessibilityInfo` answers asynchronously, so this has to be polled
    // rather than read. Reading straight after `render` finds the zeros every
    // value is born with — a test that would pass only by accident, and fail
    // by reporting the very thing it exists to prove.
    //
    // Opacity, not presence: a mark that never faded up is fully in the tree
    // and completely invisible, which is the failure mode worth catching.
    await waitFor(() => {
      const values = bound().map((v) => v.__getValue());
      expect(values).toHaveLength(MARK_ANGLES.length);
      expect(values).toEqual(values.map(() => 1));
    });
    jest.restoreAllMocks();
  });

  it('animates nothing that react-native-svg has to render', () => {
    // The regression test for the bug that made every previous version of this
    // screen a still image.
    //
    // `<G opacity={someAnimatedValue}>` does not work: the first render hands
    // the group an Animated.Value where a number belongs, the parser falls back
    // to fully opaque, and no later update ever arrives. It fails silently and
    // in the visible direction — the mark looks right and simply never moves —
    // so nothing short of filming a launch catches it. The three-R climb this
    // replaced was written that way and was dead for its entire life.
    //
    // So: animated values belong on `Animated.View`, and SVG gets numbers.
    under('light');
    const svgElements = [G, Path, Circle] as unknown as React.ComponentType<never>[];
    for (const el of svgElements) {
      for (const node of screen.UNSAFE_queryAllByType(el)) {
        for (const [prop, value] of Object.entries(node.props)) {
          expect(
            `${prop}=${typeof (value as { __getValue?: unknown })?.__getValue}`,
          ).not.toContain('function');
        }
      }
    }
  });

  it('never spins', () => {
    // The identity spec forbids it outright, and a rotating logo is a spinner:
    // it says "waiting" where this should say "arriving". Every rotation here
    // is static — baked into the geometry, on a group that carries no
    // Animated.Value — and the angles are the mark's own.
    under('light');
    const rotations = spokes().map((n) => n.props.transform as string);
    expect(rotations).toEqual(MARK_ANGLES.map((a) => `rotate(${a} 50 50)`));
    for (const n of spokes()) expect(n.props.opacity).toBeUndefined();
  });
});
