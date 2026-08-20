/**
 * Me — profile, points, streak, year grid, exchange, owed, bests, past weeks.
 */
import React from 'react';
import { Alert, Platform, TextInput, View } from 'react-native';
import { onDark, radius, shadows, useDisplayLeading, yearLevelColor } from '../theme/tokens';
import { useColors } from '../theme/ThemeProvider';
import { CIRCLE_NAME, ME, weekPointsLabel } from '../data/fixtures';
import { NAME_MAX, type PersonId } from '../data/people';
import { commitSelfName } from '../sync/engine';
import { linkApple } from '../sync/session';
import { appleTrouble } from '../lib/appleCopy';
import { Trouble } from '../components/Trouble';
import { deadLetters } from '../sync/outbox';
import { nextWeekAfter, useStore } from '../state/store';
import { canSecure } from '../overlays/settings/guards';
import { allTasksDone, cheersGiven, circleMembers, myRank, weekPoints } from '../state/selectors';
import { Avatar } from '../components/Avatar';
import { Bri, Caps, GlowBloom, Sans, Tap, fill, row } from '../components/primitives';

export function MeScreen() {
  const color = useColors();
  const { state, dispatch, demo, people, config } = useStore();
  // Up here rather than inline on the `<Bri>` below because it is a hook, and
  // hooks are read in the same order every render.
  const pointsLeading = useDisplayLeading(48, 41);
  const { profile, week, history, yearLevels } = state;
  const live = state.account === 'live';

  /**
   * Read from the directory, not from `ME`. The fixture is the demo's identity
   * and stays that — but this card used to render it on every account, so a
   * live user saw "Alex Rivera" no matter who they were or what they had typed.
   */
  const myName = live ? people.name(state.selfId) : ME.name;
  /**
   * What the *editor* starts from, which is not what the card displays.
   * `people.name()` is total and answers "Someone" for an id it has never seen
   * — every live account until its first pull lands — and that is a fine thing
   * to render and a terrible thing to put in a text field: tap the name, tap
   * away, and the placeholder is filed as your actual name and queued to the
   * server. Empty is the honest starting point.
   */
  const storedName = live ? (state.people[state.selfId]?.name ?? '') : ME.name;
  /**
   * `myName` falls back to "Someone" — right for a stranger's row, wrong for
   * your own: the app knows exactly who this is, it just doesn't have a name
   * for them yet. Uncommon rather than routine — onboarding requires a name
   * before Continue unlocks, so this only shows up before a live account's
   * first pull lands, on a profile row the server never wrote, or via the
   * dev-only "Go live" path.
   */
  const nameMissing = live && !storedName;
  /**
   * Demo: the fixture handle, and its circle once there is one. Live: the
   * circle's real name, or nothing. No handle — a live one is `anon_6e8dd5641ace`,
   * which is machine noise rather than an identity worth showing.
   */
  const subtitle = live
    ? (state.circle?.name ?? '')
    : circleMembers(state).length > 1
      ? `${ME.handle} · ${CIRCLE_NAME}`
      : ME.handle;

  const [renaming, setRenaming] = React.useState(false);
  const [draftName, setDraftName] = React.useState('');
  const startRename = () => {
    setDraftName(storedName);
    setRenaming(true);
  };
  // Blur and submit both land here, so tapping away commits rather than
  // silently discarding what was typed. `commitSelfName` owns both halves — the
  // dispatch and the queue — and no-ops on an empty or unchanged name, which is
  // what makes opening the editor and closing it again a no-op.
  const commitRename = () => {
    if (!renaming) return;
    setRenaming(false);
    commitSelfName(dispatch, draftName, storedName);
  };
  /**
   * Whether this account can be got back, and the one line shown when securing
   * it did not work.
   *
   * `anonymous` is read off the session rather than kept in the store, because
   * gotrue is the only thing that knows — a copy here would be a second answer
   * to a question that already has one, and the two would disagree the moment a
   * link succeeded. iOS only: on Android there is no provider to reach, so the
   * row would be an offer the app cannot keep.
   */
  const canSecureAccount = canSecure(state.account, state.session, Platform.OS);
  const [securing, setSecuring] = React.useState(false);
  const [secureTrouble, setSecureTrouble] = React.useState<string | null>(null);

  const secureAccount = async () => {
    setSecuring(true);
    setSecureTrouble(null);
    try {
      const result = await linkApple();
      // A dismissed sheet is not a failure and says nothing. Everything else
      // gets the one line `appleCopy` owns.
      if (!result.ok && result.reason !== 'cancelled') {
        setSecureTrouble(appleTrouble(result.reason));
      }
      // Nothing to do on success: `linkApple` re-reads the session, the store
      // folds it in, and `canSecure` turns false — the row removing itself is
      // the confirmation.
    } finally {
      setSecuring(false);
    }
  };

  // Null unless there is a circle to be ranked in and ranking is switched on.
  const rank = config.showRank && circleMembers(state).length > 1 ? myRank(state) : 0;

  const won = allTasksDone(state);
  const gave = cheersGiven(state);
  const got = profile.cheersReceived;
  const exchangeTotal = gave + got || 1;
  /**
   * People waiting on a word from you.
   *
   * The demo's is written furniture, and stays that. A live account's is
   * derived from the one thing on the device that genuinely means somebody is
   * waiting: a note *they* left on *your* task, with nothing said back. Until
   * now this section was demo-only, so a live account never saw it however
   * many notes it had — which made an entire screen section fixture-shaped.
   *
   * Deliberately not driven by cheers. A cheer is a gift, not a question, and
   * the handoff is explicit that the debt framing appears at most once per
   * screen — putting it behind every cheer would make it the loudest thing on
   * Me.
   */
  const owed = React.useMemo(() => {
    if (demo.owed.length) return demo.owed.filter((o) => !state.replied[o.k]);
    const seen = new Map<PersonId, string>();
    for (const task of state.myTasks) {
      for (const note of task.cmts) {
        if (!note.k || note.k === state.selfId || state.replied[note.k]) continue;
        // The most recent note wins the line, which is the one they are
        // waiting on an answer to.
        seen.set(note.k, `said something on “${task.title}”`);
      }
    }
    return [...seen].map(([k, reason]) => ({ k, reason }));
  }, [demo.owed, state.myTasks, state.replied, state.selfId]);
  // A closed week extends the streak; the bar shows where you'd land.
  const streak = won ? profile.currentStreak + 1 : profile.currentStreak;
  const toHold = Math.max(0, state.myTasks.filter((t) => !t.done).length);

  return (
    <View>
      {/* 1 · profile */}
      <View
        style={{
          backgroundColor: color.ink,
          borderRadius: radius.largeCard,
          paddingTop: 20,
          paddingBottom: 18,
          paddingHorizontal: 18,
          marginBottom: 16,
          overflow: 'hidden',
        }}
      >
        <GlowBloom size={260} top={-100} right={-80} opacity={0.22} />

        <View style={[row, { gap: 13 }]}>
          <View style={{ width: 60, height: 60 }}>
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                borderRadius: 30,
                borderWidth: 2.5,
                borderColor: color.lime,
              }}
            />
            <Avatar
              who={state.selfId}
              size={50}
              label={myName}
              style={{ position: 'absolute', top: 5, left: 5 }}
            />
          </View>
          <View style={fill}>
            {renaming ? (
              <TextInput
                value={draftName}
                onChangeText={setDraftName}
                onSubmitEditing={commitRename}
                onBlur={commitRename}
                autoFocus
                placeholder="Your name"
                placeholderTextColor={onDark.tertiary}
                maxLength={NAME_MAX}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                selectionColor={color.lime}
                accessibilityLabel="Your name"
                style={{
                  fontFamily: 'BricolageGrotesque_800ExtraBold',
                  fontSize: 22,
                  letterSpacing: -0.5,
                  color: color.paper,
                  paddingVertical: 0,
                }}
              />
            ) : (
              <Tap
                onPress={live ? startRename : undefined}
                accessibilityLabel={
                  live
                    ? nameMissing
                      ? 'Add your name'
                      : `${myName}. Change your name.`
                    : undefined
                }
                style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}
              >
                <Bri
                  size={22}
                  weight={800}
                  tracking={-0.5}
                  color={nameMissing ? onDark.tertiary : color.paper}
                >
                  {nameMissing ? 'Add your name' : myName}
                </Bri>
              </Tap>
            )}
            <Sans size={12} color={onDark.secondary} style={{ marginTop: 2 }}>
              {subtitle}
            </Sans>
            {canSecureAccount ? (
              // The one action that decides whether this account survives a
              // reinstall was a 9.5px label in a ~16px target — the smallest
              // in the app. It gets a real one, and a size to match.
              <Tap
                onPress={securing ? undefined : () => void secureAccount()}
                accessibilityLabel="Secure this account with Apple, so you can sign back in"
                style={{
                  alignSelf: 'flex-start',
                  marginTop: 4,
                  paddingVertical: 10,
                  paddingRight: 12,
                  minHeight: 44,
                  justifyContent: 'center',
                }}
              >
                <Sans size={12.5} weight={700} color={color.lime}>
                  {securing ? 'Securing…' : 'Secure this account'}
                </Sans>
              </Tap>
            ) : null}
          </View>
          {/* The spec's rank chip, which routes to the Circle it names. It
              only says a rank when there is a circle to be ranked in and
              `showRank` is on — a "#1" over a circle of one is a standing
              nobody earned, so that case keeps the weeks-in reading. */}
          <Tap
            onPress={() => dispatch({ type: 'SET_TAB', tab: 'circle' })}
            accessibilityLabel={
              rank ? `Ranked ${rank} in your circle. Open it.` : `${profile.weeksIn} weeks in. Open your circle.`
            }
            style={{ alignItems: 'flex-end', padding: 2, minHeight: 44, justifyContent: 'center' }}
          >
            <Bri size={19} weight={800} color={color.lime}>
              {rank ? `#${rank}` : profile.weeksIn}
            </Bri>
            <Caps size={10} tracking={1.2} color={onDark.secondary}>
              {rank ? 'In the circle' : 'Weeks in'}
            </Caps>
          </Tap>
        </View>

        {/* Under the control that failed, which is `Trouble`'s whole remit — the
            light chip reads against the card's ink the same way it reads against
            paper elsewhere, so this needs no dark variant. */}
        <Trouble message={secureTrouble} />

        {/* 2 · points */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 11, marginTop: 22 }}>
          <Bri
            size={48}
            weight={800}
            tracking={-2.2}
            color={color.paper}
            style={pointsLeading}
          >
            {profile.allTimePoints.toLocaleString()}
          </Bri>
          <View style={{ paddingBottom: 4 }}>
            <Caps size={10} tracking={1.5} color={onDark.secondary} style={{ lineHeight: 13 }}>
              {'Points\nAll time'}
            </Caps>
          </View>
          <View style={{ marginLeft: 'auto', paddingBottom: 4, alignItems: 'flex-end' }}>
            <Bri size={17} weight={800} color={color.lime}>
              {weekPoints(state)}
            </Bri>
            <Caps size={10} tracking={1.2} color={onDark.secondary}>
              {`Week ${week.number} so far`}
            </Caps>
          </View>
        </View>

        {/* 3 · streak */}
        <Tap
          onPress={() => dispatch({ type: 'GO_PLACE', patch: { tab: 'week', scope: 'personal' } })}
          accessibilityLabel="Your streak. Open your week."
          style={{ marginTop: 20 }}
        >
          <View style={[row, { gap: 5 }]}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 7,
                  borderRadius: 999,
                  backgroundColor: i < streak ? color.lime : onDark.fillBold,
                }}
              />
            ))}
          </View>
          <View style={[row, { justifyContent: 'space-between', gap: 10, marginTop: 10 }]}>
            <Sans size={12.5} color={onDark.bodySecondary}>
              {streakLine(streak, won, toHold)}
            </Sans>
            {profile.longestStreak ? (
              <Sans size={11} weight={700} color={color.lime}>
                {profile.longestStreak}w record
              </Sans>
            ) : null}
          </View>
        </Tap>
      </View>

      {/* 4 · year grid — one cell per week since joining, not a fixed 52 */}
      <View style={{ marginBottom: 18 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 10,
            marginHorizontal: 2,
            marginBottom: 10,
          }}
        >
          <Caps size={10.5} tracking={1.7}>
            Every week since you joined
          </Caps>
          <Sans size={11} weight={700} color={color.moss}>
            {yearLevels.length
              ? `${yearLevels.filter((v) => v >= 2).length} of ${yearLevels.length} finished`
              : 'Starts here'}
          </Sans>
        </View>
        <YearGrid levels={yearLevels} />
      </View>

      {/* 5 · exchange */}
      <View
        style={[
          { backgroundColor: color.card, borderRadius: 22, padding: 16, marginBottom: 18 },
          shadows.card,
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
          <View style={{ flex: 1, alignItems: 'flex-end', paddingRight: 12 }}>
            <Bri size={30} weight={800} lineHeight={30}>
              {gave}
            </Bri>
            <Caps size={10} tracking={1.4} style={{ marginTop: 2 }}>
              You gave
            </Caps>
          </View>
          <View style={{ width: 1, height: 48, backgroundColor: color.divider }} />
          <View style={{ flex: 1, paddingLeft: 12 }}>
            <Bri size={30} weight={800} lineHeight={30} color={color.moss}>
              {got}
            </Bri>
            <Caps size={10} tracking={1.4} style={{ marginTop: 2 }}>
              You got
            </Caps>
          </View>
        </View>

        <View
          style={{
            flexDirection: 'row',
            height: 10,
            borderRadius: 999,
            overflow: 'hidden',
            marginTop: 13,
            backgroundColor: color.exchangeTrack,
          }}
        >
          <View style={{ width: `${Math.round((gave / exchangeTotal) * 100)}%`, backgroundColor: color.ink }} />
          <View style={{ width: `${Math.round((got / exchangeTotal) * 100)}%`, backgroundColor: color.lime }} />
        </View>

        <Sans size={12} lineHeight={17} color={color.muted} style={{ marginTop: 8 }}>
          {!gave && !got
            ? 'Nothing exchanged yet. A cheer is one tap.'
            : gave >= got
              ? 'You give more than you get. That is a good problem.'
              : `${got - gave} ${got - gave === 1 ? 'cheer' : 'cheers'} behind. ` +
                'Nobody is counting except this bar.'}
        </Sans>
        <Sans size={11} color={color.muted} style={{ marginTop: 4, opacity: 0.8 }}>
          {/* The handoff's line, restored. It was softened to "shows up in
              their week" when there was no push and a cheer that claimed to
              buzz someone was a promise the build could not keep. There is
              one now — `push_notification()` fires on the notification row,
              the `push` function delivers it, and the device registers its
              token through the outbox — so the promise is the app's again.
              It holds for anyone who allowed notifications; for anyone who
              didn't, the cheer still lands where the second half says. */}
          Every cheer lands on their phone, with your name on it.
        </Sans>
      </View>

      {/* 6 · owed — hidden when empty. Debt framing appears at most once here. */}
      {owed.length ? (
        <View style={{ marginBottom: 16 }}>
          <Caps size={10.5} tracking={1.7} style={{ marginHorizontal: 2, marginBottom: 10 }}>
            You owe a word to
          </Caps>
          <View style={{ gap: 8 }}>
            {owed.map((o) => (
              <View
                key={o.k}
                style={{
                  ...row,
                  gap: 11,
                  backgroundColor: color.card,
                  borderRadius: radius.row,
                  paddingVertical: 12,
                  paddingHorizontal: 13,
                }}
              >
                <Avatar who={o.k} size={36} />
                <View style={fill}>
                  <Sans size={14} weight={600}>
                    {people.name(o.k)}
                  </Sans>
                  <Sans size={11.5} color={color.muted}>
                    {o.reason}
                  </Sans>
                </View>
                <Tap
                  onPress={() => {
                    dispatch({ type: 'REPLY', key: o.k });
                    dispatch({ type: 'OPEN_SHEET', sheet: { type: 'person', id: o.k } });
                  }}
                  accessibilityLabel={`Say something to ${people.name(o.k)}`}
                  style={{
                    borderRadius: 999,
                    paddingHorizontal: 13,
                    paddingVertical: 8,
                    minHeight: 36,
                    justifyContent: 'center',
                    backgroundColor: color.lime,
                  }}
                >
                  <Bri size={12} weight={800} color={color.ink}>
                    Say something
                  </Bri>
                </Tap>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* 7 · personal bests */}
      <Caps size={10.5} tracking={1.7} style={{ marginHorizontal: 2, marginBottom: 10 }}>
        Personal bests
      </Caps>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        <BestTile
          value={profile.bestWeekPoints ? String(profile.bestWeekPoints) : '—'}
          label={profile.bestWeekPoints ? `Best week · ${profile.bestWeekLabel}` : 'Best week'}
        />
        <BestTile value={profile.longestStreak ? `${profile.longestStreak}w` : '—'} label="Longest streak" />
        <BestTile value={profile.mostTasksClosed ? String(profile.mostTasksClosed) : '—'} label="Most tasks closed" />
        <BestTile value={profile.perfectWeeks ? String(profile.perfectWeeks) : '—'} label="Perfect weeks" />
      </View>

      {/* 8 · past weeks — each opens its own ledger with that week's data */}
      <Caps size={10.5} tracking={1.7} style={{ marginHorizontal: 2, marginBottom: 10 }}>
        Past weeks
      </Caps>
      <View style={{ gap: 8, marginBottom: 16 }}>
        {history.length === 0 ? (
          <Sans size={13} lineHeight={18} color={color.muted} style={{ paddingHorizontal: 2 }}>
            This is your first week. There’s nothing behind you yet — that’s the point.
          </Sans>
        ) : null}
        {history.map((w) => {
          return (
            <Tap
              key={w.n}
              onPress={() => dispatch({ type: 'OPEN_WRAP', week: w.n })}
              accessibilityLabel={`${w.label}, ${w.sub}, ${weekPointsLabel(w)}`}
              style={{
                ...row,
                gap: 11,
                borderRadius: radius.row,
                paddingVertical: 13,
                paddingHorizontal: 14,
                backgroundColor: w.quiet ? 'transparent' : color.card,
                borderWidth: 1,
                borderColor: w.quiet ? color.dash : 'transparent',
                borderStyle: w.quiet ? 'dashed' : 'solid',
              }}
            >
              <View style={fill}>
                <Sans size={14.5} weight={600} color={w.quiet ? color.faintInk : color.ink}>
                  {w.label}
                </Sans>
                <Sans size={11.5} color={color.muted}>
                  {w.sub}
                </Sans>
              </View>
              <Bri size={14} weight={700} color={w.quiet ? color.faintInk : color.ink}>
                {weekPointsLabel(w)}
              </Bri>
            </Tap>
          );
        })}
      </View>

      {/* 9 · this week's ledger */}
      <Tap
        onPress={() => dispatch({ type: 'OPEN_WRAP', week: null })}
        style={{
          backgroundColor: color.chip,
          borderRadius: radius.chip,
          minHeight: 50,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Bri size={15} weight={800} color={color.ink}>
          See this week’s ledger
        </Bri>
      </Tap>

      {/*
        Not dev-gated, unlike everything below it. This is the only route a
        live account has to its own identity, to Apple linking, and to signing
        out — before it existed, those were spread across a card, a banner that
        only appears on failure, and an onboarding screen you cannot get back to.
      */}
      <Tap
        onPress={() => dispatch({ type: 'OPEN_SETTINGS' })}
        accessibilityLabel="Settings"
        style={{
          minHeight: 50,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 10,
        }}
      >
        <Sans size={13} weight={600} color={color.muted}>
          Settings
        </Sans>
      </Tap>

      {/*
        Development only. "Go live" signs in anonymously, so shipping it would
        put unbounded account creation one tap from every user's profile screen
        — and it exists solely because the designed way into live mode has not
        been built yet.
      */}
      {__DEV__ ? <DevControls /> : null}
      {__DEV__ ? <DeadLetters /> : null}
    </View>
  );
}

/**
 * What the queue gave up on.
 *
 * An entry lands in the dead list when the server refuses it in a way no retry
 * can fix — a check constraint, an enum it does not recognise, a row the
 * mappers could not build. The reducer is deliberately never rolled back for
 * one: deleting the task a person is looking at because the server disliked it
 * would be worse than the divergence. So the divergence is real, and permanent,
 * and until now completely silent — `deadLetters()` has been exported since it
 * was written, commented "kept so a debug screen can say what went wrong", with
 * no debug screen and no other caller anywhere in the app.
 *
 * `__DEV__` only, and that is a judgement rather than laziness. A permanently
 * refused write means this client sent something the schema rejects, which is a
 * bug here and not anything the person holding the phone can act on; telling
 * them their task never saved while offering no way to save it would be anxiety
 * without a remedy. Whether they should be told anyway is a real product
 * question, and it is raised in the PR rather than answered at this hour.
 *
 * Reads module state, so it shows the list as of the last render rather than
 * subscribing to it. For this audience that is the right amount of machinery.
 */
function DeadLetters() {
  const color = useColors();
  const dead = deadLetters();
  if (dead.length === 0) return null;

  return (
    <View style={{ marginTop: 14, gap: 4 }}>
      <Caps size={10} color={color.faintInk}>
        {`Never sent · ${dead.length}`}
      </Caps>
      {dead.map((entry) => (
        <Sans key={entry.id} size={11} weight={500} color={color.faintInk}>
          {`${entry.op} ${entry.key} — ${entry.lastError ?? 'refused'}`}
        </Sans>
      ))}
    </View>
  );
}

/**
 * The escape hatch. State survives relaunches now, so there has to be a way
 * back — and it doubles as the way to see the empty first-run account without
 * reinstalling.
 */
function DevControls() {
  const color = useColors();
  const { state, dispatch } = useStore();

  const confirm = () =>
    Alert.alert(
      'Reset app data',
      'This clears everything you’ve done and starts over.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Fresh start',
          style: 'destructive',
          onPress: () => dispatch({ type: 'RESET', mode: 'fresh' }),
        },
        {
          text: 'Reload demo',
          onPress: () => dispatch({ type: 'RESET', mode: 'seeded' }),
        },
      ],
      { cancelable: true },
    );

  /**
   * Onboarding's "Get started" is the designed way in; this is the way back in
   * once you've already chosen a demo, which is the state a device spends most
   * of its testing life in. It sits next to the other explicit testing
   * affordances rather than behind a gesture nobody would find by accident.
   */
  const goLive = () =>
    Alert.alert(
      'Switch to live mode',
      'Signs in anonymously and starts syncing to the server. This clears the demo data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Go live',
          style: 'destructive',
          onPress: () => dispatch({ type: 'RESET', mode: 'live' }),
        },
      ],
      { cancelable: true },
    );

  return (
    <View style={[row, { justifyContent: 'center', gap: 18, marginTop: 14 }]}>
      <Tap
        onPress={confirm}
        accessibilityLabel="Reset app data"
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Sans size={12} weight={600} color={color.faintInk}>
          Reset app data
        </Sans>
      </Tap>
      {/* Rollover is otherwise untestable without waiting until Monday. */}
      <Tap
        onPress={() => dispatch({ type: 'ROLLOVER_DETECTED', to: nextWeekAfter(state.week) })}
        accessibilityLabel="Simulate next week"
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Sans size={12} weight={600} color={color.faintInk}>
          Simulate next week
        </Sans>
      </Tap>
      <Tap
        onPress={goLive}
        accessibilityLabel="Switch to live mode"
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Sans size={12} weight={600} color={color.faintInk}>
          {state.account === 'live' ? 'Live' : 'Go live'}
        </Sans>
      </Tap>
    </View>
  );
}

/** The streak caption. Zero needs its own line — "0 weeks" reads as a scold. */
function streakLine(streak: number, won: boolean, open: number) {
  if (won) return `🔥 ${streak} week${streak === 1 ? '' : 's'} — held. Nothing left to close.`;
  if (!streak) return 'No streak yet. Close a week and it starts.';
  return `🔥 ${streak} week${streak === 1 ? '' : 's'} — close ${open} to hold it`;
}

const GRID_COLUMNS = 13;
const GRID_GAP = 4;

/** One cell per week since joining, plus this week and the one being staked. */
function YearGrid({ levels }: { levels: number[] }) {
  const color = useColors();
  const [width, setWidth] = React.useState(0);
  // Floor the cell: a fractional width overflows the row by a hair on Android
  // and wraps the grid to 12 columns. The handoff specifies 13.
  const cell = width ? Math.floor((width - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS) : 0;
  const box = { width: cell, height: cell, borderRadius: 4 };

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityLabel={
        levels.length
          ? `${levels.filter((v) => v >= 2).length} of ${levels.length} weeks finished since joining`
          : 'Your first week — no history yet'
      }
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP }}
    >
      {cell
        ? [
            ...levels.map((v, i) => (
              <View key={i} style={[box, { backgroundColor: yearLevelColor[v] }]} />
            )),
            <View
              key="current"
              style={[box, { backgroundColor: color.ink, borderWidth: 2, borderColor: onDark.limeEdge }]}
            />,
            <View
              key="next"
              style={[box, { borderWidth: 1.5, borderColor: color.dash, borderStyle: 'dashed' }]}
            />,
          ]
        : null}
    </View>
  );
}

function BestTile({ value, label }: { value: string; label: string }) {
  const color = useColors();
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: '46%',
        backgroundColor: color.card,
        borderRadius: radius.row,
        paddingVertical: 14,
        paddingHorizontal: 13,
      }}
    >
      <Bri size={21} weight={800}>
        {value}
      </Bri>
      <Sans size={11} color={color.muted} style={{ marginTop: 2 }}>
        {label}
      </Sans>
    </View>
  );
}
