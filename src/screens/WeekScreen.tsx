/**
 * Week — two scopes, in tab order: Personal is your own stakes, Feed is
 * everyone else's, your circle and the public feed in one list.
 */
import React from 'react';
import { TextInput, View } from 'react-native';
import { color, radius, shadows } from '../theme/tokens';
import { Moment } from '../data/fixtures';
import { useStore } from '../state/store';
import {
  allTasksDone,
  circleMembers,
  mergedFeed,
  personalFeed,
  stakedPoints,
  weekPoints,
} from '../state/selectors';
import type { FeedSource } from '../state/selectors';
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
      {scope === 'feed' ? <Feed /> : null}

      {/* Still gated on the circle's own moments: the wrap is about how *your
          people's* week went, and the bots are not in it. */}
      {scope === 'feed' && state.moments.length ? (
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
  const { state, dispatch, people } = useStore();
  const pts = weekPoints(state);
  const doneCount = state.myTasks.filter((t) => t.done).length;

  return (
    <>
      <View style={[row, { gap: 11, marginBottom: 14 }]}>
        <Avatar who={people.selfId} size={38} />
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

/* ── feed ───────────────────────────────────────────────────────────────── */

/**
 * Your circle and the public feed, in one list.
 *
 * These were two tabs. Everything but the slice they read was already shared —
 * the same `Moment` shape, the same card, the same sort — so what the split
 * bought was navigation, and what it cost was a new account landing on a wall
 * of strangers with its own people behind a tab it had to think to cross.
 *
 * `mergedFeed` orders and labels; this only draws.
 */
function Feed() {
  const { state, config, dispatch } = useStore();
  const entries = mergedFeed(state, config.quietComebacks);
  const alone = circleMembers(state).length < 2;

  // Only reachable before the first pull lands, or on an account with no bots
  // to show. It is no longer the circle-of-one case — that one has content now,
  // and gets the footer below instead.
  if (!entries.length) {
    return <EmptyState title="A quiet week so far" body="Nobody has posted yet. That happens." />;
  }

  return (
    <>
      {entries.map(({ m, from }) => (
        <MomentItem key={m.id} moment={m} from={from} />
      ))}

      {/* The public half means a brand-new account always has something to
          read — which without a circle is a feed of people you do not know,
          two of whom are made of straw. Say so, and offer the way out. */}
      {alone ? (
        <View style={{ alignItems: 'center', paddingTop: 22, paddingBottom: 6, paddingHorizontal: 20 }}>
          <Sans size={13} lineHeight={18} color={color.muted} style={{ textAlign: 'center' }}>
            The ones marked Follow are not real, and they’re doing fine without you. Your circle is
            the part that counts.
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

/** FRIENDS on your circle's cards, FOLLOW on the public feed's. */
const BADGE: Record<FeedSource, string> = { circle: 'Friends', follow: 'Follow' };

function MomentItem({ moment: m, from }: { moment: Moment; from: FeedSource }) {
  const { state, dispatch, people } = useStore();
  const first = people.first(m.who);
  const cheered = !!state.acted[`${m.id}:cheer`];

  const openSheet = () => dispatch({ type: 'OPEN_SHEET', sheet: { type: 'task', id: m.id } });
  const cheer = () => dispatch({ type: 'ACT', id: m.id, kind: 'cheer', toast: `${first} heard that` });

  if (m.kind === 'big') {
    return (
      <BigCard
        moment={m}
        badge={BADGE[from]}
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
      name={people.name(m.who)}
      badge={BADGE[from]}
      time={m.time}
      title={m.title ?? ''}
      quote={m.quote}
      isAsk={isAsk}
      cheered={cheered}
      // Everyone else's, plus your own tap. `pullCheerCounts` deliberately
      // excludes you, so this is addition rather than a guess about whether the
      // server has heard about your cheer yet — which would be off by one for
      // as long as the queue was busy, in whichever direction it guessed wrong.
      cheerCount={(m.cheers ?? 0) + (cheered ? 1 : 0)}
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

