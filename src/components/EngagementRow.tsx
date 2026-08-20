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
import { onDark } from '../theme/tokens';
import { useColors, type Palette } from '../theme/ThemeProvider';
import { Icon } from './Icon';
import { Sans, Tap, row } from './primitives';

/**
 * The shared shape of the two engagement buttons, taking the palette rather
 * than closing over it.
 *
 * It has to. This is module scope, where there is no context to ask: a hook
 * cannot be called out here, and the static `color` import is the light
 * palette permanently, whichever scheme the tree above is actually rendering
 * in. Not because the read is cached — the body runs per call — but because
 * the thing it reads never becomes anything else. Passing the palette in keeps
 * the body byte-identical and moves the decision to the call site, which is
 * inside a component and can ask.
 *
 * `onDark` stays a plain import: the dark cards this styles are dark in both
 * schemes, so that ramp is not scheme-dependent.
 */
const engButton = (color: Palette, active: boolean, dark: boolean) => ({
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
  marginTop = 12,
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
  /** The dark big card sits its row 14 from the quote; every other card 12. */
  marginTop?: number;
}) {
  const color = useColors();
  const cheerStyle = engButton(color, cheered, dark);
  const commentStyle = engButton(color, false, dark);

  // Optional: RN only passes an event for real touches, and stopPropagation is
  // a no-op outside web anyway — the guard keeps synthetic invocations safe.
  const swallow = (fn: () => void) => (e?: GestureResponderEvent) => {
    e?.stopPropagation?.();
    fn();
  };

  return (
    <View style={[row, { gap: 18, marginTop }]}>
      <Tap
        onPress={swallow(onCheer)}
        accessibilityLabel={cheered ? 'Take back your cheer' : 'Cheer'}
        accessibilityState={{ selected: cheered }}
        style={{ ...row, gap: 6, paddingVertical: 11, paddingHorizontal: 4, minHeight: 44 }}
      >
        <Sans size={13}>🔥</Sans>
        {/* The check is not decoration: cheered vs not was signalled only by
            moss-vs-muted, two similar dark greens, and the handoff's rule is
            that colour is never the only signal. Same glyph the done state
            and the CTAs already use. */}
        <Sans size={13} weight={700} color={cheerStyle.color}>
          {`${cheerLabel ?? (cheerCount ? String(cheerCount) : 'Cheer')}${cheered ? ' ✓' : ''}`}
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
                  : onDark.limeFill,
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
