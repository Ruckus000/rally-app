/**
 * The four leaf files that moved onto `useColors()` first, and the promise
 * that moving them changed nothing.
 *
 * These are deliberately the smallest files in the app. The point is not
 * progress on the ~470 reads; it is to run the mechanism against real
 * components, in all three situations they will actually be rendered in — with
 * no provider (which is how most of this suite mounts things), under an
 * explicit light provider, and under a dark one, which resolves to the light
 * palette until the last PR of this sequence.
 *
 * Every expectation below is written against a token, never against a hex
 * literal. A literal here would be a second copy of the palette that drifts.
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
import { color } from '../../theme/tokens';

/** `undefined` means no provider at all — the case most of the suite is in. */
const wrappings: (Scheme | undefined)[] = [undefined, 'light', 'dark'];

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

describe.each(wrappings)('with scheme %s', (scheme) => {
  it('draws Bri and Sans in ink, and Caps in muted', () => {
    under(
      scheme,
      <>
        <Bri accessibilityLabel="bri">7</Bri>
        <Sans accessibilityLabel="sans">body</Sans>
        <Caps accessibilityLabel="caps">LABEL</Caps>
      </>,
    );
    expect(styleOf('bri').color).toBe(color.ink);
    expect(styleOf('sans').color).toBe(color.ink);
    expect(styleOf('caps').color).toBe(color.muted);
  });

  it('still lets a caller override the colour', () => {
    under(scheme, <Sans accessibilityLabel="override" color={color.lime} />);
    expect(styleOf('override').color).toBe(color.lime);
  });

  it('draws the banner on askTint and its action on card', () => {
    under(
      scheme,
      <Banner message="Not syncing">
        <BannerAction label="Retry" onPress={() => {}} />
      </Banner>,
    );
    const banner = flat(screen.UNSAFE_getAllByProps({ accessibilityRole: 'alert' })[0].props.style);
    expect(banner.backgroundColor).toBe(color.askTint);
    expect(styleOf('Retry').backgroundColor).toBe(color.card);
    expect(styleOf('Retry').borderColor).toBe(color.divider);
  });

  it('paints the boot screen on paper', () => {
    under(scheme, <BootScreen />);
    expect(styleOf('Rally').backgroundColor).toBe(color.paper);
  });

  it('keeps the tab bar fill and the lime FAB', () => {
    under(
      scheme,
      <StoreProvider persist={false} sync={false}>
        <TabBar bottomInset={0} />
      </StoreProvider>,
    );
    expect(styleOf('Plan your week').backgroundColor).toBe(color.lime);
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
  expect(styleOf('absent').color).toBe(color.ink);
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
