import React from 'react';
import { View } from 'react-native';
import { gutter } from '../theme/tokens';
import { useColors } from '../theme/ThemeProvider';
import { Bri, Sans, Tap, row } from '../components/primitives';
import { Icon } from '../components/Icon';
import { useStore } from '../state/store';
import { activeCircle, circleMembers, unreadNeedsCount } from '../state/selectors';
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
  const color = useColors();
  const { state, dispatch, config } = useStore();
  const { week } = state;
  const unread = unreadNeedsCount(state);
  const isWeek = state.tab === 'week';
  const members = memberCount(state);
  const live = state.account === 'live';

  // One per tab, and each is the screen's own name rather than its contents.
  // "Me" deliberately does not repeat the person's name: the profile card
  // directly below carries it at 22px, and the header used to render nothing
  // at all here — leaving the bell floating over a band of empty chrome.
  const title =
    state.tab === 'week' ? week.label : state.tab === 'circle' ? 'Your Circle' : 'Me';
  const sub =
    state.tab === 'week'
      ? `${week.dateRange} · ${week.todayName}`
      : state.tab === 'circle'
        ? // `circleMembers`, not `world.members`: the world is a fixture, and the
          // one it hands a live account has a single element — so this read
          // "1 people" for a circle of two, and would have said it for eight.
          `${members} ${members === 1 ? 'person' : 'people'}, ` +
          (config.showRank ? 'ranked by follow-through' : 'checking in on each other')
        : live
          ? (activeCircle(state)?.name ?? 'Your week, on the record')
          : `${ME.shortHandle} · ${ME.since}`;

  return (
    <View
      style={{
        // The handoff's header is `60px 18px 10px` on a device whose inset is
        // 59 — i.e. one point of air above the status bar, not twenty. The
        // floor keeps it sane on a device with no inset at all.
        paddingTop: Math.max(topInset + 1, 40),
        paddingHorizontal: gutter,
        paddingBottom: 10,
        backgroundColor: color.paper,
        zIndex: 20,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        {/* Every tab gets its title. The Me tab used to render an empty column
            here, leaving the bell floating over ~130px of blank chrome. */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Bri
            accessibilityRole="header"
            size={29}
            weight={800}
            tracking={-0.7}
            lineHeight={34}
            numberOfLines={1}
            style={{ marginTop: 6 }}
          >
            {title}
          </Bri>
          <Sans size={12} color={color.muted} style={{ marginTop: 3 }} numberOfLines={1}>
            {sub}
          </Sans>
        </View>

        <Tap
          onPress={() => dispatch({ type: 'OPEN_NOTIF' })}
          accessibilityLabel={unread ? `Notifications, ${unread} needing you` : 'Notifications'}
          // No white chip and no shadow: the bell sits straight on the paper,
          // bigger than the chip it used to wear. Ink on paper is ~14:1, so
          // nothing is lost but the chrome.
          style={{
            width: 48,
            height: 48,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="bell" size={24} color={color.textPrimary} />
          {unread > 0 ? (
            <View
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                backgroundColor: color.ink,
                borderRadius: 999,
                minWidth: 18,
                height: 18,
                paddingHorizontal: 4,
                alignItems: 'center',
                justifyContent: 'center',
                // A hairline of paper, not the chip's 2px ring — enough to
                // keep the badge off the bell's own strokes now that there is
                // no white disc between them.
                borderWidth: 1,
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
                    <Bri size={14.5} weight={800} color={color.textPrimary}>
                      {s.label}
                    </Bri>
                  ) : (
                    // `muted`, not `faintInk`: this is an interactive control's
                    // label, and faintInk on paper is about 2.1:1. The active
                    // state is still unmistakable — display face plus the rule.
                    <Sans size={14.5} weight={600} color={color.muted}>
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
