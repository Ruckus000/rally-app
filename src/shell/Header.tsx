import React from 'react';
import { View } from 'react-native';
import { color, gutter, shadows } from '../theme/tokens';
import { Bri, Sans, Tap, row } from '../components/primitives';
import { Icon } from '../components/Icon';
import { useStore } from '../state/store';
import { unreadNeedsCount } from '../state/selectors';
import { CURRENT_WEEK } from '../data/week';
import { CIRCLE, ME } from '../data/fixtures';
import type { Scope } from '../state/store';

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'personal', label: 'Personal' },
  { key: 'friends', label: 'Friends' },
  { key: 'global', label: 'Global' },
];

export function Header({ topInset }: { topInset: number }) {
  const { state, dispatch, config } = useStore();
  const unread = unreadNeedsCount(state);
  const isWeek = state.tab === 'week';

  const title =
    state.tab === 'week' ? CURRENT_WEEK.label : state.tab === 'circle' ? 'Your Circle' : ME.name;
  const sub =
    state.tab === 'week'
      ? `${CURRENT_WEEK.dateRange} · ${CURRENT_WEEK.todayName}`
      : state.tab === 'circle'
        ? config.showRank
          ? `${CIRCLE.length} people, ranked by follow-through`
          : `${CIRCLE.length} people, checking in on each other`
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
              <Bri size={29} weight={800} tracking={-0.7} lineHeight={32} style={{ marginTop: 6 }}>
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
                accessibilityState={{ selected: active }}
                style={{ flex: 1, paddingBottom: 12, alignItems: 'center', minHeight: 44, justifyContent: 'flex-end' }}
              >
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
                      left: '22%',
                      right: '22%',
                      bottom: 0,
                      height: 3,
                      borderTopLeftRadius: 3,
                      borderTopRightRadius: 3,
                      backgroundColor: color.lime,
                    }}
                  />
                ) : null}
              </Tap>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
