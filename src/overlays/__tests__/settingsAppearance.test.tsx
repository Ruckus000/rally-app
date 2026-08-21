/**
 * The Appearance rows, and the one thing that must survive a reset.
 *
 * Rendered through the real `ThemeProvider` and the real `StoreProvider`,
 * because the claim being made is that a tap on this page repaints a tree that
 * neither of them owns jointly: the preference lives above the store, and the
 * palette every screen reads comes from the provider that holds it. A test that
 * mounted the rows against a fake control would prove the rows call a function.
 *
 * `await act` after mounting for the reason the sibling `SettingsOverlay` suite
 * documents — the Monday reminder row asks the OS for permission and resolves a
 * microtask later.
 *
 * The last block is the one with teeth. Reset and sign-out are reducer branches
 * written to `rally:state:v1`; the preference is a separate key that nothing in
 * the app clears. So "wiping your account data does not change how your phone
 * renders" ought to be true by construction — and this is what says so out
 * loud, since the way to break it is a single `AsyncStorage.clear()` added to a
 * reset path by somebody being thorough.
 */
import React from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { StoreProvider, useStore } from '../../state/store';
import { SettingsOverlay } from '../SettingsOverlay';
import { SchemePreference } from '../../theme/schemePreference';
import { Scheme, ThemeProvider, useTheme } from '../../theme/ThemeProvider';

const KEY = 'rally:scheme:v1';

const LABELS = {
  system: 'Follow the system. Rally goes dark when your phone does',
  light: 'Always light, whatever your phone is set to',
  dark: 'Always dark, whatever your phone is set to',
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

/** What the tree behind the overlay is currently being drawn in. */
function Probe() {
  const { scheme } = useTheme();
  return <Text testID="scheme">{scheme}</Text>;
}

const shown = () => screen.getByTestId('scheme').props.children as Scheme;

/** Reset, from outside the component tree, the way `MeScreen`'s control does. */
function Reset() {
  const { dispatch } = useStore();
  React.useEffect(() => {
    dispatch({ type: 'RESET', mode: 'fresh' });
  }, [dispatch]);
  return null;
}

const mount = async (preference: SchemePreference, extra?: React.ReactNode) => {
  const tree = render(
    <ThemeProvider preference={preference}>
      <Probe />
      <StoreProvider persist={false} sync={false} restored={{ settingsOpen: true, account: 'seeded' }}>
        {extra}
        <SettingsOverlay topInset={0} />
      </StoreProvider>
    </ThemeProvider>,
  );
  await act(async () => {});
  return tree;
};

describe('the appearance rows', () => {
  it('offers three, as a radio group', async () => {
    await mount('system');
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    // Read aloud, each label is a whole sentence — a `Tap` collapses its
    // children into one element, so the caption never reaches VoiceOver.
    expect(screen.getByLabelText(LABELS.system)).toBeTruthy();
    expect(screen.getByLabelText(LABELS.light)).toBeTruthy();
    expect(screen.getByLabelText(LABELS.dark)).toBeTruthy();
    // `UNSAFE_getByProps` rather than `getByRole('radiogroup')`: the container
    // is deliberately not an accessibility element of its own — marking it
    // `accessible` would collapse all three options into one — and the query
    // only sees elements that are. The role is still worth setting: Android
    // maps it to a radio group, and it is what says these three are one choice
    // rather than three switches.
    expect(screen.UNSAFE_getByProps({ accessibilityRole: 'radiogroup' })).toBeTruthy();
  });

  it.each<SchemePreference>(['system', 'light', 'dark'])(
    'marks %s selected, and only that one',
    async (preference) => {
      await mount(preference);
      for (const [value, label] of Object.entries(LABELS)) {
        expect(screen.getByLabelText(label).props.accessibilityState.selected).toBe(
          value === preference,
        );
      }
    },
  );

  it('ticks what was chosen, not what is on screen', async () => {
    // Under System the app may well be dark; the ticked row is still System.
    // A control that ticked Dark there would be reporting a setting nobody
    // made, and tapping Dark — a no-op by its own display — would silently
    // stop the phone from ever moving the app again.
    await mount('system');
    expect(screen.getByLabelText(LABELS.system).props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText(LABELS.dark).props.accessibilityState.selected).toBe(false);
  });

  it('applies immediately, and remembers, from one tap', async () => {
    await mount('light');
    expect(shown()).toBe('light');

    fireEvent.press(screen.getByLabelText(LABELS.dark));

    // Repainted: the whole tree, not just this page.
    expect(shown()).toBe('dark');
    // Moved the tick, with no confirm step in between.
    expect(screen.getByLabelText(LABELS.dark).props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText(LABELS.light).props.accessibilityState.selected).toBe(false);
    // And written, which is the half a screenshot cannot check.
    await act(async () => {});
    await expect(AsyncStorage.getItem(KEY)).resolves.toBe('dark');
  });

  it('is offered to a demo account too, because it is not an account fact', async () => {
    // Mounted as `seeded` throughout this file. Name and photo are `live`-only;
    // this is not, and never should be.
    await mount('system');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });
});

describe('resetting app data', () => {
  it('leaves the preference alone', async () => {
    await AsyncStorage.setItem(KEY, 'dark');
    await mount('dark', <Reset />);

    // The reducer has been wiped to pre-onboarding; the palette has not moved.
    expect(shown()).toBe('dark');
    await expect(AsyncStorage.getItem(KEY)).resolves.toBe('dark');
    expect(screen.getByLabelText(LABELS.dark).props.accessibilityState.selected).toBe(true);
  });
});
