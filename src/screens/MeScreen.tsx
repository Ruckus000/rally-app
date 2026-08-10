/**
 * Me — profile, points, streak, year grid, exchange, owed, bests, past weeks.
 */
import React from 'react';
import { Alert, View } from 'react-native';
import { color, onDark, radius, shadows, yearLevelColor } from '../theme/tokens';
import { CIRCLE_NAME, ME, NAME, weekPointsLabel } from '../data/fixtures';
import { nextWeekAfter, useStore } from '../state/store';
import { allTasksDone, cheersGiven, weekPoints } from '../state/selectors';
import { Avatar } from '../components/Avatar';
import { Bri, Caps, GlowBloom, Sans, Tap, fill, row } from '../components/primitives';

export function MeScreen() {
  const { state, dispatch, world } = useStore();
  const { profile, week, history, yearLevels } = state;
  const won = allTasksDone(state);
  const gave = cheersGiven(state);
  const got = profile.cheersReceived;
  const exchangeTotal = gave + got || 1;
  const owed = world.owed.filter((o) => !state.replied[o.k]);
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
            <Avatar who="you" size={50} label={ME.name} style={{ position: 'absolute', top: 5, left: 5 }} />
          </View>
          <View style={fill}>
            <Bri size={22} weight={800} tracking={-0.5} color={color.paper}>
              {ME.name}
            </Bri>
            <Sans size={12} color={onDark.secondary} style={{ marginTop: 2 }}>
              {/* No circle, no circle name — you haven't joined one. */}
              {world.members.length > 1 ? `${ME.handle} · ${CIRCLE_NAME}` : ME.handle}
            </Sans>
          </View>
          <Tap
            onPress={() => dispatch({ type: 'SET_TAB', tab: 'circle' })}
            accessibilityLabel={`${profile.weeksIn} weeks in. Open your circle.`}
            style={{ alignItems: 'flex-end', padding: 2 }}
          >
            <Bri size={19} weight={800} color={color.lime}>
              {profile.weeksIn}
            </Bri>
            <Caps size={9.5} tracking={1.2} color={onDark.secondary}>
              Weeks in
            </Caps>
          </Tap>
        </View>

        {/* 2 · points */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 11, marginTop: 22 }}>
          <Bri size={48} weight={800} tracking={-2.2} lineHeight={41} color={color.paper}>
            {profile.allTimePoints.toLocaleString()}
          </Bri>
          <View style={{ paddingBottom: 4 }}>
            <Caps size={9.5} tracking={1.5} color={onDark.secondary} style={{ lineHeight: 13 }}>
              {'Points\nAll time'}
            </Caps>
          </View>
          <View style={{ marginLeft: 'auto', paddingBottom: 4, alignItems: 'flex-end' }}>
            <Bri size={17} weight={800} color={color.lime}>
              {weekPoints(state)}
            </Bri>
            <Caps size={9.5} tracking={1.2} color={onDark.secondary}>
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
                  backgroundColor: i < streak ? color.lime : 'rgba(241,242,236,.14)',
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
              : `${got - gave} cheers behind. Nobody is counting except this bar.`}
        </Sans>
        <Sans size={11} color={color.muted} style={{ marginTop: 4, opacity: 0.8 }}>
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
                    {NAME[o.k]}
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
                  accessibilityLabel={`Say something to ${NAME[o.k]}`}
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

      <DevControls />
    </View>
  );
}

/**
 * The escape hatch. State survives relaunches now, so there has to be a way
 * back — and it doubles as the way to see the empty first-run account without
 * reinstalling.
 */
function DevControls() {
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
              style={[box, { backgroundColor: color.ink, borderWidth: 2, borderColor: 'rgba(195,245,60,.5)' }]}
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
