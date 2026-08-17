/**
 * The one thing on screen that says this device has stopped syncing.
 *
 * Deliberately not shown for `offline`. Losing the network is the normal case,
 * it already retries by itself, and a banner that appears in every tunnel is one
 * people learn to look past — which would leave the real thing invisible again.
 * The whole point of the change this belongs to is that those two are different.
 */
import React from 'react';
import { Alert, View } from 'react-native';
import { color, gutter, radius } from '../theme/tokens';
import { Sans, Tap, row } from './primitives';
import { useStore } from '../state/store';
import { ensureSession, retrySession, signOutEverywhere } from '../sync/session';

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Tap
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        borderRadius: radius.chip,
        borderWidth: 1,
        borderColor: color.divider,
        backgroundColor: color.card,
        paddingHorizontal: 12,
        paddingVertical: 7,
      }}
    >
      <Sans size={12} weight={600} color={color.ink}>
        {label}
      </Sans>
    </Tap>
  );
}

/**
 * A new anonymous identity, which is the only kind this app mints.
 *
 * Two things are lost and the wording has to carry both. Whatever the old id
 * owns on the server stays there unreachable, because nothing else holds that
 * id. And the queue is cleared — `store.tsx`'s `lastSelfId` effect does it when
 * the new id lands, which is the one place that decision already lives — so
 * work written before the switch keeps rendering while never reaching the
 * server. "Everything on this device stays" was true about the screen and false
 * about the sync, which is the half a person would care about.
 */
function confirmStartOver(): void {
  Alert.alert(
    'Start over on this device?',
    'You’ll sync as a new account. This week stays on your screen, but nothing written before now will reach the server — and whatever the old account has there becomes unreachable.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Start over',
        style: 'destructive',
        onPress: () => {
          // `signOutEverywhere` leaves the session `off`, and the store's sign-in
          // effect is keyed on `syncOn`, which has not changed — so nothing else
          // would ever ask for the new one.
          void signOutEverywhere().then(() => ensureSession());
        },
      },
    ],
    { cancelable: true },
  );
}

export function SyncBanner() {
  const { state } = useStore();
  const session = state.session;

  if (session.status !== 'expired' && session.status !== 'error') return null;
  const dead = session.status === 'expired';

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        marginHorizontal: gutter,
        marginBottom: 6,
        borderRadius: radius.smallCard,
        backgroundColor: color.askTint,
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 8,
      }}
    >
      <Sans size={12.5} weight={600} lineHeight={17} color={color.ink}>
        {dead
          ? 'Not syncing. This device is signed out — your week is safe here.'
          : session.message}
      </Sans>
      <View style={[row, { gap: 8 }]}>
        <Action label="Try again" onPress={() => void retrySession()} />
        {dead ? <Action label="Start over" onPress={confirmStartOver} /> : null}
      </View>
    </View>
  );
}
