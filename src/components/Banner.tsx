/**
 * A standing condition, said once, above every tab.
 *
 * The chrome only — two of these exist now, `SyncBanner` for a session the
 * server has stopped accepting and `UnsavedBanner` for writes it refused
 * outright, and they have to look like the same voice because they can appear
 * at the same time.
 *
 * Not the same thing as `Trouble`, which is one line under the control that
 * failed and goes away when the message does. This one is a condition rather
 * than a response: nothing the user just did caused it to appear, and scrolling
 * away must not make it go away.
 */
import React from 'react';
import { View } from 'react-native';
import { gutter, radius } from '../theme/tokens';
import { useColors } from '../theme/ThemeProvider';
import { Sans, Tap, row } from './primitives';

export function BannerAction({ label, onPress }: { label: string; onPress: () => void }) {
  const color = useColors();
  return (
    <Tap
      accessibilityLabel={label}
      onPress={onPress}
      // `minHeight` rather than padding alone: `Tap` can only grow a target it
      // can measure, and a chip sized by its own text is one it cannot.
      style={{
        borderRadius: radius.chip,
        borderWidth: 1,
        borderColor: color.divider,
        backgroundColor: color.card,
        paddingHorizontal: 12,
        paddingVertical: 7,
        minHeight: 44,
        justifyContent: 'center',
      }}
    >
      <Sans size={12} weight={600} color={color.textPrimary}>
        {label}
      </Sans>
    </Tap>
  );
}

export function Banner({ message, children }: { message: string; children?: React.ReactNode }) {
  const color = useColors();
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
      <Sans size={12.5} weight={600} lineHeight={17} color={color.textPrimary}>
        {message}
      </Sans>
      <View style={[row, { gap: 8 }]}>{children}</View>
    </View>
  );
}
