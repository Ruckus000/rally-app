/**
 * Entry point. Fonts are bundled locally (both are SIL OFL) and the app waits
 * for them rather than flashing a system-font first paint.
 *
 * The native splash is held open by hand until that wait is over. Expo hides it
 * as soon as the first React frame commits, which without this would reveal the
 * boot screen behind it and then swap that for the app — two transitions where
 * there should be one. Held, the sequence is: OS splash, the same mark drawn by
 * React, the app.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  BricolageGrotesque_500Medium,
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from '@expo-google-fonts/instrument-sans';
import { App } from './src/App';
import { BootScreen } from './src/screens/BootScreen';
import { ThemeProvider } from './src/theme/ThemeProvider';
import { loadPersistedState } from './src/state/store';
import type { State } from './src/state/store';

// Called before the component mounts, which is the only place early enough to
// matter. It rejects if the splash has already gone; there is nothing to do
// about that and nothing to report, so it is swallowed.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function Root() {
  // Restored state has to be in hand before the first render, or the app would
  // paint the onboarding screen and then swap it out from under you.
  const [restored, setRestored] = useState<Partial<State> | null | undefined>(undefined);

  useEffect(() => {
    loadPersistedState().then(setRestored).catch(() => setRestored(null));
  }, []);

  const [loaded, error] = useFonts({
    BricolageGrotesque_500Medium,
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
  });

  // A font that fails to load is not a reason to sit on a splash screen
  // forever: `error` means give up waiting and render in whatever is available.
  const ready = (loaded || !!error) && restored !== undefined;

  // Hidden on layout rather than in an effect, so the frame underneath is
  // already drawn when the splash lifts. Hiding a frame early is the flash of
  // background colour this whole arrangement exists to avoid.
  const reveal = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // The wrapper carries `onLayout` so neither the boot screen nor the app has
  // to take a prop about splash-screen timing, which is nothing to do with
  // either of them.
  //
  // `ThemeProvider` is here, above the branch, rather than inside `src/App`
  // where it started. The boot screen is the other branch, and it is drawn
  // before the app exists — a provider below the branch would leave the first
  // thing anyone sees as the one surface the palette does not reach. Today
  // that is invisible, because there is one palette. In the PR that adds the
  // dark one it would be a light screen flashing in front of a dark app on a
  // dark device, and the sort of thing that ships because everybody assumed it
  // belonged to somebody else's PR.
  //
  // One provider, not two. Nesting a second inside `src/App` would have worked
  // and would have been something a reader has to reason about for no benefit.
  return (
    <ThemeProvider>
      <View style={{ flex: 1 }} onLayout={reveal}>
        {ready ? <App restored={restored} /> : <BootScreen />}
      </View>
    </ThemeProvider>
  );
}
