/**
 * The four leaf files that moved onto `useColors()` first, and the promise
 * that moving them changed nothing.
 *
 * These are deliberately the smallest files in the app. The point is not
 * progress on the ~470 reads; it is to run the mechanism against real
 * components, in all three situations they will actually be rendered in — with
 * no provider (which is how most of this suite mounts things), under an
 * explicit light provider, and under a dark one.
 *
 * Every expectation below is written against a token, never against a hex
 * literal. A literal here would be a second copy of the palette that drifts.
 *
 * ## What PR 6d changed about the shape of this file
 *
 * Each row of `describe.each` used to be a wrapping alone, and every assertion
 * read `color.*` — the *light* palette — in all three runs. That was the claim
 * being made on purpose while dark resolved to light: "the same token whatever
 * the scheme". Once the two palettes part, it is simply wrong, and it fails in
 * the least useful way, by reporting the dark palette working correctly.
 *
 * So a row now carries the wrapping **and the palette that wrapping should
 * produce**, and the claim becomes "the token the *active* scheme defines".
 * That version says something in every run rather than something in two of
 * them, and it keeps working the next time a token's dark value is retuned.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { Bri, Caps, Sans } from '../primitives';
import { Banner, BannerAction } from '../Banner';
import { BootScreen } from '../../screens/BootScreen';
import { TabBar } from '../../shell/TabBar';
import { StoreProvider } from '../../state/store';
import { closeButton } from '../../overlays/LedgerOverlay';
import { Palette, Scheme, ThemeProvider, useColors } from '../../theme/ThemeProvider';
import { color, darkColors, lightColors } from '../../theme/tokens';

/**
 * Wrapping, and the palette that wrapping is supposed to produce.
 *
 * `undefined` means no provider at all — the case most of the suite is in, and
 * one that has to keep answering with the light palette rather than throwing.
 */
const wrappings: [Scheme | undefined, Palette][] = [
  [undefined, lightColors],
  ['light', lightColors],
  ['dark', darkColors],
];

const under = (scheme: Scheme | undefined, node: React.ReactElement) =>
  render(scheme === undefined ? node : <ThemeProvider scheme={scheme}>{node}</ThemeProvider>);

/**
 * `Pressable` takes its style as a function of the press state, so `Tap`'s
 * style has to be called before it can be flattened. Everything else hands
 * over an object.
 */
const flat = (style: unknown) =>
  StyleSheet.flatten(
    typeof style === 'function' ? (style as (s: { pressed: boolean }) => unknown)({ pressed: false }) : style,
  ) as Record<string, unknown>;

const styleOf = (label: string) => flat(screen.getByLabelText(label).props.style);

describe.each(wrappings)('with scheme %s', (scheme, palette) => {
  it('draws Bri and Sans in the primary text colour, and Caps in muted', () => {
    under(
      scheme,
      <>
        <Bri accessibilityLabel="bri">7</Bri>
        <Sans accessibilityLabel="sans">body</Sans>
        <Caps accessibilityLabel="caps">LABEL</Caps>
      </>,
    );
    // `textPrimary`, not `ink`. They are the same hex on paper and opposite
    // ends of the ramp on dark, which is the entire reason 6b split them: `ink`
    // is a surface that stays dark, this is text on a ground that flips.
    expect(styleOf('bri').color).toBe(palette.textPrimary);
    expect(styleOf('sans').color).toBe(palette.textPrimary);
    expect(styleOf('caps').color).toBe(palette.muted);
  });

  it('still lets a caller override the colour', () => {
    // `lime` on both sides on purpose: it is one of the six tokens that is
    // byte-identical in the two palettes, so this test survives the split
    // without being parameterised. Reading it from `palette` anyway, so that
    // nothing here has to remember which tokens those six are.
    under(scheme, <Sans accessibilityLabel="override" color={palette.lime} />);
    expect(styleOf('override').color).toBe(palette.lime);
  });

  it('draws the banner on askTint and its action on card', () => {
    under(
      scheme,
      <Banner message="Not syncing">
        <BannerAction label="Retry" onPress={() => {}} />
      </Banner>,
    );
    const banner = flat(screen.UNSAFE_getAllByProps({ accessibilityRole: 'alert' })[0].props.style);
    expect(banner.backgroundColor).toBe(palette.askTint);
    expect(styleOf('Retry').backgroundColor).toBe(palette.card);
    expect(styleOf('Retry').borderColor).toBe(palette.divider);
  });

  it('paints the boot screen on paper', () => {
    // The boot screen is the first thing anyone sees and is drawn before the
    // app exists. On a dark device this is `#070A06`, and the reason the
    // provider sits above the boot/app branch rather than inside it.
    under(scheme, <BootScreen />);
    expect(styleOf('Rally').backgroundColor).toBe(palette.paper);
  });

  it('keeps the tab bar fill and the lime FAB', () => {
    under(
      scheme,
      <StoreProvider persist={false} sync={false}>
        <TabBar bottomInset={0} />
      </StoreProvider>,
    );
    // The other test that survives the split only because `lime` does not
    // move: the FAB is the same green in both schemes, by design, and
    // `theme.test.tsx` is what holds it there.
    expect(styleOf('Plan your week').backgroundColor).toBe(palette.lime);
  });
});

/**
 * The one behavioural detail the default-parameter rewrite could have lost.
 *
 * `color: c = color.ink` fell back only on `undefined`. Resolving it in the
 * body with `??` keeps that; `||` would have additionally swallowed an empty
 * string and quietly substituted ink. Nobody passes an empty string on
 * purpose, which is exactly why nobody would have noticed.
 */
it('falls back only on undefined, the way a parameter default did', () => {
  render(
    <>
      <Sans accessibilityLabel="empty" color="" />
      <Sans accessibilityLabel="absent" />
    </>,
  );
  expect(styleOf('empty').color).toBe('');
  expect(styleOf('absent').color).toBe(color.textPrimary);
});


/**
 * The other shape: a module-level style object that reads the palette.
 *
 * `closeButton` is shared by three overlays, none of which is migrated yet —
 * they all still pass the static `color` import. That is the whole point of
 * the factory shape: it has to work for a caller holding the old import *and*
 * a caller holding the hook, because every PR between this one and the last
 * has files of both kinds sitting next to each other.
 */
describe('the module-level style factory', () => {
  it('gives the same box whether the caller has the import or the hook', () => {
    function Caller() {
      const palette: Palette = useColors();
      return <Text testID="box">{JSON.stringify(closeButton(palette))}</Text>;
    }
    render(
      <ThemeProvider>
        <Caller />
      </ThemeProvider>,
    );
    const fromHook = JSON.parse(screen.getByTestId('box').props.children as string);
    expect(fromHook).toEqual(closeButton(color));
  });

  it('still draws the close button on card, inside a divider', () => {
    expect(closeButton(color).backgroundColor).toBe(color.card);
    expect(closeButton(color).borderColor).toBe(color.divider);
  });
});
