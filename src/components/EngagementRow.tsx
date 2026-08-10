/**
 * The 🔥 / 💬 / optional-CTA row under a feed card.
 *
 * Two rules from the handoff live here. A zero count becomes the verb
 * ("Cheer", "Note") rather than a bare zero. And a tap on one of these buttons
 * must not also open the card's detail sheet: RN's responder system already
 * gives the inner pressable the touch so the card behind it never fires, and
 * the explicit stopPropagation below keeps that true if this ever renders on
 * web, where events really do bubble.
 */
import React from 'react';
import { GestureResponderEvent, View } from 'react-native';
import { color, onDark } from '../theme/tokens';
import { Icon } from './Icon';
import { Sans, Tap, row } from './primitives';

const engButton = (active: boolean, dark: boolean) => ({
  ...row,
  gap: 6,
  paddingVertical: 11,
  paddingHorizontal: 4,
  minHeight: 44,
  color: active ? (dark ? color.lime : color.moss) : dark ? onDark.secondary : color.muted,
});

export function EngagementRow({
  cheered,
  cheerCount,
  commentCount,
  onCheer,
  onComment,
  dark = false,
  cheerLabel,
  cta,
}: {
  cheered: boolean;
  cheerCount: number;
  commentCount: number;
  onCheer: () => void;
  onComment: () => void;
  dark?: boolean;
  /** Overrides the count, for cards whose cheer total is always shown. */
  cheerLabel?: string;
  cta?: { label: string; onPress: () => void; style: 'lime' | 'inkOnLime' | 'ghostLime' };
}) {
  const cheerStyle = engButton(cheered, dark);
  const commentStyle = engButton(false, dark);

  const swallow = (fn: () => void) => (e: GestureResponderEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <View style={[row, { gap: 18, marginTop: 12 }]}>
      <Tap
        onPress={swallow(onCheer)}
        accessibilityLabel={cheered ? 'Take back your cheer' : 'Cheer'}
        accessibilityState={{ selected: cheered }}
        style={{ ...row, gap: 6, paddingVertical: 11, paddingHorizontal: 4, minHeight: 44 }}
      >
        <Sans size={13}>🔥</Sans>
        <Sans size={13} weight={700} color={cheerStyle.color}>
          {cheerLabel ?? (cheerCount ? String(cheerCount) : 'Cheer')}
        </Sans>
      </Tap>

      <Tap
        onPress={swallow(onComment)}
        accessibilityLabel={commentCount ? `${commentCount} notes` : 'Leave a note'}
        style={{ ...row, gap: 6, paddingVertical: 11, paddingHorizontal: 4, minHeight: 44 }}
      >
        <Icon name="comment" size={15} color={commentStyle.color} />
        <Sans size={13} weight={700} color={commentStyle.color}>
          {commentCount ? String(commentCount) : 'Note'}
        </Sans>
      </Tap>

      {cta ? (
        <Tap
          onPress={swallow(cta.onPress)}
          style={{
            marginLeft: 'auto',
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 8,
            minHeight: 36,
            justifyContent: 'center',
            backgroundColor:
              cta.style === 'lime'
                ? color.lime
                : cta.style === 'inkOnLime'
                  ? color.ink
                  : 'rgba(195,245,60,.16)',
          }}
        >
          <Sans size={12} weight={700} color={cta.style === 'lime' ? color.ink : color.lime}>
            {cta.label}
          </Sans>
        </Tap>
      ) : null}
    </View>
  );
}
