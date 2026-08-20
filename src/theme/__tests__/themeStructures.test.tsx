/**
 * The four structures that joined `colors` on the theme, and the promise that
 * joining it moved nothing.
 *
 * `theme.test.tsx` next door does this for the palette. This does it for
 * `shadows`, `personTints`, `hairlineGradient` and `yearLevelColor` — which
 * were plain module exports until PR 6c, could not be reached by a hook, and
 * so could never have differed between schemes. Now they can, which is the
 * whole point, and which is exactly why both schemes have to be pinned to the
 * same values until the palette PR deliberately parts them.
 *
 * Read out of rendered JSON rather than assigned to a closure during render,
 * for the reason spelled out in `theme.test.tsx`: a render that writes to
 * something outside itself is a render with a side effect.
 */
import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { hairlineGradient, personTints, shadows, yearLevelColor } from '../tokens';
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

describe('the four structures on the theme', () => {
  it('are the ones tokens.ts exports', () => {
    // What this catches: a field on `Theme` wired to the wrong export, or to a
    // copy that has since drifted. Every one of them was an import a component
    // read directly last week, and they have to still be that.
    expect(seenUnder(undefined)).toEqual(JSON.parse(JSON.stringify(expected)));
  });

  it('are identical under dark, because there is no dark palette yet', () => {
    // Deliberate, not unfinished — the same claim `theme.test.tsx` makes about
    // `colors`, extended to the four that just joined it. Until the palette PR
    // lands, "which scheme am I in" must not be answerable by looking at a
    // shadow, a tint, a gradient or a grid cell.
    expect(seenUnder('dark')).toEqual(seenUnder('light'));
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

  it('hand back the same objects under dark', () => {
    expect(seenUnder('dark', <HookProbe />)).toEqual(seenUnder('light', <HookProbe />));
  });
});
