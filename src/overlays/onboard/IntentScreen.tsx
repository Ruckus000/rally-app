/**
 * Step 1 — Intent. What you're here to move, which is also what the Stake step
 * draws its suggestions from.
 */
import React from 'react';
import { View } from 'react-native';
import { useColors } from '../../theme/ThemeProvider';
import { Bri, Caps, Sans } from '../../components/primitives';
import { INTENTS, IntentId } from './data';
import { PillButton, SelectChip } from './kit';

export function IntentScreen({
  value,
  onChange,
  onNext,
}: {
  value: IntentId[];
  onChange: (next: IntentId[]) => void;
  onNext: () => void;
}) {
  const color = useColors();
  const n = value.length;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.paper,
        paddingHorizontal: 24,
        paddingTop: 18,
        paddingBottom: 30,
      }}
    >
      <Caps size={10} tracking={1.9} color={color.muted}>
        Step 1 of 5
      </Caps>
      <Bri size={30} weight={800} tracking={-0.9} lineHeight={32.4} style={{ marginTop: 8 }}>
        What are you here to move?
      </Bri>
      <Sans size={13.5} lineHeight={19.6} color={color.muted} style={{ marginTop: 8 }}>
        Pick as many as you like. We’ll suggest a first week around them.
      </Sans>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 24 }}>
        {INTENTS.map((intent) => {
          const selected = value.includes(intent.id);
          return (
            <SelectChip
              key={intent.id}
              icon={intent.icon}
              label={intent.label}
              selected={selected}
              onPress={() =>
                onChange(
                  selected ? value.filter((id) => id !== intent.id) : value.concat(intent.id),
                )
              }
            />
          );
        })}
      </View>

      <View style={{ flex: 1 }} />

      <PillButton
        label={n ? `Continue with ${n} ${n === 1 ? 'focus' : 'focuses'}` : 'Pick at least one'}
        disabled={n === 0}
        onPress={onNext}
        style={{ marginTop: 18 }}
      />
    </View>
  );
}
