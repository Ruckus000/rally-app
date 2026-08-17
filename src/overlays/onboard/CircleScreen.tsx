/**
 * Step 4 — the circle. Join one with a code, start one of your own, or go
 * without. The two cards are mutually exclusive: opening one closes the other,
 * so there is never a question of which input the keyboard belongs to.
 */
import React, { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { color, shadows } from '../../theme/tokens';
import { Icon } from '../../components/Icon';
import { Bri, Caps, Sans, Tap, fill, row } from '../../components/primitives';
import { Trouble } from '../../components/Trouble';
import { CIRCLE_NAME_MAX } from '../../state/store';
import { ExpandingCard, PillButton } from './kit';

/** Short enough to catch a typo, loose enough to accept 'RALLY-7Q2M' or '7Q2M'. */
const MIN_CODE = 4;


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
  const [open, setOpen] = useState<'code' | 'create' | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const canJoin = code.trim().length >= MIN_CODE && !busy;
  const canCreate = !!name.trim() && !busy;

  // A tap that closes the card mid-request would strand the spinner and hide
  // whatever came back, so the cards hold still until the call settles.
  const toggle = (which: 'code' | 'create') => () => {
    if (busy) return;
    setOpen((cur) => (cur === which ? null : which));
  };

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

        <View style={{ gap: 10, marginTop: 24 }}>
          <ExpandingCard
            title="I have an invite"
            subtitle="A friend sent you a circle code"
            iconBg={color.lime}
            icon={<Icon name="comment" size={18} color={color.ink} strokeWidth={2} />}
            open={open === 'code'}
            onPress={toggle('code')}
          >
            <View style={[row, { gap: 8 }]}>
              <TextInput
                value={code}
                // RN ignores `textTransform` on entered text on some platforms,
                // so the value itself is uppercased rather than the style.
                onChangeText={(v) => setCode(v.toUpperCase())}
                onSubmitEditing={() => canJoin && onJoin(code.trim())}
                autoFocus
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="go"
                editable={!busy}
                placeholder="RALLY-XXXX"
                placeholderTextColor={color.faintInk}
                selectionColor={color.moss}
                accessibilityLabel="Circle code"
                style={{
                  ...fill,
                  height: 46,
                  borderRadius: 13,
                  borderWidth: 1.5,
                  borderColor: color.divider,
                  backgroundColor: color.inputFill,
                  paddingHorizontal: 14,
                  fontFamily: 'BricolageGrotesque_700Bold',
                  fontSize: 15,
                  letterSpacing: 2,
                  color: color.ink,
                }}
              />
              <SmallButton
                label={busy ? 'Joining…' : 'Join'}
                enabled={canJoin}
                onPress={() => onJoin(code.trim())}
                paddingHorizontal={20}
              />
            </View>
            {open === 'code' ? <Trouble message={error} /> : null}
          </ExpandingCard>

          <ExpandingCard
            title="Start a circle"
            subtitle="Name it, then invite your people"
            iconBg={color.ink}
            icon={<Icon name="circle" size={18} color={color.lime} strokeWidth={2} />}
            open={open === 'create'}
            onPress={toggle('create')}
          >
            <View style={[row, { gap: 8 }]}>
              <TextInput
                value={name}
                onChangeText={setName}
                onSubmitEditing={() => canCreate && onCreate(name.trim())}
                autoFocus
                // `circles_name_length`. The call is awaited on this screen, so
                // going over would surface as a bare failure on the card.
                maxLength={CIRCLE_NAME_MAX}
                returnKeyType="go"
                editable={!busy}
                placeholder="e.g. The Basement"
                placeholderTextColor={color.faintInk}
                selectionColor={color.moss}
                accessibilityLabel="Circle name"
                style={{
                  ...fill,
                  height: 46,
                  borderRadius: 13,
                  borderWidth: 1.5,
                  borderColor: color.divider,
                  backgroundColor: color.inputFill,
                  paddingHorizontal: 14,
                  fontFamily: 'InstrumentSans_600SemiBold',
                  fontSize: 14,
                  color: color.ink,
                }}
              />
              <SmallButton
                label={busy ? 'Creating…' : 'Create'}
                enabled={canCreate}
                onPress={() => onCreate(name.trim())}
                paddingHorizontal={18}
              />
            </View>
            {open === 'create' ? <Trouble message={error} /> : null}
          </ExpandingCard>

          {/* A failure with both cards shut has nowhere else to land. */}
          {open === null ? <Trouble message={error} /> : null}
        </View>

        <View style={fill} />

        <PillButton variant="text" label="Ride solo for now" onPress={onSolo} />
      </ScrollView>
    </View>
  );
}

/** The inline confirm beside an input — 46px to match the field it follows. */
function SmallButton({
  label,
  enabled,
  onPress,
  paddingHorizontal,
}: {
  label: string;
  enabled: boolean;
  onPress: () => void;
  paddingHorizontal: number;
}) {
  return (
    <Tap
      onPress={onPress}
      disabled={!enabled}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      style={{
        height: 46,
        paddingHorizontal,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: enabled ? color.ink : color.disabledFill,
        ...(enabled ? shadows.card : null),
      }}
    >
      <Bri size={14} weight={800} color={enabled ? color.lime : color.faintInk}>
        {label}
      </Bri>
    </Tap>
  );
}
