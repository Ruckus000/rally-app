/**
 * What deleting your account actually does, said before it happens.
 *
 * A screen rather than a line in an alert, because an alert is three lines and
 * this has more than three lines' worth to be honest about — what goes, what
 * does not, and that there is a fortnight in which to change your mind. Apple's
 * own guidance asks for the intent to be confirmed rather than merely
 * collected; this is the confirming.
 *
 * Rendered *inside* `SettingsOverlay` in place of its page, not as an overlay
 * of its own. The zIndex ladder has Rollover at 60 directly above Settings at
 * 59, and both of those are answers the app is waiting on — squeezing a third
 * thing in between them to save a state variable would be paying in the one
 * currency this app has been careful with.
 *
 * Plain, not warm — the exception `ReportSheet` states and this screen
 * inherits. Everywhere else the voice is a friend talking; here that reads as
 * insincere, because somebody on this screen has decided to leave and being
 * charmed at is the last thing they want. Nobody is talked out of it either:
 * the two lists are the facts, and the button says what it does.
 *
 * There is no red on this screen and there should not be one — this app has no
 * red in it anywhere. The confirm that actually guards the action is an OS
 * alert with its own destructive styling, exactly as sign-out and block are
 * guarded, and the weight here is carried by space and a rule.
 */
import React from 'react';
import { ScrollView, View } from 'react-native';
import { gutter, radius } from '../../theme/tokens';
import { useColors } from '../../theme/ThemeProvider';
import { Bri, Sans, Tap, fill, row } from '../../components/primitives';
import { Icon } from '../../components/Icon';
import { Trouble } from '../../components/Trouble';
import { GRACE_DAYS } from './deleteAccount';

/**
 * Everything the cascade reaches, in the order somebody would miss it.
 *
 * Kept in step with `docs/legal/support.html`, which says the same thing to
 * somebody who is not holding the app. If the schema changes, both change.
 */
const GOES = [
  'Your profile, your name and your photo',
  'Every goal you have staked, and every photo on one',
  'Every note you have written, and every note written to you',
  'Your cheers, your pairings and your weekly totals',
  'Your place in every circle you are in, and your notifications',
];

/**
 * The three things it does not reach, and the reason each survives.
 *
 * Listing these is the part most apps leave out, and it is the part somebody
 * deleting an account most needs. Every one of them is a real property of the
 * schema rather than a hedge: `reports.subject_id` is deliberately not a
 * foreign key, `circles.created_by` is `on delete set null`, and
 * `goal_ratings` has no user column at all.
 */
const STAYS = [
  'Reports other people have filed about you. Deleting an account cannot erase a safety record.',
  'Any circle you created, so the people still in it are not thrown out of it. Your name and your place in it go.',
  'The anonymous cache used to price goals. It holds goal text with no link to any account, so there is no way to find yours in it.',
];

export function DeleteAccountScreen({
  topInset,
  busy,
  failed,
  onBack,
  onConfirm,
}: {
  topInset: number;
  busy: boolean;
  /** One line under the button. The screen stays put; nothing has happened. */
  failed: boolean;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const color = useColors();

  return (
    <>
      <View
        style={{
          ...row,
          gap: 10,
          paddingTop: Math.max(topInset, 20) + 16,
          paddingHorizontal: gutter,
          paddingBottom: 6,
        }}
      >
        {/* Back rather than close. This screen was reached from Settings and
            returns there; closing the whole overlay from here would lose the
            page somebody is halfway through reading. */}
        <Tap
          onPress={onBack}
          accessibilityLabel="Back to settings"
          style={{ minHeight: 44, minWidth: 44, justifyContent: 'center' }}
        >
          <Icon name="chevronLeft" size={18} color={color.textPrimary} />
        </Tap>
        <Bri size={19} weight={800} tracking={-0.3} style={fill}>
          Delete account
        </Bri>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 10, paddingHorizontal: gutter, paddingBottom: 28 }}
      >
        <Sans size={14} lineHeight={21} color={color.textPrimary}>
          Your account is deleted {GRACE_DAYS} days from now. Until then nobody else can see you —
          you are gone from your circles, and everything you have written stops being readable. You
          can still change your mind, from the first screen of the app.
        </Sans>

        <Group title="What goes" items={GOES} />
        <Group title="What stays" items={STAYS} />

        <View style={{ height: 1, backgroundColor: color.divider, marginTop: 22, marginBottom: 20 }} />

        <Tap
          onPress={busy ? undefined : onConfirm}
          disabled={busy}
          accessibilityState={{ disabled: busy, busy }}
          accessibilityLabel="Delete my account"
          style={{
            minHeight: 46,
            borderRadius: radius.chip,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: color.ink,
            opacity: busy ? 0.6 : 1,
          }}
        >
          <Sans size={13.5} weight={700} color={color.lime}>
            {busy ? 'Deleting…' : 'Delete my account'}
          </Sans>
        </Tap>

        <View style={{ marginTop: failed ? 10 : 0 }}>
          <Trouble
            message={
              failed ? 'That didn’t reach the server. Nothing has changed — try again in a moment.' : null
            }
          />
        </View>

        <Tap
          onPress={busy ? undefined : onBack}
          disabled={busy}
          accessibilityLabel="Keep my account"
          style={{
            minHeight: 46,
            borderRadius: radius.chip,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 8,
          }}
        >
          <Sans size={13.5} weight={600} color={color.muted}>
            Keep my account
          </Sans>
        </Tap>
      </ScrollView>
    </>
  );
}

/** A titled list. Bullets are drawn, not typed — a character would be read out. */
function Group({ title, items }: { title: string; items: string[] }) {
  const color = useColors();
  return (
    <View style={{ marginTop: 22 }}>
      <Bri size={15} weight={800} style={{ marginBottom: 8 }}>
        {title}
      </Bri>
      {items.map((line) => (
        <View key={line} style={{ ...row, gap: 9, alignItems: 'flex-start', marginBottom: 7 }}>
          <View
            style={{
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: color.muted,
              marginTop: 8,
            }}
          />
          <Sans size={13} lineHeight={19} color={color.muted} style={fill}>
            {line}
          </Sans>
        </View>
      ))}
    </View>
  );
}
