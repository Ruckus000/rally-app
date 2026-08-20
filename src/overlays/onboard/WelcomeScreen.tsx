/**
 * Step 0 — Welcome.
 *
 * DELIBERATE DEVIATION FROM THE DESIGN. The design offers three ways in —
 * Continue with Apple, Continue with Google, Use email instead — and in the
 * prototype all three are the same no-op. None of them is shippable today:
 * Apple and Google need SDKs we don't have plus a paid developer programme, and
 * email OTP is blocked because Supabase's built-in mail service won't deliver
 * outside the project team. What this app actually ships is anonymous sign-in.
 * The design also has no local-only route, so nothing in it reaches the demo
 * modes the offline story and the test suite depend on.
 *
 * So: one primary action that signs in anonymously, keeping the design's paper
 * pill; and one text button in the "Use email instead" treatment that opens the
 * local demo. That last button is the only invention here.
 *
 * WAVE D UPDATE. **Apple is real now, on iOS**, and it is the recovery door: an
 * account that attached an Apple identity is signed back in here, on a device
 * that has never seen it. That is the only job it does — somebody new should tap
 * "Get started", because signing in with Apple before an account exists just
 * creates one with no name and no circle, which is what "Get started" does with a
 * better flow around it.
 *
 * Google is still inert, and on Android so is Apple: `expo-apple-authentication`
 * is iOS-only, so an Android account still has no way back. The coming-soon line
 * has to say which of the two it means rather than both.
 */
import React from 'react';
import { Platform, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { onDark } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import { Bri, Caps, GlowBloom, Sans, row } from '../../components/primitives';
import { HeroSegments, PillButton } from './kit';
import { Trouble } from '../../components/Trouble';

/** The auth pills are 52 here, not the 54 the step CTAs use. */
const AUTH_HEIGHT = 52;
/** Enough to read as unavailable while the designed fill still reads as itself. */
const UNAVAILABLE_OPACITY = 0.55;

const noop = () => {};

export function WelcomeScreen({
  onStart,
  onLookAround,
  onApple,
  busy = false,
  trouble,
}: {
  onStart: () => void;
  onLookAround: () => void;
  /** Absent on Android, where there is no provider to reach. */
  onApple?: () => void;
  busy?: boolean;
  trouble?: string | null;
}) {
  const color = useColors();
  // Rendering decision, so it is read here rather than threaded through a prop:
  // which platform's sign-in exists is not something the flow host knows better.
  const appleReal = Platform.OS === 'ios' && !!onApple;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: color.onboardBg,
        paddingHorizontal: 26,
        paddingBottom: 34,
        overflow: 'hidden',
      }}
    >
      <GlowBloom size={340} top={-140} right={-110} opacity={0.2} />

      {/* The design's 84px is measured from the top of the device; the flow
          container has already applied the safe-area inset. */}
      <View style={[row, { gap: 9, paddingTop: 36 }]}>
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: color.lime,
          }}
        >
          <Bri size={17} weight={800} color={color.ink}>
            R
          </Bri>
        </View>
        <Bri size={21} weight={800} tracking={-0.4} color={color.paper}>
          Rally
        </Bri>
      </View>

      <View style={{ flex: 1, justifyContent: 'center' }}>
        <View style={{ marginBottom: 26 }}>
          <HeroSegments count={7} filled={4} height={7} />
        </View>
        <Bri size={42} weight={800} tracking={-1.6} lineHeight={42.8} color={color.paper}>
          Your week, on the record.
        </Bri>
        <Sans
          size={15}
          lineHeight={22.5}
          color={onDark.bodySecondary}
          style={{ marginTop: 16, maxWidth: 300 }}
        >
          Stake a plan every Monday. Your circle sees what you close — and what you don’t.
        </Sans>
      </View>

      <View style={{ gap: 10 }}>
        <PillButton
          label="Get started"
          variant="paper"
          onPress={onStart}
          style={{ height: AUTH_HEIGHT }}
        />

        {/* Styled as designed, not disabled-styled: `style` lands after the
            variant so the paper and outline fills survive the disabled state. */}
        <PillButton
          label="Continue with Apple"
          variant="paper"
          disabled={!appleReal || busy}
          icon={<AppleMark />}
          // `disabled` is what stops an Android tap; a second guard here would be
          // the same rule stated twice, in two places that could disagree.
          onPress={onApple ?? noop}
          // "Sign back in" rather than "sign in": this is the recovery door, and
          // a screen reader should say which door it is. Android keeps the
          // coming-soon wording, because there it is still true.
          accessibilityLabel={
            appleReal ? 'Continue with Apple, to sign back in' : 'Continue with Apple, coming soon'
          }
          style={{
            height: AUTH_HEIGHT,
            backgroundColor: color.paper,
            ...(appleReal && !busy ? null : { opacity: UNAVAILABLE_OPACITY }),
          }}
        />
        <PillButton
          label="Continue with Google"
          variant="outline"
          disabled
          icon={<GoogleMark />}
          onPress={noop}
          accessibilityLabel="Continue with Google, coming soon"
          style={{
            height: AUTH_HEIGHT,
            backgroundColor: onDark.fill,
            borderWidth: 1,
            borderColor: onDark.hairlineBold,
            opacity: UNAVAILABLE_OPACITY,
          }}
        />
        <Caps size={10} tracking={1.6} color={onDark.tertiary} style={{ textAlign: 'center' }}>
          {appleReal ? 'Already have an account? Continue with Apple' : 'Apple and Google sign-in coming soon'}
        </Caps>

        {/* The failure line sits with the control that failed, which is the whole
            distinction between this and `SyncBanner`. A dismissed Apple sheet
            leaves `trouble` null and so renders nothing at all. */}
        <Trouble message={trouble} />

        <PillButton label="Look around first" variant="text" dark onPress={onLookAround} />
      </View>
    </View>
  );
}

/* The auth marks are brand lockups rather than app iconography, so they live
   here instead of in the icon set. */

function AppleMark() {
  const color = useColors();

  return (
    <Svg width={17} height={17} viewBox="0 0 24 24">
      <Path
        fill={color.ink}
        d="M16.7 12.9c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.8-1.6 0-3.1 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3.1 2.4 1.2-.1 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.6-1-2.7-3.9zM14.4 5.6c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.2-.6 2.8-1.4z"
      />
    </Svg>
  );
}

/*
 * The four hexes below stay hexes. Quoting the rule that flags them, in
 * `eslint.config.js`: they "are a brand lockup, not theme values — they must
 * not follow the palette, in either scheme. They want an
 * `eslint-disable-next-line` with that as the reason, not a token."
 */
function GoogleMark() {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24">
      <Path
        // eslint-disable-next-line no-restricted-syntax -- brand lockup, not a theme value
        fill="#4285F4"
        d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4z"
      />
      <Path
        // eslint-disable-next-line no-restricted-syntax -- brand lockup, not a theme value
        fill="#34A853"
        d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"
      />
      <Path
        // eslint-disable-next-line no-restricted-syntax -- brand lockup, not a theme value
        fill="#FBBC05"
        d="M6.4 14a6 6 0 0 1 0-3.8V7.6H3.1a10 10 0 0 0 0 9l3.3-2.6z"
      />
      <Path
        // eslint-disable-next-line no-restricted-syntax -- brand lockup, not a theme value
        fill="#EA4335"
        d="M12 6c1.5 0 2.8.5 3.8 1.5L18.7 4.7A10 10 0 0 0 3.1 7.6L6.4 10.2C7.2 7.9 9.4 6 12 6z"
      />
    </Svg>
  );
}
