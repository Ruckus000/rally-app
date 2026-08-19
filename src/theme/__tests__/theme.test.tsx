/**
 * The guard on a five-PR migration.
 *
 * Dark mode arrives by moving ~470 `color.*` reads onto `useColors()` one area
 * at a time, and every PR until the last one promises the same thing: nothing
 * may look different. A reviewer cannot check 470 token swaps against a design.
 * What they can check is that the palette behind the hook is still the palette
 * that was there before — and that is what the first test here does, by deep
 * equality against the exported `color` itself.
 *
 * Written against `color`, not against a copied literal, on purpose. A copy is
 * a second source of truth that drifts the moment somebody edits one of them,
 * and a test that has drifted proves nothing while looking like it proves
 * everything.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { App } from '../../App';
import { StoreProvider } from '../../state/store';
import { color } from '../tokens';
import { Scheme, ThemeProvider, useColors, useTheme } from '../ThemeProvider';

/**
 * The palette, serialised into the tree.
 *
 * Reading it back out of rendered JSON rather than assigning to a closure
 * variable during render: the latter is what `react-hooks/globals` forbids,
 * and it is right to — a render that writes to something outside itself is a
 * render with a side effect.
 */
function Probe() {
  const colors = useColors();
  return <Text testID="palette">{JSON.stringify(colors)}</Text>;
}

function Scheme_() {
  const { scheme } = useTheme();
  return <Text testID="scheme">{scheme}</Text>;
}

/** The palette the hook handed this subtree. `null` scheme means no provider. */
function paletteUnder(scheme?: Scheme | null) {
  const tree = scheme === null ? <Probe /> : <ThemeProvider scheme={scheme}><Probe /></ThemeProvider>;
  const { getByTestId, unmount } = render(tree);
  const seen = JSON.parse(getByTestId('palette').props.children as string);
  unmount();
  return seen;
}

function schemeUnder(scheme?: Scheme) {
  const { getByTestId, unmount } = render(
    <ThemeProvider scheme={scheme}>
      <Scheme_ />
    </ThemeProvider>,
  );
  const seen = getByTestId('scheme').props.children;
  unmount();
  return seen;
}

describe('the default palette', () => {
  it('is value-identical to the exported color', () => {
    // The test this whole migration rests on. If a later PR changes a token
    // while claiming to change no pixels, this is what fails.
    expect(paletteUnder()).toEqual(color);
  });

  it('has exactly the keys color has, so nothing renders undefined', () => {
    expect(Object.keys(paletteUnder()).sort()).toEqual(Object.keys(color).sort());
  });

  it('reports the light scheme', () => {
    expect(schemeUnder()).toBe('light');
  });
});

describe('an explicit scheme', () => {
  it('is what the subtree gets', () => {
    expect(schemeUnder('dark')).toBe('dark');
  });

  it('resolves dark to the light palette, because there is no dark one yet', () => {
    // Deliberate, not unfinished: the dark palette is PR 6. Until then this
    // test is what stops half of one being invented in a migration PR.
    expect(paletteUnder('dark')).toEqual(color);
    expect(paletteUnder('dark')).toEqual(paletteUnder('light'));
  });
});

describe('outside a provider', () => {
  it('returns the light palette rather than throwing', () => {
    // Dozens of existing tests mount a screen with no provider around it. A
    // hook that threw here would turn a mechanism change into a suite-wide
    // edit — which is the blast radius this sequence of PRs exists to avoid.
    expect(() => paletteUnder(null)).not.toThrow();
    expect(paletteUnder(null)).toEqual(color);
  });
});

describe('the real root', () => {
  it('mounts the provider, and mounts it above the store', () => {
    // Above the store rather than inside it because the palette is a device
    // fact, not account state. Asserting the nesting rather than trusting the
    // JSX: if somebody later moves it inside `StoreProvider` to reach state,
    // that is a design change and should have to argue with a test.
    render(<App persist={false} sync={false} />);
    const provider = screen.UNSAFE_getByType(ThemeProvider);
    expect(provider.findByType(StoreProvider)).toBeTruthy();
  });

  it('still paints the real chrome in the real palette', () => {
    // One end-to-end colour assertion through the actual root, because every
    // other test here reads the palette rather than something drawn with it.
    // The FAB is the app's single loudest surface; if the wiring ever hands a
    // screen a different palette, this is where it shows up first.
    render(<App persist={false} sync={false} />);
    const fab = StyleSheet.flatten(screen.getByLabelText('Plan your week').props.style);
    expect(fab.backgroundColor).toBe(color.lime);
  });
});
