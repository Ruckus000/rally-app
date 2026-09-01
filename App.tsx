/**
 * Entry point. Fonts are bundled locally (both are SIL OFL) and the app waits
 * for them rather than flashing a system-font first paint.
 *
 * The native splash is held open by hand until that wait is over. Expo hides it
 * as soon as the first React frame commits, which without this would reveal the
 * boot screen behind it and then swap that for the app — two transitions where
 * there should be one. Held, the sequence is: OS splash, the same mark drawn by
 * React, the app.
 *
 * Two things are read off disk before any of that is allowed to finish: the
 * persisted state, and — since 6e — which palette was chosen in Settings. Both
 * for the same reason. Anything resolved after the first paint is something the
 * user watches the app change its mind about.
 */
import React, { useCallback, useEffect, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
// Six faces, and every one of them is drawn with. Two more were listed here
// and had no call site anywhere; they are gone.
//
// What is *not* true, and was worth an hour to find out: dropping them does not
// shrink the app. Measured in the installed `Rally.app`, before and after, and
// again after a clean install with Metro's cache cleared —
// **1,189,744 bytes of .ttf either way**, across fifteen files, for the 272,632
// bytes these six weights need. Bricolage ships all seven weights and
// Instrument Sans ships four italics nothing has ever referenced.
//
// Per-weight deep imports (`.../700Bold`) do not change it either; that was
// tried and reverted, because each package's root `index.js` `require()`s every
// face and something in the Expo asset pipeline embeds them regardless of what
// the import graph asks for. Whatever that something is, it is not the
// `expo-font` config plugin — a bare plugin entry returns early with no props.
//
// So this list is dead-code removal and two fewer native font registrations at
// boot, and it is not a download saving. If ~900KB of unused faces is worth
// chasing, the lever is in the asset pipeline, not here.
import {
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from '@expo-google-fonts/instrument-sans';
import { Root } from './src/App';
import { loadPersistedState } from './src/state/store';
import { loadSchemePreference } from './src/theme/schemePreference';
import type { SchemePreference } from './src/theme/schemePreference';
import type { State } from './src/state/store';

// Called before the component mounts, which is the only place early enough to
// matter. It rejects if the splash has already gone; there is nothing to do
// about that and nothing to report, so it is swallowed.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function Entry() {
  // Restored state has to be in hand before the first render, or the app would
  // paint the onboarding screen and then swap it out from under you.
  const [restored, setRestored] = useState<Partial<State> | null | undefined>(undefined);

  useEffect(() => {
    loadPersistedState().then(setRestored).catch(() => setRestored(null));
  }, []);

  // Same problem, same gate. Resolve which palette was asked for after the
  // first paint and somebody who chose Dark gets a light frame and then a dark
  // one — the flash this whole arrangement exists to avoid, arriving by a new
  // route. `loadSchemePreference` is written so it cannot reject; the `catch`
  // is belt to that braces, because a promise that never settles here is an
  // app that never starts.
  const [preference, setPreference] = useState<SchemePreference | undefined>(undefined);

  useEffect(() => {
    loadSchemePreference()
      .then(setPreference)
      .catch(() => setPreference('system'));
  }, []);

  // Six registrations, not eight. The bytes are a different question, and the
  // import block above has the measurement.
  const [loaded, error] = useFonts({
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
  });

  // A font that fails to load is not a reason to sit on a splash screen
  // forever: `error` means give up waiting and render in whatever is available.
  const ready = (loaded || !!error) && restored !== undefined && preference !== undefined;

  // Layout is still the trigger — the frame underneath has to be drawn before
  // the splash lifts, or the reveal is a flash of background colour. What
  // changed in 6e is that layout is now a *precondition* rather than the whole
  // condition: the boot screen paints on the first frame, milliseconds before
  // the preference comes back off disk, so lifting the splash there would show
  // it in the phone's scheme and then repaint it in the chosen one. Holding
  // the native splash for those milliseconds costs nothing anybody can see;
  // the repaint is a visible flicker on the very first thing the app draws.
  const [laidOut, setLaidOut] = useState(false);
  const reveal = useCallback(() => setLaidOut(true), []);

  useEffect(() => {
    if (!laidOut || preference === undefined) return;
    SplashScreen.hideAsync().catch(() => {});
  }, [laidOut, preference]);

  // Fonts, splash timing and reading state off disk are all this file does.
  // The shape of the tree — the palette, and the choice between boot screen and
  // app — is `Root`, in `src/App.tsx`, so that it can be tested without
  // dragging `expo-font` into a test run. See the note there.
  return <Root ready={ready} restored={restored} preference={preference} onReveal={reveal} />;
}
