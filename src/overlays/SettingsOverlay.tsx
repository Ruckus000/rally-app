/**
 * Account settings — the one place a live account can see who it is and leave.
 *
 * Before this, "Secure this account" was on the Me card, "Reset app data" was
 * behind `__DEV__`, "Start over" appeared only inside an error banner, and
 * "Continue with Apple" was on a Welcome screen unreachable after onboarding.
 * A signed-in account could not sign out, switch accounts, or reach the
 * recovery path without deleting the app.
 *
 * Presentation only. Which rows a given account is offered lives in
 * `settings/guards.ts`, and what signing out actually does lives in
 * `settings/signOut.ts` — both because those are the rules worth proving
 * without a component tree, and because this file should stay readable.
 *
 * Reset app data is deliberately **not** here. It is data loss with no undo,
 * and a row of it directly below Sign out would make two destructive controls
 * read as siblings. It stays in `MeScreen`'s `__DEV__` block.
 *
 * `zIndex` 59, and the two neighbours are the whole reason for the number. The
 * ladder is Plan 45, Sheet 50, Ledger 55, Notifications 58, **this**,
 * Rollover 60, Onboard 70. Above Notifications because the bell is reachable
 * from the same chrome and this is the more specific place to be. Below
 * Rollover because the week having turned outranks anything on this page —
 * `ROLLOVER_DETECTED` bails on `pendingRollover` and on `onboardStep` but *not*
 * on `settingsOpen`, so the two really can be open at once: leave Settings up,
 * background the app, come back on a new week. Below Onboard for the same kind
 * of reason, from the other end — signing out is where onboarding starts again,
 * and it has to be able to cover this.
 */
import React from 'react';
import { Alert, Linking, Platform, ScrollView, TextInput, View } from 'react-native';
import { color, font, gutter, radius } from '../theme/tokens';
import { Bri, Caps, Sans, Tap, fill, row } from '../components/primitives';
import { Icon } from '../components/Icon';
import { Overlay } from './Overlay';
import { closeButton } from './LedgerOverlay';
import { Trouble } from '../components/Trouble';
import { useStore } from '../state/store';
import { NAME_MAX } from '../data/people';
import { queueProfileName } from '../sync/engine';
import { linkApple } from '../sync/session';
import { appleTrouble } from '../lib/appleCopy';
import { askForReminders, hasReminderPermission } from '../lib/reminders';
import type { AccountMode } from '../data/seed';
import type { SessionState } from '../sync/session';
import { canSecure, signOutEnabled, signOutVisible } from './settings/guards';
import { attemptSignOut, unsentLine } from './settings/signOut';

/**
 * What this account is, in one sentence, per platform.
 *
 * Honest rather than encouraging. The Android line has to carry two facts at
 * once — no way back, and no sign-out — because on Android the sign-out row is
 * absent for every account, and an absence with no explanation reads as a
 * feature somebody forgot rather than a consequence of Apple being the only
 * provider wired up.
 *
 * Exported for its own tests rather than pinned through a render with
 * `Platform.OS` mocked. That is a slightly wider surface than the page strictly
 * needs, and it buys something real: the Android branch is the one piece of
 * copy on this page that a person can never see on the device they wrote it on,
 * so it is exactly the branch a mock that quietly failed to take effect would
 * let through. A pure function takes the platform as an argument and cannot
 * fall through to the host.
 */
export function accountLine(
  account: AccountMode | null,
  session: SessionState,
  platform: typeof Platform.OS,
): string {
  // The heading above this line already says "Demo", so the word does not
  // appear again here — twice in two lines reads as a template, not a sentence.
  if (account !== 'live') {
    return 'Nothing here reaches a server. It’s all made up, and it’s all yours.';
  }
  if (session.status !== 'ready') return 'Signed in. Checking this account…';
  if (!session.anonymous) return 'Signed in, and this account can be got back with Apple.';
  return platform === 'ios'
    ? 'Signed in, but this account can’t be got back yet. Secure it below and you can sign back in on a new phone.'
    : 'Signed in, but this account can’t be got back — signing in with Apple is iOS-only for now. That’s also why there’s no sign-out here: there’d be no way back.';
}

export function SettingsOverlay({ topInset }: { topInset: number }) {
  const { state, dispatch, people } = useStore();
  const { account, session } = state;
  const live = account === 'live';
  const close = () => dispatch({ type: 'CLOSE_SETTINGS' });

  return (
    <Overlay zIndex={59} background={color.paper} onRequestClose={close}>
      <View
        style={{
          ...row,
          gap: 10,
          paddingTop: Math.max(topInset, 20) + 16,
          paddingHorizontal: gutter,
          paddingBottom: 6,
        }}
      >
        <Bri size={19} weight={800} tracking={-0.3} style={fill}>
          Settings
        </Bri>
        <Tap onPress={close} accessibilityLabel="Close settings" style={closeButton}>
          <Icon name="close" size={16} color={color.ink} />
        </Tap>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 10, paddingHorizontal: gutter, paddingBottom: 28 }}
      >
        <Section title="Account">
          <Card>
            <Bri size={15} weight={800}>
              {live ? 'Live' : 'Demo'}
            </Bri>
            <Sans size={12.5} lineHeight={17.5} color={color.muted} style={{ marginTop: 4 }}>
              {accountLine(account, session, Platform.OS)}
            </Sans>
            {live && session.status === 'ready' ? (
              // Enough of the uuid to say "this one, not that one" when two
              // installs are being compared, and not so much that it reads as
              // something to copy down.
              <Sans size={11.5} color={color.faintInk} style={{ marginTop: 6 }}>
                Account {session.userId.slice(0, 8)}
              </Sans>
            ) : null}
          </Card>
        </Section>

        {live ? (
          <Section title="Your name">
            <NameField current={people.name(state.selfId)} />
          </Section>
        ) : null}

        <Section title="Notifications">
          <RemindersRow />
        </Section>

        {canSecure(account, session, Platform.OS) ? (
          <Section title="Getting back in">
            <SecureRow />
          </Section>
        ) : null}

        {signOutVisible(account, session) ? (
          <Section title="Leaving">
            <SignOutRow enabled={signOutEnabled(session)} />
          </Section>
        ) : null}
      </ScrollView>
    </Overlay>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Caps size={11} tracking={1.4} style={{ marginHorizontal: 2, marginBottom: 9 }}>
        {title}
      </Caps>
      {children}
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: color.card,
        borderRadius: radius.chip,
        paddingVertical: 13,
        paddingHorizontal: 14,
      }}
    >
      {children}
    </View>
  );
}

/**
 * The second door onto renaming yourself; the first is the Me card.
 *
 * Two entry points, one behaviour: the same dispatch and the same
 * `queueProfileName` in the same tick, because the queue is what carries the
 * name to the server and a rename that only moved local state would come back
 * wrong on the next pull. Commits on blur as well as submit, so tapping away
 * saves rather than silently discarding — `RENAME_SELF` ignores an empty or
 * unchanged name, which is what makes opening the page and leaving a no-op.
 */
function NameField({ current }: { current: string }) {
  const { dispatch } = useStore();
  const [draft, setDraft] = React.useState(current);

  const commit = () => {
    dispatch({ type: 'RENAME_SELF', name: draft });
    queueProfileName(draft);
  };

  return (
    <TextInput
      value={draft}
      onChangeText={setDraft}
      onSubmitEditing={commit}
      onBlur={commit}
      maxLength={NAME_MAX}
      autoCapitalize="words"
      autoCorrect={false}
      returnKeyType="done"
      selectionColor={color.lime}
      accessibilityLabel="Your name"
      style={{
        fontFamily: font.sans[600],
        fontSize: 15,
        color: color.ink,
        backgroundColor: color.card,
        borderRadius: radius.chip,
        paddingHorizontal: 14,
        // 44px minimum, met by the box rather than by hitSlop: this one is a
        // field, and a field you have to aim for is worse than a big one.
        minHeight: 48,
        paddingVertical: 12,
      }}
    />
  );
}

/**
 * The Monday reminder, from the one screen you can reach again.
 *
 * Onboarding asks once and never comes back, so somebody who tapped past it had
 * no way to change their mind. iOS only shows its prompt the first time, which
 * is why a declined answer routes to the OS settings app instead of asking
 * again — re-asking would silently do nothing and look like a dead button.
 */
function RemindersRow() {
  const [granted, setGranted] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let alive = true;
    void hasReminderPermission().then((yes) => {
      if (alive) setGranted(yes);
    });
    return () => {
      alive = false;
    };
  }, []);

  const press = () => {
    if (granted) return void Linking.openSettings();
    void askForReminders().then((answer) => setGranted(answer === 'granted'));
  };

  // Unknown until the effect answers. Rendering "Off" in the meantime would be
  // a guess the user could act on, so the row says nothing it doesn't know.
  const status =
    granted === null
      ? 'Checking…'
      : granted
        ? 'On. Monday morning, with what you staked.'
        : 'Off. One nudge a week, when the week opens.';

  return (
    <Tap
      onPress={granted === null ? undefined : press}
      accessibilityLabel={
        granted
          ? 'Monday reminder is on. Change it in system settings'
          : 'Turn on the Monday reminder'
      }
      style={{ ...row, gap: 12, ...cardBox }}
    >
      <View style={fill}>
        <Bri size={15} weight={800}>
          Monday reminder
        </Bri>
        <Sans size={12.5} lineHeight={17} color={color.muted} style={{ marginTop: 3 }}>
          {status}
        </Sans>
      </View>
      {granted === null ? null : (
        <Sans size={12.5} weight={700} color={color.moss}>
          {granted ? 'Settings' : 'Turn on'}
        </Sans>
      )}
    </Tap>
  );
}

/**
 * The same offer `MeScreen` makes, in the place somebody would go looking for
 * it. Success is confirmed by the row removing itself: `linkApple` re-reads the
 * session, the store folds it in, `canSecure` turns false and the section is
 * gone. A dismissed sheet says nothing at all — the user cancelled, and telling
 * them so would be the app arguing with them.
 */
function SecureRow() {
  const [busy, setBusy] = React.useState(false);
  const [trouble, setTrouble] = React.useState<string | null>(null);

  const secure = async () => {
    setBusy(true);
    setTrouble(null);
    try {
      const result = await linkApple();
      if (!result.ok && result.reason !== 'cancelled') setTrouble(appleTrouble(result.reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Tap
        onPress={busy ? undefined : () => void secure()}
        accessibilityLabel="Secure this account with Apple, so you can sign back in"
        style={{ ...row, gap: 12, ...cardBox }}
      >
        <View style={fill}>
          <Bri size={15} weight={800}>
            {busy ? 'Securing…' : 'Secure this account'}
          </Bri>
          <Sans size={12.5} lineHeight={17} color={color.muted} style={{ marginTop: 3 }}>
            Continue with Apple, and this account comes back on a new phone.
          </Sans>
        </View>
      </Tap>
      <Trouble message={trouble} />
    </View>
  );
}

/**
 * Leaving, with the one guard this whole feature exists for.
 *
 * `SIGN_OUT` is dispatched **only** on `{ ok: true }`. `attemptSignOut` refuses
 * while anything is still queued, and the dispatch wipes the device — so moving
 * the dispatch out of that `if` would take unsent work off the phone forever
 * and tell nobody. There is a test on that exact line.
 *
 * Disabled rather than hidden when the session is unresolved, per
 * `signOutEnabled`: the row appearing and vanishing with connectivity reads as
 * a bug. Greyed *and* captioned, because colour is never the only signal.
 */
function SignOutRow({ enabled }: { enabled: boolean }) {
  const { dispatch } = useStore();
  const [busy, setBusy] = React.useState(false);

  const leave = async () => {
    setBusy(true);
    const outcome = await attemptSignOut();
    if (outcome.ok) {
      // Only here. See above.
      dispatch({ type: 'SIGN_OUT' });
      return;
    }
    // No `finally`: on the way out this component is unmounted by the wipe, and
    // there is nothing left to set busy on.
    setBusy(false);
    Alert.alert('Still sending', unsentLine(outcome.unsent));
  };

  const confirm = () =>
    Alert.alert(
      'Sign out of this account?',
      'This device is cleared — your week, your circle and your history stay on the server. Sign back in with Apple and they come back.',
      [
        { text: 'Stay signed in', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void leave() },
      ],
    );

  return (
    <View>
      <Tap
        onPress={enabled && !busy ? confirm : undefined}
        disabled={!enabled}
        accessibilityState={{ disabled: !enabled }}
        accessibilityLabel="Sign out"
        style={{ ...row, gap: 12, ...cardBox, opacity: enabled ? 1 : 0.5 }}
      >
        <View style={fill}>
          <Bri size={15} weight={800} color={enabled ? color.ink : color.muted}>
            {busy ? 'Signing out…' : 'Sign out'}
          </Bri>
          <Sans size={12.5} lineHeight={17} color={color.muted} style={{ marginTop: 3 }}>
            {enabled
              ? 'This device is cleared. Everything stays on the server.'
              : 'Signing out needs a connection. Nothing here is lost while you wait.'}
          </Sans>
        </View>
      </Tap>
    </View>
  );
}

/** The one card box every tappable row on this page shares. */
const cardBox = {
  backgroundColor: color.card,
  borderRadius: radius.chip,
  paddingVertical: 13,
  paddingHorizontal: 14,
  minHeight: 62,
};
