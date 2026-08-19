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
 * `zIndex` 59. The ladder is Plan 45, Sheet 50, Ledger 55, Notifications 58,
 * **this**, Rollover 60, Onboard 70. Above Notifications, because the bell is
 * reachable from the same chrome and this is the more specific place to be.
 * Below Rollover and Onboard, because both of those are answers the app is
 * waiting on — a week that has already turned, and a flow that owns the screen
 * — and neither should ever find something sitting on top of it.
 *
 * As it happens `ROLLOVER_DETECTED` closes this page on its way up: it returns
 * `{ ...state, ...CLEARED }` and `CLEARED` includes `settingsOpen: false`. So
 * the two cannot currently be on screen together at all, and the ordering is
 * belt to that braces rather than the thing keeping them apart. Worth saying
 * plainly, because an earlier draft of this comment claimed the opposite and a
 * comment the reducer contradicts is worse than none.
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
import { commitSelfName, queueUnblock } from '../sync/engine';
import { linkApple } from '../sync/session';
import { appleTrouble } from '../lib/appleCopy';
import { reminderPermission } from '../lib/reminders';
import { enableReminders } from '../lib/enableReminders';
import { stakedPoints } from '../state/selectors';
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
  const { state, dispatch } = useStore();
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
        // The name field sits above every tappable row here, so without this the
        // first tap on any of them is eaten dismissing the keyboard and the
        // whole page needs two taps per control while a name is being edited.
        // Nothing is lost either way — blur commits — but it reads as lag.
        keyboardShouldPersistTaps="handled"
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
            {/* The stored name, not `people.name()`. That lookup is total and
                answers "Someone" for an id it has never seen — which is every
                live account until the first pull lands — and this field would
                then commit that invention as your actual name the moment it
                lost focus. Empty is the honest value; the placeholder says so. */}
            <NameField current={state.people[state.selfId]?.name ?? ''} />
          </Section>
        ) : null}

        {/* Deliberately not last. Settings keeps its destructive controls apart
            — that is why "Reset app data" is not on this page at all — and an
            Unblock sitting directly above Sign out would read as a pair of
            leaving controls. Notifications, and usually Getting back in, stand
            between them. */}
        <Section title="Blocked">
          <BlockedList />
        </Section>

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

/** The read-only twin of the tappable rows: same box, no minimum height. */
function Card({ children }: { children: React.ReactNode }) {
  return <View style={{ ...cardBox, minHeight: undefined }}>{children}</View>;
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
  // Seeded once, on purpose: re-syncing to `current` mid-edit would yank the
  // field out from under somebody typing. The narrow cost, recorded rather than
  // guessed at: if a `SERVER_MERGE` lands a name from another device while this
  // page is open, a focus-and-blur here queues the older one straight back. It
  // needs both devices and an open overlay, and the fix — resync only while
  // unfocused — is more machinery than the window is worth today.
  const [draft, setDraft] = React.useState(current);

  // Both halves, from `sync/engine`, so this door and the Me card cannot drift
  // apart. It no-ops on an empty or unchanged name, which is what makes a field
  // that commits on blur cost nothing to walk past.
  const commit = () => commitSelfName(dispatch, draft, current);

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
      placeholder="Your name"
      placeholderTextColor={color.faintInk}
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
 * Everyone this account has blocked, and the way to take it back.
 *
 * The migration's own argument for this section: a block you cannot find is a
 * block you cannot lift. Blocking happens on the person sheet, behind a
 * confirm, and until this list existed there was no second place it appeared —
 * so a block taken in a bad moment was permanent by accident. The schema was
 * shaped for this, too: `private.i_blocked` is what lets the blocker still read
 * a blocked person's profile row, which is the only reason this list can show
 * names rather than uuids.
 *
 * Present for every account, including the demo, because the demo can block.
 */
function BlockedList() {
  const { state } = useStore();

  if (!state.blocked.length) {
    return (
      <Card>
        <Sans size={12.5} lineHeight={17.5} color={color.muted}>
          Nobody. If you ever block someone, they show up here — this is where
          you take it back.
        </Sans>
      </Card>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      {state.blocked.map((id) => (
        <BlockedRow key={id} id={id} />
      ))}
    </View>
  );
}

/**
 * One blocked person, named honestly or not named at all.
 *
 * `state.people`, not `people.name()`. The lookup is total and answers
 * "Someone" for an id it has never seen — and on a live account that is every
 * id until a pull lands, so a list of blocks taken before the directory filled
 * in would be a column of identical "Someone"s with no way to tell which
 * unblock is which. The same invention has already reached the server once
 * from this codebase, through the name field two sections up. Where there is
 * no name, this says so and shows enough of the uuid to tell two rows apart —
 * the way the account row above does.
 */
function BlockedRow({ id }: { id: string }) {
  const { state, dispatch } = useStore();
  const name = state.people[id]?.name?.trim();
  const shown = name || `Account ${id.slice(0, 8)}`;

  const lift = () => {
    dispatch({ type: 'UNBLOCK', id });
    // Both halves in the same tick, per `queueUnblock`: the local list is what
    // you see, and the queue is what makes it true on the next device.
    queueUnblock(id);
  };

  return (
    <View style={{ ...row, gap: 12, ...cardBox }}>
      <View style={fill}>
        <Bri size={15} weight={800}>
          {shown}
        </Bri>
        <Sans size={12.5} lineHeight={17} color={color.muted} style={{ marginTop: 3 }}>
          {name
            ? 'You don’t see each other. Your circle’s numbers are unchanged.'
            : 'Blocked before their name reached this phone.'}
        </Sans>
      </View>
      <Tap onPress={lift} accessibilityLabel={`Unblock ${shown}`} style={rowAction}>
        <Sans size={12.5} weight={700} color={color.moss}>
          Unblock
        </Sans>
      </Tap>
    </View>
  );
}

/**
 * The Monday reminder, from the one screen you can reach again.
 *
 * Onboarding asks once and never comes back, so somebody who tapped past it had
 * no way to change their mind. Three states, not two, which is the point of
 * `reminderPermission` returning a word rather than a boolean: *undetermined*
 * can still be asked, and *denied* cannot — iOS answers every later request
 * from the stored refusal without showing anything, so a "Turn on" that asks
 * again resolves denied, writes the same state back, and leaves the row exactly
 * where it was. A dead button. Denied goes to the OS settings app, which is the
 * only place the answer can still change.
 */
function RemindersRow() {
  const { state } = useStore();
  // Null until the OS answers. Rendering "Off" in the meantime would be a guess
  // the user could act on, so the row says nothing it does not know yet.
  const [perm, setPerm] = React.useState<'granted' | 'denied' | 'undetermined' | null>(null);

  React.useEffect(() => {
    let alive = true;
    void reminderPermission().then((answer) => {
      if (alive) setPerm(answer);
    });
    return () => {
      alive = false;
    };
  }, []);

  const press = () => {
    // Everything except the one state the prompt can still move goes to the OS,
    // including `granted` — that is where somebody turns it back off.
    if (perm !== 'undetermined') return void Linking.openSettings();
    // Not just `askForReminders`: granting has two consequences and the row
    // claims both of them. Turning the permission on and scheduling nothing
    // would leave "On. Monday morning, with what you staked." sitting above no
    // reminder at all until the week number or the staked total next changed.
    void enableReminders(state.week.number, stakedPoints(state)).then(setPerm);
  };

  const status =
    perm === null
      ? 'Checking…'
      : perm === 'granted'
        ? 'On. Monday morning, with what you staked.'
        : perm === 'denied'
          ? 'Off. You said no once, so this one is settled in Settings now.'
          : 'Off. One nudge a week, when the week opens.';

  const label =
    perm === null
      ? 'Monday reminder. Checking'
      : perm === 'granted'
        ? 'Monday reminder is on. Change it in system settings'
        : perm === 'denied'
          ? 'Monday reminder is off. Turn it on in system settings'
          : 'Turn on the Monday reminder';

  return (
    <Tap
      onPress={perm === null ? undefined : press}
      disabled={perm === null}
      accessibilityState={{ disabled: perm === null }}
      accessibilityLabel={label}
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
      {perm === null ? null : (
        <Sans size={12.5} weight={700} color={color.moss}>
          {perm === 'undetermined' ? 'Turn on' : 'Settings'}
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
        // The caption below explains the dimming, and a screen reader never
        // reaches it: `accessibilityLabel` on a `Tap` collapses everything
        // inside into one element. So the reason travels in the label, or
        // VoiceOver reads "Sign out, dimmed" and stops there. `busy` is in the
        // state for the same reason `onPress` is gated on it.
        accessibilityState={{ disabled: !enabled, busy }}
        accessibilityLabel={enabled ? 'Sign out' : 'Sign out. Signing out needs a connection'}
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

/** The trailing text action on a row — 44px through `Tap`'s hitSlop. */
const rowAction = {
  minHeight: 36,
  paddingHorizontal: 8,
  paddingVertical: 9,
  justifyContent: 'center' as const,
};

/** The one card box every tappable row on this page shares. */
const cardBox = {
  backgroundColor: color.card,
  borderRadius: radius.chip,
  paddingVertical: 13,
  paddingHorizontal: 14,
  minHeight: 62,
};
