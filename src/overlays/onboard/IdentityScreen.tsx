/**
 * Step 2 — Identity. The avatar fills in as you type, so the name lands as a
 * thing your circle will see rather than as a form field.
 */
import React from 'react';
import { TextInput, View } from 'react-native';
import { font } from '../../theme/tokens';
import { useColors, usePersonTints, useShadows } from '../../theme/ThemeProvider';
import { Bri, Caps, Sans } from '../../components/primitives';
import { NAME_MAX } from '../../data/people';
import { handleOf, initialsOf } from './data';
import { PillButton, PulseRing } from './kit';

const AVATAR = 92;
/** The design insets the disc 7px inside the ring. */
const AVATAR_INSET = 7;

export function IdentityScreen({
  value,
  onChange,
  onNext,
  showHandle = true,
}: {
  value: string;
  onChange: (next: string) => void;
  onNext: () => void;
  /**
   * Off for a live account. The handle it previews is derived from what you
   * type, but the server's is minted by the signup trigger and never rewritten
   * — writing it would be a unique collision no retry could clear. So on live
   * this would be showing you an address that isn't yours.
   */
  showHandle?: boolean;
}) {
  const color = useColors();
  const personTints = usePersonTints();
  const shadows = useShadows();
  const named = value.trim().length > 0;

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
        Step 2 of 5
      </Caps>
      <Bri size={30} weight={800} tracking={-0.9} lineHeight={32.4} style={{ marginTop: 8 }}>
        Put a name on it.
      </Bri>
      <Sans size={13.5} lineHeight={19.6} color={color.muted} style={{ marginTop: 8 }}>
        Your circle sees this next to everything you close — and everything you don’t.
      </Sans>

      <View style={{ alignItems: 'center', marginTop: 32, marginBottom: 6 }}>
        <PulseRing size={AVATAR} ringWidth={2.5}>
          <View
            style={{
              position: 'absolute',
              top: AVATAR_INSET,
              left: AVATAR_INSET,
              right: AVATAR_INSET,
              bottom: AVATAR_INSET,
              borderRadius: (AVATAR - AVATAR_INSET * 2) / 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: personTints[0],
            }}
          >
            <Bri size={28} weight={800} color={color.avatarText}>
              {initialsOf(value)}
            </Bri>
          </View>
        </PulseRing>
      </View>

      {/* `handleOf` returns a space when empty so the line keeps its height and
          the avatar doesn't jump on the first keystroke. */}
      <Sans
        size={12.5}
        weight={600}
        color={named ? color.moss : color.faintInk}
        style={{ textAlign: 'center', minHeight: 18, marginBottom: 22 }}
      >
        {showHandle ? handleOf(value) : ' '}
      </Sans>

      <TextInput
        value={value}
        onChangeText={onChange}
        onSubmitEditing={named ? onNext : undefined}
        placeholder="Your name"
        placeholderTextColor={color.faintInk}
        selectionColor={color.moss}
        cursorColor={color.moss}
        returnKeyType="done"
        autoCapitalize="words"
        autoCorrect={false}
        // `profiles_name_length` refuses anything longer, and a refusal here
        // would be a permanent 23514 at the head of the queue. Stopping the
        // keystroke is kinder than dead-lettering the rename.
        maxLength={NAME_MAX}
        accessibilityLabel="Your name"
        style={{
          height: 54,
          backgroundColor: color.card,
          borderRadius: 18,
          paddingHorizontal: 18,
          fontFamily: font.sans[600],
          fontSize: 16,
          color: color.textPrimary,
          ...shadows.card,
        }}
      />

      <View style={{ flex: 1 }} />

      <PillButton
        label="Continue"
        disabled={!named}
        onPress={onNext}
        style={{ marginTop: 18 }}
      />
    </View>
  );
}
