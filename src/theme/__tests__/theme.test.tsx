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

import { App, Root } from '../../App';
import { BootScreen } from '../../screens/BootScreen';
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
    // What this catches: the provider serving anything other than the palette
    // the 31 unmigrated files are still reading directly. A half-migrated
    // screen and an unmigrated one sit side by side for four more PRs, and
    // they have to be drawn from the same values.
    //
    // What it does *not* catch, today: an edit to a token. `color` and
    // `lightColors` are currently the same object, so both sides of this move
    // together. That is what the recorded palette below is for. Once the dark
    // palette lands and `color` becomes one of two, this stops being a
    // tautology and starts carrying its own weight too.
    expect(paletteUnder()).toEqual(color);
  });

  it('is still the palette that was there before dark mode started', () => {
    // The one that stands between this migration and a PR that quietly
    // changes a colour. Recorded rather than hand-copied: a hand-written
    // second copy drifts silently, whereas this one cannot be changed without
    // `-u`, and an updated snapshot shows up in the diff saying exactly which
    // colour moved and by how much. Which is the review signal the whole
    // "nothing may look different" rule depends on.
    //
    // If you are in PR 6 and deliberately changing the light palette, updating
    // this is correct. If you are in PRs 2-5, it is not.
    expect(paletteUnder()).toMatchInlineSnapshot(`
{
  "askTint": "#F7FBE4",
  "avatarText": "#3B4630",
  "card": "#FFFFFF",
  "chip": "#EAEDE2",
  "dash": "#C6CDB8",
  "disabledFill": "rgba(25,30,22,.08)",
  "divider": "rgba(25,30,22,.12)",
  "dotDone": "#B9C2A8",
  "exchangeTrack": "#E3E8D8",
  "faintInk": "#A6AC9C",
  "ink": "#191E16",
  "inputFill": "#F7F8F3",
  "lime": "#C3F53C",
  "limeTintChip": "#EDF7D2",
  "moss": "#4B6A0B",
  "muted": "#6E7663",
  "onboardBg": "#101408",
  "paper": "#F1F2EC",
  "planBg": "#12170F",
  "planCard": "#1B2116",
  "quietText": "#6E7663",
  "quoteInk": "#5A6350",
  "tabbar": "rgba(19,24,13,.94)",
  "textPrimary": "#191E16",
}
`);
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
  it('mounts one provider, above the branch that chooses boot screen or app', () => {
    // Above the branch, not inside `src/App`, so the boot screen is covered
    // too — it is the first thing anyone sees and it is drawn before the app
    // exists. Asserting the placement rather than trusting the JSX: if it
    // migrates back down into `src/App` to be nearer the store, that is a
    // design change and should have to argue with a test.
    // `Root` and not the entry `App.tsx`, which imports `expo-font` and drags
    // the font stack into the test run — that resolves on a developer machine
    // and not on a clean `npm ci`. The claim here is about where the provider
    // sits, and it should not need fonts to make it.
    render(<Root ready={false} />);
    const providers = screen.UNSAFE_getAllByType(ThemeProvider);
    // Exactly one. A second nested inside `src/App` would work and would be a
    // thing a reader has to reason about for no benefit.
    expect(providers).toHaveLength(1);
    // Before the fonts and the persisted state arrive, the branch is the boot
    // screen — which is the whole reason the provider is up here.
    expect(providers[0].findByType(BootScreen)).toBeTruthy();
  });

  it('covers the other branch too, once the app is ready', () => {
    render(<Root ready restored={null} />);
    const providers = screen.UNSAFE_getAllByType(ThemeProvider);
    expect(providers).toHaveLength(1);
    expect(providers[0].findByType(App)).toBeTruthy();
  });

  it('leaves the store below it, because the palette is not account state', () => {
    // `App` carries no provider of its own any more; it inherits the root's,
    // and the store sits inside that rather than around it. Nothing in the
    // reducer reads the palette and a signed-out shell still has to be drawn.
    render(<App persist={false} sync={false} />);
    expect(screen.UNSAFE_queryByType(ThemeProvider)).toBeNull();
    expect(screen.UNSAFE_getByType(StoreProvider)).toBeTruthy();
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
