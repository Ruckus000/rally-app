/**
 * Join a circle with a code, or start one. Two cards, mutually exclusive:
 * opening one closes the other, so there is never a question of which input the
 * keyboard belongs to.
 *
 * Lifted out of onboarding step 4 and left under `onboard/` because it draws
 * with `./kit`'s `ExpandingCard`. It has two callers now. The second is the
 * sheet behind the switcher's `+ Join or start`, and until this was extracted
 * that chip had nothing honest to open: joining by code existed exactly once,
 * during onboarding, and was unreachable forever after — which is backwards,
 * since a second circle is far more often one you were invited to than one you
 * went looking for.
 *
 * It replaced a second, weaker copy rather than adding a third: the invite
 * sheet used to hand-roll a create-only card with no border, no
 * `autoCapitalize` and no join sibling.
 */
import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import { onLight } from '../../theme/tokens';
import { useColors, useKeyboardAppearance, useShadows } from '../../theme/ThemeProvider';
import { Icon } from '../../components/Icon';
import { Bri, Tap, fill, row } from '../../components/primitives';
import { Trouble } from '../../components/Trouble';
import { CIRCLE_NAME_MAX } from '../../state/store';
import { ExpandingCard } from './kit';

/** Short enough to catch a typo, loose enough to accept 'RALLY-7Q2M' or '7Q2M'. */
const MIN_CODE = 4;

export function CircleFork({
  onJoin,
  onCreate,
  busy,
  error,
}: {
  onJoin: (code: string) => void;
  onCreate: (name: string) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const color = useColors();
  const keyboard = useKeyboardAppearance();
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
    <View style={{ gap: 10 }}>
      <ExpandingCard
        title="I have an invite"
        subtitle="A friend sent you a circle code"
        iconBg={color.lime}
        icon={<Icon name="comment" size={18} color={onLight} strokeWidth={2} />}
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
            keyboardAppearance={keyboard}
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
              color: color.textPrimary,
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
            keyboardAppearance={keyboard}
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
              color: color.textPrimary,
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
  const color = useColors();
  const shadows = useShadows();

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
