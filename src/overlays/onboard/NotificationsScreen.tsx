/**
 * Step 5 — Notifications. What a cheer looks like when it lands.
 *
 * "Allow notifications" does NOT request permission. expo-notifications isn't
 * installed and push needs a paid Apple developer programme we don't have, so
 * there is nothing to ask. Both buttons simply continue the flow; the screen
 * makes the promise, and the ask gets wired when push actually exists rather
 * than mocked into a prompt that would teach the user the wrong thing.
 */
import React, { useEffect, useState } from 'react';
import { Animated, View, ViewStyle } from 'react-native';
import { color, onDark } from '../../theme/tokens';
import { POP_DURATION, popEasing, useReducedMotion } from '../../theme/motion';
import { Bri, Caps, Sans, fill } from '../../components/primitives';
import { NotificationPreview, PillButton } from './kit';

const POP_DELAY = 150;
/** How far the second push sits inside the first — it reads as further away. */
const SECOND_PUSH_INSET = 14;

export function NotificationsScreen({
  stakeSum,
  hasPicks,
  weekNumber,
  onAllow,
  onLater,
}: {
  stakeSum: number;
  hasPicks: boolean;
  weekNumber: number;
  onAllow: () => void;
  onLater: () => void;
}) {
  const stakeLine = hasPicks
    ? `You staked ${stakeSum} pts — time to move.`
    : 'Time to stake your plan.';

  return (
    <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 30 }}>
      <Caps size={10} tracking={1.9}>
        Step 5 of 5
      </Caps>
      <Bri size={30} weight={800} tracking={-0.9} lineHeight={32} style={{ marginTop: 8 }}>
        Cheers land here.
      </Bri>
      <Sans size={13.5} color={color.muted} lineHeight={20} style={{ marginTop: 8 }}>
        One line from a friend, right when you close a task. No spam. No streak-shame.
      </Sans>

      <Pop style={{ marginTop: 34 }}>
        <NotificationPreview variant="dark" time="now">
          <Sans size={13} lineHeight={18} color={onDark.bodyStrong}>
            {'🔥 Maya cheered "Run 5k" — '}
            <Sans size={13} weight={700} lineHeight={18} color={onDark.bodyStrong}>
              &quot;knew you had it&quot;
            </Sans>
          </Sans>
        </NotificationPreview>

        {/* Inset and behind: the second push is the one you haven't got yet. */}
        <View style={{ marginTop: 10, marginHorizontal: SECOND_PUSH_INSET }}>
          <NotificationPreview variant="light" time="Mon 8:00">
            <Sans size={13} lineHeight={18} color={color.quoteInk}>
              {`Week ${weekNumber} opens today. ${stakeLine}`}
            </Sans>
          </NotificationPreview>
        </View>
      </Pop>

      <View style={fill} />

      <PillButton label="Allow notifications" onPress={onAllow} />
      <PillButton label="Maybe later" variant="text" onPress={onLater} style={{ marginTop: 14 }} />
    </View>
  );
}

/**
 * The design pops the preview stack in behind the copy. Local rather than in
 * the kit because it's the only place in the flow that pops a whole block.
 */
function Pop({ style, children }: { style?: ViewStyle; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const [t] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduced) {
      t.setValue(1);
      return;
    }
    const anim = Animated.timing(t, {
      toValue: 1,
      duration: POP_DURATION,
      delay: POP_DELAY,
      easing: popEasing,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [reduced, t]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: t,
          transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
