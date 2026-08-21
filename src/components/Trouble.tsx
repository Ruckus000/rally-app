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
 *
 * ## Why it has to be told what it is standing on
 *
 * This line appears on three grounds: the `paper` sheets and cards, the ink
 * profile card on Me, and the onboarding welcome screen's `onboardBg`. It used
 * to draw `chip` on all three and the comment at the Me call site said so —
 * that the light chip "reads against the card's ink the same way it reads
 * against paper".
 *
 * That was true of one palette and is false of two. `chip` and `textPrimary`
 * both flip, which is exactly right on the ground that flips with them and
 * exactly wrong on the two that do not: a `#1D231A` chip on a `#191E16` card is
 * a rectangle nobody can see, carrying near-white text that would have been
 * legible on the card without it. The failure mode is the worst one available —
 * the message survives for a screen reader and disappears for everyone else.
 *
 * So the two always-dark call sites say so, and get `onDark.fill` under
 * `onDark.bodyStrong`: the same ramp every other thing on those grounds
 * already uses, and one that has no light counterpart to be confused about.
 * A prop rather than a hook read, because "am I on an ink card" is a fact only
 * the parent knows — no amount of scheme is going to tell this component.
 */
import React from 'react';
import { View } from 'react-native';
import { onDark, radius } from '../theme/tokens';
import { useColors } from '../theme/ThemeProvider';
import { Sans } from './primitives';

export function Trouble({
  message,
  dark = false,
}: {
  message?: string | null;
  /**
   * The ground under this line is dark in **both** schemes — the ink profile
   * card, an onboarding step. Not "the app is in dark mode": that case is
   * already handled, because `chip` and `textPrimary` both flip.
   *
   * Same name and meaning as `PillButton`'s `dark`, which is the only other
   * component in the app that has to be told this.
   */
  dark?: boolean;
}) {
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
        backgroundColor: dark ? onDark.fill : color.chip,
      }}
    >
      <Sans
        size={12}
        weight={600}
        lineHeight={16.5}
        color={dark ? onDark.bodyStrong : color.textPrimary}
      >
        {message}
      </Sans>
    </View>
  );
}
