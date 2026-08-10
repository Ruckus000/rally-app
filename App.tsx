/**
 * Entry point. Fonts are bundled locally (both are SIL OFL) and the app waits
 * for them rather than flashing a system-font first paint.
 */
import React from 'react';
import { View } from 'react-native';
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
import { color } from './src/theme/tokens';

export default function Root() {
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

  if (!loaded && !error) {
    return <View style={{ flex: 1, backgroundColor: color.paper }} />;
  }

  return <App />;
}
