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
 * Appearance (6e) is the first row on this page that is about the *phone*
 * rather than the account, along with the Monday reminder it sits above. It
 * reads and writes `useSchemePreference()`, not the store — the palette is
 * owned by a provider above `StoreProvider` and stored under a key of its own,
 * so it outlives a sign-out and a reset. Which is the point: wiping your
 * account data should not change how your phone renders.
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
import { font, gutter, onLight, radius } from '../theme/tokens';
import {
  useColors,
  useKeyboardAppearance,
  useSchemePreference,
  type Palette,
  type SchemePreference,
} from '../theme/ThemeProvider';
import { Bri, Caps, Sans, Tap, fill, row } from '../components/primitives';
import { Icon } from '../components/Icon';
import { Avatar } from '../components/Avatar';
import { Overlay } from './Overlay';
import { closeButton } from './LedgerOverlay';
import { Trouble } from '../components/Trouble';
import { useStore } from '../state/store';
import { NAME_MAX } from '../data/people';
import { commitSelfName, queueUnblock } from '../sync/engine';
import { linkApple } from '../sync/session';
import { appleTrouble } from '../lib/appleCopy';
import { clearAvatar, pickAndUploadAvatar } from '../lib/avatarUpload';
// The one line a refused photo is ever told, straight from the module the edge
// function decides with. Mirrored nowhere: two copies of a sentence about
// somebody's photograph is one copy that drifts.
import { IMAGE_BLOCKED_COPY } from '../../supabase/functions/_shared/imageVerdict.mjs';
import { reminderPermission } from '../lib/reminders';
import { enableReminders } from '../lib/enableReminders';
import { stakedPoints } from '../state/selectors';
import type { AccountMode } from '../data/seed';
import type { SessionState } from '../sync/session';
import { canSecure, secureUnavailable, signOutEnabled, signOutVisible } from './settings/guards';
import { attemptSignOut, unsentLine } from './settings/signOut';

/**
 * What this account is, in one sentence, per platform.
 *
 * Every state of the session gets its own sentence, because this is the page
 * somebody opens *because* something looks wrong. One line used to cover all
 * five non-ready states — "Signed in. Checking this account…" — which is two
 * claims, and on a build with no Supabase config both of them are false
 * forever: the session is `off`, nothing is signed in, nothing is being
 * checked, and that sentence sits there for good. It reassured in exactly the
 * situations it exists to explain.
 *
 * What each line is careful about:
 *
 *  - **`signing-in`** is the only one that may say "checking", because it is
 *    the only one where something is actually in flight.
 *  - **`off`** on a live account means this build has no server configured.
 *    That is a fact about the build, not about the person holding the phone,
 *    so it reads as a plain statement and offers nothing to tap — there is no
 *    action here that could change it.
 *  - **`offline`** must not imply loss. The session retries by itself and the
 *    outbox keeps everything, which is why `SyncBanner` deliberately stays
 *    quiet for it.
 *  - **`expired`** says the device is signed out and stops there. The way back
 *    — "Try again", "Start over" — belongs to `SyncBanner`, and a second copy
 *    of that offer under a heading would be two doors onto one action.
 *  - **`error`** never renders `session.message`. That string is banner copy,
 *    written to sit next to a retry; here it would be a raw fault under a
 *    heading with nothing to do about it.
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
  if (session.status === 'signing-in') return 'Checking this account…';
  if (session.status === 'off') {
    return 'No server is set up for this copy of Rally, so this account never signs in. Everything you do stays on this phone.';
  }
  if (session.status === 'offline') {
    return 'Signed in. No connection right now — this catches up on its own once there is one.';
  }
  if (session.status === 'expired') {
    return 'Signed out on this device. Your week is safe here, but nothing new is reaching the server.';
  }
  if (session.status === 'error') {
    return 'Signing in isn’t working on this phone, and trying again may not be enough.';
  }
  if (!session.anonymous) return 'Signed in, and this account can be got back with Apple.';
  return platform === 'ios'
    ? 'Signed in, but this account can’t be got back yet. Secure it below and you can sign back in on a new phone.'
    : 'Signed in, but this account can’t be got back — signing in with Apple is iOS-only for now. That’s also why there’s no sign-out here: there’d be no way back.';
}

export function SettingsOverlay({ topInset }: { topInset: number }) {
  const color = useColors();
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
        <Tap onPress={close} accessibilityLabel="Close settings" style={closeButton(color)}>
          <Icon name="close" size={16} color={color.textPrimary} />
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

        {live ? (
          <Section title="Your photo">
            <PhotoRow />
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

        {/* Between Blocked and Notifications, and not in the you-cluster above.
            Name and photo are identity — they are about you, they go to the
            server, and everyone in your circle sees them. This is neither: it
            is a fact about this phone, it never leaves it, and it survives
            signing out. So it sits with the other thing on this page that is
            about how the app behaves on this device rather than about the
            account, which is the Monday reminder. It also keeps the gap the
            comment above wants between Blocked and Leaving. */}
        <Section title="Appearance">
          <AppearanceRows />
        </Section>

        <Section title="Notifications">
          <RemindersRow />
        </Section>

        {/* Offered, or explained. Never silently missing — see
            `secureUnavailable`. */}
        {canSecure(account, session, Platform.OS) ||
        secureUnavailable(account, session, Platform.OS) ? (
          <Section title="Getting back in">
            <SecureRow enabled={canSecure(account, session, Platform.OS)} />
          </Section>
        ) : null}

        {signOutVisible(account, session) ? (
          <Section title="Leaving" apart>
            <SignOutRow enabled={signOutEnabled(session)} />
          </Section>
        ) : null}
      </ScrollView>
    </Overlay>
  );
}

function Section({
  title,
  apart,
  children,
}: {
  title: string;
  /**
   * Set the section off from the ones above it.
   *
   * Only "Leaving" uses it. Signing out is the one thing on this page you
   * cannot undo from this page, and it was drawn as the same card as the
   * Monday reminder — same box, same weight, same everything. There is no
   * destructive colour to reach for here and there should not be one: this app
   * has no red in it anywhere, and the confirm that actually guards the action
   * is an OS alert with its own destructive styling. So the distinction is
   * made the way the rest of Rally makes distinctions — with space, and a rule.
   */
  apart?: boolean;
  children: React.ReactNode;
}) {
  const color = useColors();
  return (
    <View style={{ marginBottom: 18, marginTop: apart ? 10 : 0 }}>
      {apart ? (
        <View style={{ height: 1, backgroundColor: color.divider, marginBottom: 18 }} />
      ) : null}
      <Caps size={11} tracking={1.4} style={{ marginHorizontal: 2, marginBottom: 9 }}>
        {title}
      </Caps>
      {children}
    </View>
  );
}

/** The read-only twin of the tappable rows: same box, no minimum height. */
function Card({ children }: { children: React.ReactNode }) {
  const color = useColors();
  return <View style={{ ...cardBox(color), minHeight: undefined }}>{children}</View>;
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
  const color = useColors();
  const keyboard = useKeyboardAppearance();
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
      keyboardAppearance={keyboard}
      selectionColor={color.lime}
      placeholder="Your name"
      placeholderTextColor={color.faintInk}
      accessibilityLabel="Your name"
      style={{
        fontFamily: font.sans[600],
        fontSize: 15,
        color: color.textPrimary,
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
 * A face, or the offer of one.
 *
 * Four states, and the interesting thing about each is what it does *not*
 * offer:
 *
 *  - **`pending`** says the photo is being checked and offers no control at
 *    all. There is nothing honest to offer — the bytes are on the server and
 *    the verdict is not this device's to give — and a "Show it anyway" here
 *    would be the one hole the rest of the feature is built to close.
 *  - **`refused`** shows `IMAGE_BLOCKED_COPY` and nothing else. It does not
 *    say what the model objected to and it does not argue: the model's own
 *    sentence is diagnostic, stays in the edge function's log, and is not
 *    available to this file even if somebody wanted to render it. Naming a
 *    category would accuse somebody over a picture of their kitchen on a false
 *    positive, and hand out a checklist on a true one.
 *  - **`ready`** offers Replace and Remove, and Replace passes the current
 *    `avatarPath` down as `previousPath`. That argument is the difference
 *    between a replaced photo being deleted and it sitting in a bucket every
 *    signed-in account can read, under a name nothing points at any more.
 *  - **`none`** just offers to add one. Initials are not an empty state to be
 *    apologised for — they are the design.
 *
 * The state is read from the directory, which is where the pull puts it, and
 * written straight back on a completed upload: the next pull is up to a minute
 * away, and for that minute this row would otherwise offer to *add* a photo
 * that exists — and hand the replace after it a `previousPath` of `undefined`.
 */
function PhotoRow() {
  const color = useColors();
  const { state, dispatch } = useStore();
  const me = state.people[state.selfId];
  const path = me?.avatarPath;
  const avatarState = me?.avatarState ?? 'none';
  const [busy, setBusy] = React.useState<'adding' | 'removing' | null>(null);
  const [trouble, setTrouble] = React.useState<string | null>(
    avatarState === 'refused' ? IMAGE_BLOCKED_COPY : null,
  );

  const choose = async () => {
    setBusy('adding');
    setTrouble(null);
    // `previousPath` — the object this profile points at *now*. Dropping it is
    // not a cosmetic bug: `set_avatar` moves the row to the new name and the
    // old object stays readable by anyone who learns it.
    const outcome = await pickAndUploadAvatar(path);
    setBusy(null);
    if (outcome.ok) {
      dispatch({ type: 'SET_AVATAR', path: outcome.path, state: 'ready' });
      return;
    }
    if (outcome.reason === 'blocked') {
      // The server has already deleted the object and written `refused`, so the
      // local copy follows it rather than going on believing there is a photo.
      dispatch({ type: 'SET_AVATAR', path: null, state: 'refused' });
      setTrouble(IMAGE_BLOCKED_COPY);
      return;
    }
    if (outcome.reason === 'no-permission') {
      setTrouble('Rally can’t see your photos. You can change that in system settings.');
      return;
    }
    // `cancelled` is somebody changing their mind, and deserves no message.
    if (outcome.reason === 'failed') setTrouble('That didn’t go through. Try again.');
  };

  const remove = async () => {
    setBusy('removing');
    setTrouble(null);
    const gone = await clearAvatar(path);
    setBusy(null);
    if (gone) dispatch({ type: 'SET_AVATAR', path: null, state: 'none' });
    // Said plainly rather than shown as removed: `clearAvatar` deletes the
    // object before it clears the row, so a half-done removal leaves a photo
    // the next pull would bring straight back.
    else setTrouble('That photo is still there. Try again.');
  };

  const checking = avatarState === 'pending';
  const has = avatarState === 'ready' && !!path;

  const line = checking
    ? 'Checking your photo… nobody sees it until that’s done — you included.'
    : has
      ? 'Everyone who can see your week can see this.'
      : 'Add one, or keep your initials. Both look fine.';

  return (
    <View>
      <View style={{ ...row, gap: 12, ...cardBox(color) }}>
        <Avatar who={state.selfId} size={40} />
        <View style={fill}>
          <Bri size={15} weight={800}>
            {busy === 'adding' ? 'Adding…' : busy === 'removing' ? 'Removing…' : 'Photo'}
          </Bri>
          <Sans size={12.5} lineHeight={17} color={color.muted} style={{ marginTop: 3 }}>
            {line}
          </Sans>
        </View>
        {/* Nothing to press while the screener has it. */}
        {checking || busy ? null : (
          <>
            <Tap
              onPress={() => void choose()}
              accessibilityLabel={has ? 'Replace your photo' : 'Add a photo'}
              style={rowAction}
            >
              <Sans size={12.5} weight={700} color={color.moss}>
                {has ? 'Replace' : 'Add'}
              </Sans>
            </Tap>
            {has ? (
              <Tap onPress={() => void remove()} accessibilityLabel="Remove your photo" style={rowAction}>
                <Sans size={12.5} weight={700} color={color.muted}>
                  Remove
                </Sans>
              </Tap>
            ) : null}
          </>
        )}
      </View>
      <Trouble message={trouble} />
    </View>
  );
}

/**
 * Light, dark, or whatever the phone is doing.
 *
 * A radio group, and built as one rather than as a toggle with a third state:
 * `accessibilityRole="radiogroup"` on the container, `"radio"` on each option,
 * and `accessibilityState={{ selected }}` so VoiceOver says which one is on.
 * Each label reads as a whole sentence on its own, because a `Tap` collapses
 * everything inside it into one element and the caption below the title never
 * reaches a screen reader otherwise — the same trap `SignOutRow` documents.
 *
 * No confirm and no Save. The tap repaints the entire tree behind this overlay
 * and writes the choice to disk in the same call, which is `setPreference`'s
 * whole job — see `theme/ThemeProvider.tsx`. Preview *is* the confirmation: you
 * can see what you picked, and picking again costs one tap.
 *
 * Offered to every account, demo included, for the reason the section comment
 * gives: this is not an account fact. It is also the reason it is not `live`-
 * gated the way name and photo are.
 *
 * What each option ticks is the *preference*, never the resolved scheme. Under
 * System on a dark phone the app is dark and the ticked row is still System,
 * because that is what was chosen; ticking Dark there would be the control
 * telling you it is set to something it is not.
 */
function AppearanceRows() {
  const color = useColors();
  const { preference, setPreference } = useSchemePreference();
  const active = APPEARANCE_OPTIONS.find((o) => o.value === preference) ?? APPEARANCE_OPTIONS[0];

  return (
    <View style={{ ...cardBox(color), minHeight: undefined }}>
      <View style={{ flexDirection: 'row', gap: 6 }} accessibilityRole="radiogroup">
        {APPEARANCE_OPTIONS.map((option) => (
          <AppearancePill
            key={option.value}
            option={option}
            selected={preference === option.value}
            onPress={() => setPreference(option.value)}
          />
        ))}
      </View>
      {/* One line, for the choice that is actually in force. The other two
          explain themselves — "Light" needs no gloss — and printing all three
          at once was three paragraphs to make the smallest decision here. */}
      <Sans size={12.5} lineHeight={17} color={color.muted} style={{ marginTop: 10 }}>
        {active.line}
      </Sans>
    </View>
  );
}

/**
 * The three, in the order they are worth reading: the default first, then the
 * two ways to overrule it.
 *
 * `line` is what the choice does, and only the selected one is drawn. "System"
 * has to say what following the system means rather than naming a setting
 * somewhere else; the two pinned options say the consequence — that the
 * phone's own switch stops moving Rally — because that is the part somebody
 * comes back confused about.
 *
 * `label` is what a screen reader hears, and it stays the full sentence: a
 * pill reading "Dark" out of context says nothing about what it will do.
 */
const APPEARANCE_OPTIONS: {
  value: SchemePreference;
  title: string;
  line: string;
  label: string;
}[] = [
  {
    value: 'system',
    title: 'System',
    line: 'Rally follows your phone. When it goes dark, this goes dark.',
    label: 'Follow the system. Rally goes dark when your phone does',
  },
  {
    value: 'light',
    title: 'Light',
    line: 'Always light, whatever your phone is set to.',
    label: 'Always light, whatever your phone is set to',
  },
  {
    value: 'dark',
    title: 'Dark',
    line: 'Always dark, whatever your phone is set to.',
    label: 'Always dark, whatever your phone is set to',
  },
];

/**
 * One option, as a pill.
 *
 * The same shape the audience chips use in Plan and on a feed card — this app
 * already has an idiom for "pick exactly one of a few", and a settings page is
 * not the place to invent a second one. Lime for the chosen one, `chip` for the
 * rest, which is how a selected chip reads everywhere else in Rally.
 *
 * Colour is not the only signal: the chosen pill is also the only one at weight
 * 700 on a filled ground, and its label is the only one a screen reader reports
 * as selected.
 */
function AppearancePill({
  option,
  selected,
  onPress,
}: {
  option: (typeof APPEARANCE_OPTIONS)[number];
  selected: boolean;
  onPress: () => void;
}) {
  const color = useColors();

  return (
    <Tap
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={option.label}
      style={{
        flex: 1,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 9,
        minHeight: 38,
        alignItems: 'center',
        justifyContent: 'center',
        // The border is not decoration. `chip` on `card` is a couple of
        // percent of lightness in the light palette — enough on `paper`, where
        // chips usually sit, and almost nothing inside a white card, which is
        // where these are. Without it the two unpicked options read as labels
        // rather than as things you can press. Same pairing the audience chips
        // use in Plan: a fill, and an edge when not chosen.
        borderWidth: 1,
        borderColor: selected ? 'transparent' : color.divider,
        backgroundColor: selected ? color.lime : color.chip,
      }}
    >
      <Sans size={12.5} weight={700} color={selected ? onLight : color.muted}>
        {option.title}
      </Sans>
    </Tap>
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
  const color = useColors();
  const { state } = useStore();

  // No card when there is nobody. A card is a promise that something is in it,
  // and an empty one saying "Nobody" carries the same weight on this page as
  // Sign out does — which is how a page of seven settings stops being
  // scannable. The line still says where a block would appear, because the
  // whole argument for this section is that a block you cannot find is a block
  // you cannot lift.
  if (!state.blocked.length) {
    return (
      <Sans size={12.5} lineHeight={17.5} color={color.muted} style={{ marginHorizontal: 2 }}>
        Nobody yet. Anyone you block shows up here, and this is where you take it
        back.
      </Sans>
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
  const color = useColors();
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
    <View style={{ ...row, gap: 12, ...cardBox(color) }}>
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
  const color = useColors();
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
      style={{ ...row, gap: 12, ...cardBox(color) }}
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
 *
 * Disabled rather than absent when the session has not resolved, the way
 * `SignOutRow` already is and for the same reason — `secureUnavailable` carries
 * the argument. Greyed *and* captioned, because colour is never the only
 * signal, and the caption is the only place the page says why the one row
 * somebody came here for is not tappable.
 */
function SecureRow({ enabled }: { enabled: boolean }) {
  const color = useColors();
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
        onPress={enabled && !busy ? () => void secure() : undefined}
        disabled={!enabled}
        // Same trap as `SignOutRow`: a `Tap`'s `accessibilityLabel` collapses
        // everything inside it, so the caption below never reaches VoiceOver
        // and the reason has to travel in the label or not at all.
        accessibilityState={{ disabled: !enabled, busy }}
        accessibilityLabel={
          enabled
            ? 'Secure this account with Apple, so you can sign back in'
            : 'Secure this account. Securing needs a connection'
        }
        style={{ ...row, gap: 12, ...cardBox(color), opacity: enabled ? 1 : 0.5 }}
      >
        <View style={fill}>
          <Bri size={15} weight={800} color={enabled ? color.textPrimary : color.muted}>
            {busy ? 'Securing…' : 'Secure this account'}
          </Bri>
          <Sans size={12.5} lineHeight={17} color={color.muted} style={{ marginTop: 3 }}>
            {enabled
              ? 'Continue with Apple, and this account comes back on a new phone.'
              : 'Securing this account needs a connection. It’s still here when you get one.'}
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
  const color = useColors();
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
        style={{ ...row, gap: 12, ...cardBox(color), opacity: enabled ? 1 : 0.5 }}
      >
        <View style={fill}>
          <Bri size={15} weight={800} color={enabled ? color.textPrimary : color.muted}>
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

/**
 * The one card box every tappable row on this page shares.
 *
 * A function of the palette, not an object — the shape settled in
 * `theme/ThemeProvider.tsx`. As a plain object it captured `color.card` at
 * import and would have frozen whichever palette was active then, invisibly,
 * until the first live theme toggle. Six call sites across five components is
 * exactly the case a factory beats moving the object into a component.
 */
const cardBox = (color: Palette) => ({
  backgroundColor: color.card,
  borderRadius: radius.chip,
  paddingVertical: 13,
  paddingHorizontal: 14,
  minHeight: 62,
});
