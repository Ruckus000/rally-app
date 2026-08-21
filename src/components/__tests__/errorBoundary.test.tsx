/**
 * The boundary, driven by a component that actually throws.
 *
 * Asserted through a real render rather than by calling the lifecycle methods
 * by hand, because the claim is about what React does with them — that a throw
 * during render reaches `componentDidCatch` at all, and that what replaces the
 * tree is a screen rather than nothing. Calling the methods directly would
 * pass on a boundary React never invokes.
 *
 * React logs the caught error to `console.error` itself. That is expected here
 * and only here, so it is silenced for these tests rather than globally, where
 * it would hide the same message arriving from somewhere it is not expected.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ErrorBoundary } from '../ErrorBoundary';
import { Root } from '../../App';
import { Palette, Scheme, ThemeProvider } from '../../theme/ThemeProvider';
import { darkColors, lightColors, onDark } from '../../theme/tokens';
import { readCrashes } from '../../lib/crashLog';

const Boom = ({ throws }: { throws: boolean }) => {
  if (throws) throw new Error('the sky fell');
  return <Text>fine</Text>;
};

const mount = (throws: boolean) =>
  render(
    <ThemeProvider>
      <ErrorBoundary>
        <Boom throws={throws} />
      </ErrorBoundary>
    </ThemeProvider>,
  );

let quiet: jest.SpyInstance;

beforeEach(async () => {
  await AsyncStorage.clear();
  quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  quiet.mockRestore();
});

describe('when nothing is wrong', () => {
  it('renders its children and nothing of its own', () => {
    mount(false);
    expect(screen.getByText('fine')).toBeTruthy();
    expect(screen.queryByText('This screen stopped working.')).toBeNull();
  });
});

describe('when a render throws', () => {
  it('shows a screen instead of the blank one this replaces', async () => {
    mount(true);
    expect(screen.getByText('This screen stopped working.')).toBeTruthy();
    // The reassurance is load-bearing: the store is persisted independently of
    // the tree, so this is true, and a crash screen that did not say so would
    // read as "your week is gone".
    expect(screen.getByText(/Your week is saved/)).toBeTruthy();
  });

  it('shows what was thrown, so a screenshot is worth sending', () => {
    mount(true);
    expect(screen.getByText(/the sky fell/)).toBeTruthy();
  });

  it('writes it down, so it survives the relaunch that follows', async () => {
    mount(true);
    // The record is async and fired from `componentDidCatch`; let it land.
    await act(async () => {});

    const crashes = await readCrashes();
    expect(crashes).toHaveLength(1);
    expect(crashes[0].message).toBe('the sky fell');
    // React's own trace is the half that says *where*. Asserted as "a trace
    // was captured" rather than against the names in it: React decides how it
    // labels a frame, and pinning that here would be a test of React's
    // formatting rather than of this boundary keeping what it was handed.
    expect(crashes[0].componentStack).toMatch(/\bat .+ErrorBoundary\.tsx/);
  });

  it('counts the earlier ones, which is a different bug report', async () => {
    mount(true);
    await act(async () => {});
    screen.unmount();

    mount(true);
    await act(async () => {});
    expect(await screen.findByText('This happened once before.')).toBeTruthy();
  });

  it('retries by rebuilding the tree', async () => {
    // Not a reload and not a reset: the store was never what threw. The button
    // clears the caught error and lets React mount the children again.
    const view = render(
      <ThemeProvider>
        <ErrorBoundary>
          <Boom throws />
        </ErrorBoundary>
      </ThemeProvider>,
    );
    expect(screen.getByText('This screen stopped working.')).toBeTruthy();

    view.rerender(
      <ThemeProvider>
        <ErrorBoundary>
          <Boom throws={false} />
        </ErrorBoundary>
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByLabelText('Try again'));

    expect(screen.getByText('fine')).toBeTruthy();
  });
});

describe('where it sits', () => {
  it('is mounted in the real root, inside the provider', () => {
    // Without this, every test above passes against a boundary that is never
    // in the tree — the component would be correct and the app would still go
    // white. Asserting the placement rather than trusting the JSX, the same
    // way `theme.test.tsx` does for `ThemeProvider`.
    //
    // Inside the provider, because the fallback reads the palette; wrapping
    // the branch, so a throw in `BootScreen` is caught as well as one in the
    // app. `ready={false}` renders the boot arm, which is the one that would
    // otherwise be easiest to leave uncovered.
    render(<Root ready={false} />);

    const boundaries = screen.UNSAFE_getAllByType(ErrorBoundary);
    expect(boundaries).toHaveLength(1);

    const providers = screen.UNSAFE_getAllByType(ThemeProvider);
    expect(providers).toHaveLength(1);
    expect(providers[0].findByType(ErrorBoundary)).toBeTruthy();
  });
});

/**
 * The palette it is drawn in, in each scheme it can be drawn in.
 *
 * `themedLeaves.test.tsx` makes this claim for the four smallest components in
 * the app and its header explains the shape; these are the same rows for the
 * one screen nobody is looking at when it is first drawn. A colour mistake
 * here stays invisible right up until the moment this is the only thing on the
 * display, which is the worst available moment to find one.
 */
const wrappings: [Scheme | undefined, Palette][] = [
  [undefined, lightColors],
  ['light', lightColors],
  ['dark', darkColors],
];

/** `Tap` is a `Pressable`: its style is a function of the press state. */
const flat = (style: unknown) =>
  StyleSheet.flatten(
    typeof style === 'function'
      ? (style as (s: { pressed: boolean }) => unknown)({ pressed: false })
      : style,
  ) as Record<string, unknown>;

describe.each(wrappings)('drawn under scheme %s', (scheme, palette) => {
  beforeEach(() => {
    render(
      <ThemeProvider scheme={scheme}>
        <ErrorBoundary>
          <Boom throws />
        </ErrorBoundary>
      </ThemeProvider>,
    );
  });

  it('puts the label on the fill rather than on the ground', () => {
    const fill = flat(screen.getByLabelText('Try again').props.style).backgroundColor;
    const label = flat(screen.getByText('Try again').props.style).color;

    expect(fill).toBe(palette.ink);
    // `onDark.primary`, which is the same hex as `paper` in the light rows and
    // its opposite in the dark one — so this row is the only one of the three
    // that can catch the mistake, and it is the reason the row exists. `ink`
    // is a surface that stays dark; a label that followed the ground down
    // would be #070A06 on #191E16, about 1.2:1.
    expect(label).toBe(onDark.primary);
    expect(label).not.toBe(fill);
  });

  it('keeps the stack legible against the box it sits in', () => {
    // The whole argument for showing a stack at all is that somebody can read
    // it off the screen. Two tokens have to hold for that, in both schemes.
    expect(flat(screen.UNSAFE_getByType(ScrollView).props.style).backgroundColor).toBe(
      palette.card,
    );
    expect(flat(screen.getByText(/the sky fell/).props.style).color).toBe(palette.textPrimary);
  });
});
