/**
 * Week — three scopes. Personal is your own stakes, Friends is the circle's
 * moments, Global is the wider feed.
 */
import React from 'react';
import { TextInput, View } from 'react-native';
import { color, radius, shadows } from '../theme/tokens';
import { FIRST, GLOBAL_POSTS, Moment, NAME, parseHours } from '../data/fixtures';
import { useStore } from '../state/store';
import { allTasksDone, personalFeed, stakedPoints, weekPoints } from '../state/selectors';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import {
  BigCard,
  EmptyFeed,
  EmptyState,
  FeedLabel,
  MineRow,
  MineWinCard,
  QuietRow,
  SocialCard,
} from '../components/FeedCards';
import { Bri, Sans, Tap, row } from '../components/primitives';

export function WeekScreen() {
  const { state, dispatch } = useStore();
  const { scope } = state;

  return (
    <View>
      {scope === 'personal' ? <PersonalHeader /> : null}
      {scope === 'personal' ? <PersonalFeed /> : null}
      {scope === 'friends' ? <FriendsFeed /> : null}
      {scope === 'global' ? <GlobalFeed /> : null}

      {scope === 'friends' && state.moments.length ? (
        <Tap
          onPress={() => dispatch({ type: 'OPEN_WRAP', week: null })}
          style={{ paddingTop: 16, paddingBottom: 6, paddingHorizontal: 12, alignItems: 'center' }}
        >
          <Sans size={12.5} weight={700} color={color.moss}>
            That’s the week. See how it went, together →
          </Sans>
        </Tap>
      ) : null}
    </View>
  );
}

/* ── personal: quick-log composer + points bar ──────────────────────────── */

function PersonalHeader() {
  const { state, dispatch } = useStore();
  const pts = weekPoints(state);
  const doneCount = state.myTasks.filter((t) => t.done).length;

  return (
    <>
      <View style={[row, { gap: 11, marginBottom: 14 }]}>
        <Avatar who="you" size={38} />
        {state.composerOpen ? (
          <>
            <TextInput
              value={state.composerVal}
              onChangeText={(value) => dispatch({ type: 'SET_COMPOSER_VAL', value })}
              onSubmitEditing={() => dispatch({ type: 'SUBMIT_COMPOSER' })}
              onKeyPress={(e) => {
                if (e.nativeEvent.key === 'Escape') dispatch({ type: 'SET_COMPOSER', open: false });
              }}
              autoFocus
              returnKeyType="done"
              placeholder="Log something for today…"
              placeholderTextColor={color.muted}
              accessibilityLabel="Log something for today"
              style={{
                flex: 1,
                height: 44,
                backgroundColor: color.card,
                borderRadius: 999,
                paddingHorizontal: 16,
                fontFamily: 'InstrumentSans_400Regular',
                fontSize: 14,
                color: color.ink,
                ...shadows.card,
              }}
            />
            <Tap
              onPress={() => dispatch({ type: 'SUBMIT_COMPOSER' })}
              accessibilityLabel="Log it"
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: color.lime,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="check" size={16} color={color.ink} />
            </Tap>
          </>
        ) : (
          <Tap
            onPress={() => dispatch({ type: 'SET_COMPOSER', open: true })}
            style={{
              flex: 1,
              height: 44,
              justifyContent: 'center',
              backgroundColor: color.card,
              borderRadius: 999,
              paddingHorizontal: 16,
              ...shadows.card,
            }}
          >
            <Sans size={14} color={color.muted}>
              Log something for today…
            </Sans>
          </Tap>
        )}
      </View>

      <Tap
        onPress={() => dispatch({ type: 'OPEN_PLAN' })}
        accessibilityLabel={`${pts} points, ${doneCount} of ${state.myTasks.length} done. Plan your week.`}
        style={{
          ...row,
          gap: 14,
          backgroundColor: color.ink,
          borderRadius: radius.row,
          paddingVertical: 13,
          paddingHorizontal: 16,
          marginBottom: 16,
        }}
      >
        <Bri size={15} weight={800} color={color.paper}>
          {pts} pts
        </Bri>
        <View style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(241,242,236,.3)' }} />
        <Sans size={12.5} color="rgba(241,242,236,.6)">
          {doneCount} of {state.myTasks.length} done
        </Sans>
        <Sans size={12} weight={700} color={color.lime} style={{ marginLeft: 'auto' }}>
          Plan →
        </Sans>
      </Tap>
    </>
  );
}

function PersonalFeed() {
  const { state, dispatch } = useStore();
  const { done, open } = personalFeed(state);
  const won = allTasksDone(state);

  return (
    <>
      {won ? (
        <MineWinCard
          taskCount={state.myTasks.length}
          points={stakedPoints(state)}
          streak={state.profile.currentStreak + 1}
          weekLabel={state.week.label}
          shared={!!state.acted['mywin:share']}
          onShare={() =>
            dispatch({ type: 'ACT', id: 'mywin', kind: 'share', toast: 'The circle will see this one' })
          }
        />
      ) : null}

      {state.myTasks.length === 0 ? (
        <EmptyFeed onPlan={() => dispatch({ type: 'OPEN_PLAN' })} />
      ) : null}

      {done.map((t) => (
        <MineRow
          key={t.id}
          task={t}
          onToggle={() => dispatch({ type: 'TOGGLE_TASK', id: t.id })}
          onOpen={() => dispatch({ type: 'OPEN_SHEET', sheet: { type: 'task', id: t.id } })}
        />
      ))}

      {open.length ? <FeedLabel>Still open</FeedLabel> : null}
      {open.map((t) => (
        <MineRow
          key={t.id}
          task={t}
          onToggle={() => dispatch({ type: 'TOGGLE_TASK', id: t.id })}
          onOpen={() => dispatch({ type: 'OPEN_SHEET', sheet: { type: 'task', id: t.id } })}
        />
      ))}
    </>
  );
}

/* ── friends ────────────────────────────────────────────────────────────── */

function FriendsFeed() {
  const { state, config, dispatch, world } = useStore();

  const moments = [...state.moments]
    .filter((m) => config.quietComebacks || m.kind !== 'quiet')
    .sort((a, b) => parseHours(a.time) - parseHours(b.time));

  if (world.members.length < 2) {
    return (
      <EmptyState
        title="Nobody here yet"
        body="A circle is what makes the week count for something. Bring in someone who’d notice."
        cta="Invite someone"
        onPress={() => dispatch({ type: 'OPEN_SHEET', sheet: { type: 'invite', id: null } })}
      />
    );
  }

  if (!moments.length) {
    return (
      <EmptyState
        title="A quiet week so far"
        body="Nobody in the circle has posted yet. That happens."
      />
    );
  }

  return (
    <>
      {moments.map((m) => (
        <MomentItem key={m.id} moment={m} />
      ))}
    </>
  );
}

function MomentItem({ moment: m }: { moment: Moment }) {
  const { state, dispatch } = useStore();
  const first = FIRST[m.who];
  const cheered = !!state.acted[`${m.id}:cheer`];

  const openSheet = () => dispatch({ type: 'OPEN_SHEET', sheet: { type: 'task', id: m.id } });
  const cheer = () => dispatch({ type: 'ACT', id: m.id, kind: 'cheer', toast: `${first} heard that` });

  if (m.kind === 'big') {
    return (
      <BigCard
        moment={m}
        cheered={cheered}
        cosigned={!!state.acted[`${m.id}:cosign`]}
        onCheer={cheer}
        onComment={openSheet}
        onCosign={() =>
          dispatch({ type: 'ACT', id: m.id, kind: 'cosign', toast: `You’re in with ${first}` })
        }
      />
    );
  }

  if (m.kind === 'quiet') {
    return (
      <QuietRow
        text={m.text ?? ''}
        acted={!!state.acted[`${m.id}:nod`]}
        onAct={() => dispatch({ type: 'ACT', id: m.id, kind: 'nod', toast: `${first} saw that` })}
      />
    );
  }

  const isAsk = m.kind === 'ask';
  const isIn = !!state.acted[`${m.id}:in`];

  return (
    <SocialCard
      who={m.who}
      name={NAME[m.who]}
      time={m.time}
      title={m.title ?? ''}
      quote={m.quote}
      isAsk={isAsk}
      cheered={cheered}
      cheerCount={cheered ? 1 : 0}
      commentCount={m.cmts?.length ?? 0}
      onOpen={openSheet}
      onCheer={cheer}
      onComment={openSheet}
      cta={
        isAsk
          ? {
              label: isIn ? 'You’re in ✓' : 'Sit with him',
              onPress: () =>
                dispatch({ type: 'ACT', id: m.id, kind: 'in', toast: `${first} knows you’re coming` }),
              style: isIn ? 'inkOnLime' : 'lime',
            }
          : undefined
      }
    />
  );
}

/* ── global ─────────────────────────────────────────────────────────────── */

function GlobalFeed() {
  const { state, dispatch, world } = useStore();
  const alone = world.members.length < 2;

  return (
    <>
      {GLOBAL_POSTS.map((g) => {
        const cheered = !!state.acted[`${g.id}:cheer`];
        const openSheet = () => dispatch({ type: 'OPEN_SHEET', sheet: { type: 'task', id: g.id } });
        return (
          <SocialCard
            key={g.id}
            initials={g.ini}
            tint={g.tint}
            name={g.name}
            time={g.time}
            title={g.title}
            quote={g.quote || undefined}
            statLabel={g.statLabel}
            cheered={cheered}
            cheerCount={g.cheers + (cheered ? 1 : 0)}
            commentCount={g.comments + (state.globalNotes[g.id]?.length ?? 0)}
            onOpen={openSheet}
            onCheer={() =>
              dispatch({
                type: 'ACT',
                id: g.id,
                kind: 'cheer',
                toast: `${g.name.replace('@', '')} heard that`,
              })
            }
            onComment={openSheet}
          />
        );
      })}

      {/* The global feed is public, so a brand-new account sees it too — but
          without a circle it's a wall of strangers. Say why, and offer the way out. */}
      {alone ? (
        <View style={{ alignItems: 'center', paddingTop: 22, paddingBottom: 6, paddingHorizontal: 20 }}>
          <Sans size={13} lineHeight={18} color={color.muted} style={{ textAlign: 'center' }}>
            These are strangers, and they’re doing fine without you. Your circle is the part that
            counts.
          </Sans>
          <Tap
            onPress={() => dispatch({ type: 'OPEN_SHEET', sheet: { type: 'invite', id: null } })}
            style={{
              marginTop: 14,
              borderRadius: 999,
              paddingVertical: 12,
              paddingHorizontal: 18,
              minHeight: 44,
              justifyContent: 'center',
              backgroundColor: color.ink,
            }}
          >
            <Bri size={13.5} weight={800} color={color.lime}>
              Invite someone
            </Bri>
          </Tap>
        </View>
      ) : null}
    </>
  );
}
