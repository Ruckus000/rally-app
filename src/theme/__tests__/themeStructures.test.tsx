/**
 * The four structures that joined `colors` on the theme, and the promise that
 * joining it moved nothing.
 *
 * `theme.test.tsx` next door does this for the palette. This does it for
 * `shadows`, `personTints`, `hairlineGradient` and `yearLevelColor` — which
 * were plain module exports until PR 6c, could not be reached by a hook, and
 * so could never have differed between schemes. Now they can, and PR 6d is the
 * PR that deliberately parts them — so what was pinned as "identical under
 * dark" is pinned here as *exactly which entries moved*.
 *
 * That precision is the point. `darkShadows` and `darkHairlineGradient` are
 * spreads of their light counterparts: two of nine shadows and one of six
 * gradient fields are overridden, and everything else is the very same object.
 * "They differ" would pass if somebody re-authored all nine shadows; the list
 * below would not.
 *
 * Read out of rendered JSON rather than assigned to a closure during render,
 * for the reason spelled out in `theme.test.tsx`: a render that writes to
 * something outside itself is a render with a side effect.
 */
import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import {
  darkHairlineGradient,
  darkPersonTints,
  darkShadows,
  darkYearLevelColor,
  hairlineGradient,
  personTints,
  shadows,
  yearLevelColor,
} from '../tokens';
import {
  Scheme,
  ThemeProvider,
  usePersonTints,
  useShadows,
  useTheme,
} from '../ThemeProvider';

function Probe() {
  const { shadows: s, personTints: t, hairlineGradient: g, yearLevelColor: y } = useTheme();
  return <Text testID="structures">{JSON.stringify({ s, t, g, y })}</Text>;
}

/** The same four, but through the two named hooks rather than `useTheme()`. */
function HookProbe() {
  return <Text testID="structures">{JSON.stringify({ s: useShadows(), t: usePersonTints() })}</Text>;
}

function seenUnder(scheme: Scheme | null | undefined, node: React.ReactElement = <Probe />) {
  const tree = scheme === null ? node : <ThemeProvider scheme={scheme}>{node}</ThemeProvider>;
  const { getByTestId, unmount } = render(tree);
  const seen = JSON.parse(getByTestId('structures').props.children as string);
  unmount();
  return seen;
}

const expected = { s: shadows, t: personTints, g: hairlineGradient, y: yearLevelColor };
const darkExpected = {
  s: darkShadows,
  t: darkPersonTints,
  g: darkHairlineGradient,
  y: darkYearLevelColor,
};

/** Serialised, because that is the shape `seenUnder` returns. */
const wire = (v: unknown) => JSON.parse(JSON.stringify(v));

/** Which keys of two same-shaped records hold different values. Sorted. */
const changed = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  Object.keys(a)
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .sort();

describe('the four structures on the theme', () => {
  it('are the ones tokens.ts exports', () => {
    // What this catches: a field on `Theme` wired to the wrong export, or to a
    // copy that has since drifted. Every one of them was an import a component
    // read directly last week, and they have to still be that.
    expect(seenUnder(undefined)).toEqual(JSON.parse(JSON.stringify(expected)));
  });

  it('are the dark ones under dark', () => {
    // The mirror of the test above, and the one that would catch `darkTheme`
    // being wired back to a light structure — which is what "identical under
    // dark" used to assert on purpose, and no longer may.
    expect(seenUnder('dark')).toEqual(wire(darkExpected));
    expect(seenUnder('dark')).not.toEqual(seenUnder('light'));
  });

  it('move in exactly the entries the dark design moves, and no others', () => {
    const dark = seenUnder('dark');
    const light = seenUnder('light');

    // Elevation on dark is a lighter surface, not a darker shadow: the two ink
    // shadows go to zero opacity, and the rest stay. The four lime entries were
    // never elevation — they are the accent glowing on surfaces that do not
    // move — and `tabbar`, `tooltip` and `toast` sit under floating elements
    // that still have to separate from whatever is behind them.
    expect(changed(dark.s, light.s)).toEqual(['card', 'cardStrong']);
    expect(dark.s.card.shadowOpacity).toBe(0);
    expect(dark.s.cardStrong.shadowOpacity).toBe(0);

    // Only `light` moves, and its name is about the *surface* the hairline
    // rings rather than the scheme: `dark` rings an ink card, `composer` rings
    // `planCard`, and neither surface changes.
    expect(changed(dark.g, light.g)).toEqual(['light']);

    // Levels 2 and 3 are a mid-lime and `lime`, which read on either ground.
    // Levels 0 and 1 are the ones whose direction is wrong on dark.
    expect(changed(dark.y, light.y)).toEqual(['0', '1']);
    expect(dark.y[2]).toBe(light.y[2]);
    expect(dark.y[3]).toBe(light.y[3]);

    // Every tint moves. A pastel disc is quiet on paper and the loudest thing
    // on near-black, so there is no slot here that could be left alone —
    // index for index with the light set, and not one value shared.
    expect(dark.t).toHaveLength(light.t.length);
    dark.t.forEach((tint: string, i: number) => expect(tint).not.toBe(light.t[i]));
  });

  it('share by reference every entry that did not have to change', () => {
    // `darkShadows` and `darkHairlineGradient` are spreads, so the entries the
    // dark design leaves alone are the very same objects rather than copies of
    // them. Worth pinning: a copy would pass the value tests above and would be
    // a second place to edit a shadow that is supposed to have one.
    for (const key of ['tabbar', 'fab', 'tooltip', 'toast', 'needsRow', 'addCta', 'doneCta'] as const) {
      expect(darkShadows[key]).toBe(shadows[key]);
    }
    for (const key of ['lightLocations', 'dark', 'darkLocations', 'composer', 'composerLocations'] as const) {
      expect(darkHairlineGradient[key]).toBe(hairlineGradient[key]);
    }
    // And the two that did change are genuinely their own.
    expect(darkShadows.card).not.toBe(shadows.card);
    expect(darkHairlineGradient.light).not.toBe(hairlineGradient.light);
  });

  it('are there outside a provider too', () => {
    // Dozens of tests mount a screen bare. `useShadows()` returning undefined
    // there would spread `...undefined` into a style — legal, silent, and no
    // shadow anywhere in the suite.
    expect(seenUnder(null)).toEqual(seenUnder('light'));
  });
});

describe('the two named hooks', () => {
  it('hand back the same objects useTheme() does', () => {
    // `useShadows()` and `usePersonTints()` exist to save 31 and 4 call sites
    // from spelling `useTheme().x`. They must not be a second path to a second
    // value.
    const via = seenUnder(undefined, <HookProbe />);
    expect(via.s).toEqual(JSON.parse(JSON.stringify(shadows)));
    expect(via.t).toEqual(JSON.parse(JSON.stringify(personTints)));
  });

  it('hand back the dark objects under dark, not the light ones', () => {
    // The hooks are the path 35 call sites take. If `useShadows()` kept
    // answering from the light theme, every one of them would be drawing ink
    // shadows on a near-black ground while `useTheme().shadows` said otherwise.
    const via = seenUnder('dark', <HookProbe />);
    expect(via.s).toEqual(wire(darkShadows));
    expect(via.t).toEqual(wire(darkPersonTints));
    expect(via).not.toEqual(seenUnder('light', <HookProbe />));
  });
});
