/**
 * Step 4 — the circle. Join one with a code, start one of your own, or go
 * without.
 *
 * The two cards are `CircleFork`, which the sheet behind the Circle tab's
 * `+ Join or start` also draws. Only the step chrome and "Ride solo for now"
 * are onboarding's: the fork itself had to stop being reachable exactly once.
 */
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useColors } from '../../theme/ThemeProvider';
import { Bri, Caps, Sans, fill } from '../../components/primitives';
import { CircleFork } from './CircleFork';
import { PillButton } from './kit';


export function CircleScreen({
  onJoin,
  onCreate,
  onSolo,
  busy,
  error,
}: {
  onJoin: (code: string) => void;
  onCreate: (name: string) => void;
  onSolo: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const color = useColors();

  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: 18,
          paddingHorizontal: 24,
          paddingBottom: 30,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Caps size={10} tracking={1.9} color={color.muted}>
          Step 4 of 5
        </Caps>
        <Bri size={30} weight={800} tracking={-0.9} lineHeight={32.5} style={{ marginTop: 8 }}>
          Don’t do this alone.
        </Bri>
        <Sans size={13.5} lineHeight={19.5} color={color.muted} style={{ marginTop: 8 }}>
          Rally works because someone’s watching. A circle is 3–8 friends who see each other’s weeks.
        </Sans>

        <View style={{ marginTop: 24 }}>
          <CircleFork onJoin={onJoin} onCreate={onCreate} busy={busy} error={error} />
        </View>

        <View style={fill} />

        <PillButton variant="text" label="Ride solo for now" onPress={onSolo} />
      </ScrollView>
    </View>
  );
}
