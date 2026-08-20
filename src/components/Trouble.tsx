/**
 * One line, in the app's own voice, where something the user just asked for
 * did not work.
 *
 * The design has no failure state — but a code can be wrong, expired, or hit a
 * dead network, and silence would read as the button being broken. This is the
 * smallest honest thing that fits: one line, same voice, announced to screen
 * readers when it appears.
 *
 * It sits under the control that failed, and it goes away when the message
 * does. That is deliberately *not* what `SyncBanner` is: that one is a standing
 * condition with its own actions, mounted once above every tab, and folding the
 * two together would mean a component configured by three props into being two
 * different things. Same voice, different jobs.
 */
import React from 'react';
import { View } from 'react-native';
import { radius } from '../theme/tokens';
import { useColors } from '../theme/ThemeProvider';
import { Sans } from './primitives';

export function Trouble({ message }: { message?: string | null }) {
  const color = useColors();
  if (!message) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        marginTop: 10,
        borderRadius: radius.chip,
        paddingHorizontal: 12,
        paddingVertical: 9,
        backgroundColor: color.chip,
      }}
    >
      <Sans size={12} weight={600} lineHeight={16.5} color={color.textPrimary}>
        {message}
      </Sans>
    </View>
  );
}
