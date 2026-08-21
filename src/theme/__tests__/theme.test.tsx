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
 *
 * PR 6d is where that promise ends, and the tests below turn over with it: dark
 * is no longer light, and what is pinned now is the *shape* of the difference —
 * that the two palettes differ, that they carry the identical key set, and that
 * the six tokens the emphasis grammar rests on are byte-for-byte the same in
 * both. The light palette is still pinned exactly, by the inline snapshot.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { App, Root } from '../../App';
import { BootScreen } from '../../screens/BootScreen';
import { StoreProvider } from '../../state/store';
import { color, darkColors } from '../tokens';
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
  "checkboxFill": "#FAFBF7",
  "chip": "#EAEDE2",
  "composerBar": "rgba(255,255,255,.96)",
  "composerEdge": "rgba(25,30,22,.07)",
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
  "needsEdge": "rgba(195,245,60,.75)",
  "onboardBg": "#101408",
  "outline": "rgba(25,30,22,.14)",
  "paper": "#F1F2EC",
  "planBg": "#12170F",
  "planCard": "#1B2116",
  "previewTile": "#E0E6D3",
  "quietText": "#6E7663",
  "quoteInk": "#5A6350",
  "ringQuiet": "#C6DDA0",
  "rowDivider": "rgba(25,30,22,.06)",
  "scrim": "rgba(16,20,8,.42)",
  "sheetGrip": "rgba(25,30,22,.18)",
  "systemTile": "#3B4630",
  "tabbar": "rgba(19,24,13,.94)",
  "textPrimary": "#191E16",
  "waitingChip": "#F6E6C8",
  "waitingText": "#8A6218",
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

  it('resolves dark to a palette of its own', () => {
    // The inverse of what this asserted for five PRs. Until now the promise was
    // that dark *was* light, and this test is what stopped half a dark palette
    // being invented inside a mechanism PR. The palette exists, so the promise
    // flips: these are two different sets of values now, and a regression that
    // pointed `darkTheme` back at `lightColors` would otherwise be silent.
    expect(paletteUnder('dark')).not.toEqual(paletteUnder('light'));
    expect(paletteUnder('dark')).not.toEqual(color);
  });

  it('gives dark exactly the keys light has, so nothing renders undefined', () => {
    // The assertion that earns its keep every time a token is added. A key
    // present in `lightColors` and missing from `darkColors` is `undefined` at
    // the call site, which React Native does not complain about — it just draws
    // nothing, in dark mode only, on whatever surface that token was for.
    // `Palette` catches a missing key at compile time; this catches the case
    // where the value is there and the *serialised* palette has lost it.
    expect(Object.keys(paletteUnder('dark')).sort()).toEqual(Object.keys(color).sort());
  });

  it('holds the six tokens the whole design rests on identical in both', () => {
    // Rally uses dark as an emphasis device: the ink cards, the Plan sheet, the
    // tab bar and four onboarding steps are dark surfaces on a paper ground.
    // The dark palette drops the ground *below* ink rather than inverting, and
    // these six are byte-identical between the schemes because of it — the
    // surfaces were already dark and the accent was never a function of the
    // ground. Give `lime` a dark variant and the app loses its signature; give
    // `ink` one and the emphasis card stops being the thing people recognise.
    //
    // Pinned as an equality against light rather than as hexes, so the two
    // stay welded: the light values themselves are pinned by the inline
    // snapshot above, and between the two there is nowhere for either to move.
    const dark = paletteUnder('dark');
    const light = paletteUnder('light');
    for (const key of ['lime', 'ink', 'planBg', 'planCard', 'onboardBg', 'tabbar'] as const) {
      expect(dark[key]).toBe(light[key]);
    }
  });

  it('has no dark token that is missing, undefined or blank', () => {
    // Read off `darkColors` rather than out of the rendered tree, because
    // `JSON.stringify` drops an `undefined` value entirely and the key-set test
    // above would report it as a missing key rather than as an empty one. An
    // empty string is the worse of the two: it type-checks as a `string`, and
    // React Native resolves it to transparent without a word.
    for (const [key, value] of Object.entries(darkColors)) {
      expect(typeof value).toBe('string');
      expect(value).not.toBe('');
      // Every value in this palette is a hex or an `rgb(a)` triplet. A token
      // that is neither is a typo that would draw as transparent.
      expect(key + ': ' + value).toMatch(/: (#[0-9A-Fa-f]{3,8}|rgba?\()/);
    }
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
