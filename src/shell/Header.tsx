import React from 'react';
import { View } from 'react-native';
import { color, gutter, shadows } from '../theme/tokens';
import { Bri, Sans, Tap, row } from '../components/primitives';
import { Icon } from '../components/Icon';
import { useStore } from '../state/store';
import { circleMembers, unreadNeedsCount } from '../state/selectors';
import { ME } from '../data/fixtures';
import type { Scope, State } from '../state/store';

/** Includes you, which is what makes "1 person" the honest circle-of-one. */
const memberCount = (state: State): number => circleMembers(state).length;

/**
 * Two: your own week, and everyone else's. Global and Friends were the same
 * cards over the same shape, and a card in the merged feed says which of the
 * two it came from — so the row no longer has to.
 */
const SCOPES: { key: Scope; label: string }[] = [
  { key: 'personal', label: 'Personal' },
  { key: 'feed', label: 'Feed' },
];

export function Header({ topInset }: { topInset: number }) {
  const { state, dispatch, config } = useStore();
  const { week } = state;
  const unread = unreadNeedsCount(state);
  const isWeek = state.tab === 'week';
  const members = memberCount(state);

  const title =
    state.tab === 'week' ? week.label : state.tab === 'circle' ? 'Your Circle' : ME.name;
  const sub =
    state.tab === 'week'
      ? `${week.dateRange} · ${week.todayName}`
      : state.tab === 'circle'
        ? // `circleMembers`, not `world.members`: the world is a fixture, and the
          // one it hands a live account has a single element — so this read
          // "1 people" for a circle of two, and would have said it for eight.
          `${members} ${members === 1 ? 'person' : 'people'}, ` +
          (config.showRank ? 'ranked by follow-through' : 'checking in on each other')
        : `${ME.shortHandle} · ${ME.since}`;

  return (
    <View
      style={{
        paddingTop: Math.max(topInset, 20) + 20,
        paddingHorizontal: gutter,
        paddingBottom: 10,
        backgroundColor: color.paper,
        zIndex: 20,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {/* The Me tab is its own profile card — no duplicate name above it. */}
          {state.tab !== 'me' ? (
            <>
              <Bri
                accessibilityRole="header"
                size={29}
                weight={800}
                tracking={-0.7}
                lineHeight={32}
                style={{ marginTop: 6 }}
              >
                {title}
              </Bri>
              <Sans size={12} color={color.muted} style={{ marginTop: 3 }}>
                {sub}
              </Sans>
            </>
          ) : null}
        </View>

        <Tap
          onPress={() => dispatch({ type: 'OPEN_NOTIF' })}
          accessibilityLabel={unread ? `Notifications, ${unread} needing you` : 'Notifications'}
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor: color.card,
            alignItems: 'center',
            justifyContent: 'center',
            ...shadows.cardStrong,
          }}
        >
          <Icon name="bell" size={19} color={color.ink} />
          {unread > 0 ? (
            <View
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                backgroundColor: color.ink,
                borderRadius: 999,
                minWidth: 18,
                height: 18,
                paddingHorizontal: 4,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: color.paper,
              }}
            >
              <Bri size={10} weight={800} color={color.lime}>
                {unread}
              </Bri>
            </View>
          ) : null}
        </Tap>
      </View>

      {isWeek ? (
        <View style={[row, { marginTop: 14 }]}>
          {SCOPES.map((s) => {
            const active = state.scope === s.key;
            return (
              <Tap
                key={s.key}
                onPress={() => dispatch({ type: 'SET_SCOPE', scope: s.key })}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={{ flex: 1, paddingBottom: 12, alignItems: 'center', minHeight: 44, justifyContent: 'flex-end' }}
              >
                {/* The rule is pinned to this wrapper, which is only as wide
                    as the word. It used to be inset a percentage of the *tab*,
                    which was tuned for a row of three — halving the row would
                    have left a rule running well past both ends of "Feed". */}
                <View>
                  {active ? (
                    <Bri size={14.5} weight={800} color={color.ink}>
                      {s.label}
                    </Bri>
                  ) : (
                    <Sans size={14.5} weight={600} color={color.faintInk}>
                      {s.label}
                    </Sans>
                  )}
                  {active ? (
                    <View
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: -12,
                        height: 3,
                        borderTopLeftRadius: 3,
                        borderTopRightRadius: 3,
                        backgroundColor: color.lime,
                      }}
                    />
                  ) : null}
                </View>
              </Tap>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
