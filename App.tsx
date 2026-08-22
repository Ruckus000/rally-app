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

  // `revealed` is the moment the boot screen is genuinely on the glass, and it
  // is a different moment from `laidOut`. The boot screen's arrival animation
  // has to start here rather than on mount: mounted, it is still behind the
  // native splash, and a 500ms arrival is over before anyone could see it.
  // Filmed, the mark was already complete in the first visible frame.
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!laidOut || preference === undefined) return;
    SplashScreen.hideAsync()
      .catch(() => {})
      // Resolved or rejected, the splash is gone or was never ours to hide;
      // either way what is on screen now is us. A `finally` rather than a
      // `then`, because a boot screen that never animates because `hideAsync`
      // rejected is a blank-looking launch.
      .finally(() => setRevealed(true));
  }, [laidOut, preference]);

  // Fonts, splash timing and reading state off disk are all this file does.
  // The shape of the tree — the palette, and the choice between boot screen and
  // app — is `Root`, in `src/App.tsx`, so that it can be tested without
  // dragging `expo-font` into a test run. See the note there.
  return (
    <Root
      ready={ready}
      restored={restored}
      preference={preference}
      onReveal={reveal}
      revealed={revealed}
    />
  );
}
