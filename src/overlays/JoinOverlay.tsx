/** Join circle — the onboarding front door. */
import React from 'react';
import { View } from 'react-native';
import { color, onDark } from '../theme/tokens';
import { CIRCLE, CIRCLE_NAME, FRIENDS } from '../data/fixtures';
import { useStore } from '../state/store';
import { Avatar } from '../components/Avatar';
import { Bri, Caps, GlowBloom, Sans, Tap } from '../components/primitives';
import { Overlay } from './Overlay';

export function JoinOverlay() {
  const { dispatch } = useStore();

  return (
    <Overlay
      zIndex={70}
      background={color.ink}
      onRequestClose={() => dispatch({ type: 'SKIP_ONBOARD' })}
      style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34 }}
    >
      <GlowBloom size={220} top={-90} right={-70} opacity={0.22} />

      <Caps size={12} tracking={1.6} color={onDark.secondary}>
        You've been invited to
      </Caps>
      <Bri size={32} weight={800} tracking={-0.8} color={color.paper} style={{ marginTop: 8, marginBottom: 20 }}>
        {CIRCLE_NAME}
      </Bri>

      <View style={{ flexDirection: 'row' }}>
        {FRIENDS.map((k, i) => (
          <Avatar
            key={k}
            who={k}
            size={44}
            style={{ borderWidth: 3, borderColor: color.ink, marginLeft: i ? -12 : 0 }}
          />
        ))}
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: color.avatarText,
            borderWidth: 3,
            borderColor: color.ink,
            marginLeft: -14,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Bri size={12} weight={700} color={color.paper}>
            +2
          </Bri>
        </View>
      </View>

      <Sans size={13} color={onDark.secondary} style={{ marginTop: 16, textAlign: 'center' }}>
        {CIRCLE.length} people, checking in on each other every week
      </Sans>

      <Tap
        onPress={() => dispatch({ type: 'JOIN_CIRCLE' })}
        style={{
          marginTop: 28,
          alignSelf: 'stretch',
          height: 52,
          borderRadius: 16,
          backgroundColor: color.lime,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Bri size={16} weight={800} color={color.ink}>
          Join {CIRCLE_NAME}
        </Bri>
      </Tap>
      <Tap
        onPress={() => dispatch({ type: 'SKIP_ONBOARD' })}
        style={{ marginTop: 14, minHeight: 44, justifyContent: 'center' }}
      >
        <Sans size={13} weight={600} color={onDark.secondary}>
          Skip for now
        </Sans>
      </Tap>
    </Overlay>
  );
}
