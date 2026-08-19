/**
 * Circle — a podium, then the ranked list.
 *
 * The list row shows follow-through, which is what the ranking sorts by.
 * Points deliberately do not appear here: they'd imply a different sort.
 */
import React from 'react';
import { View } from 'react-native';
import { color, radius, shadows } from '../theme/tokens';
import { Avatar, ProgressRing } from '../components/Avatar';
import { Bri, Caps, Sans, Tap, fill, row } from '../components/primitives';
import { Icon } from '../components/Icon';
import { useStore, usePeople } from '../state/store';
import { RankedMember, ranking } from '../state/selectors';
import { EmptyState } from '../components/FeedCards';

const TREND_GLYPH = { up: '▲', down: '▼', same: '–' } as const;
const TREND_COLOR = { up: color.moss, down: color.faintInk, same: color.dash } as const;

/**
 * A member whose week has not been pulled has no cheer count, and a 0 in that
 * chip would read as one. An en dash says "nothing to report" — the same thing
 * the row's own metric line says in words.
 */
const cheers = (given: number | null) => (given === null ? '–' : String(given));

export function CircleScreen() {
  const { state, dispatch, config, people } = useStore();
  // The ranking sorts the whole circle and walks every cheer against every
  // moment — too much to redo on renders where none of its inputs moved.
  // Keyed on the slices `ranking` actually reads (via `myStats`).
  const ranked = React.useMemo(
    () => ranking(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.myTasks, state.acted, state.moments, state.people, state.selfId, state.account, state.profile],
  );
  const top3 = ranked.slice(0, 3);
  const rest = ranked.slice(3);
  // Centre the winner: 2nd · 1st · 3rd.
  const podium = top3.length === 3 ? [top3[1], top3[0], top3[2]] : top3;

  const openInvite = () => dispatch({ type: 'OPEN_SHEET', sheet: { type: 'invite', id: null } });

  // A circle of one has nothing to rank. Ask for people instead of showing a podium of you.
  if (ranked.length < 2) {
    return (
      <EmptyState
        title="A circle of one"
        body="Rally works when someone notices. Bring in the people who would."
        cta="Invite someone"
        onPress={openInvite}
      />
    );
  }

  const openMember = (k: RankedMember['k']) =>
    people.isSelf(k)
      ? dispatch({ type: 'SET_TAB', tab: 'me' })
      : dispatch({ type: 'OPEN_SHEET', sheet: { type: 'person', id: k } });

  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'center',
          gap: 20,
          marginTop: 14,
          marginBottom: 10,
        }}
      >
        {podium.map((p) => (
          <PodiumMember
            key={p.k}
            member={p}
            showRank={config.showRank}
            onPress={() => openMember(p.k)}
          />
        ))}
      </View>

      <Caps size={11} tracking={1.4} style={{ textAlign: 'center', marginBottom: 22 }}>
        Top performers this week
      </Caps>

      <View style={[{ backgroundColor: color.card, borderRadius: 24, overflow: 'hidden' }, shadows.card]}>
        {rest.map((r, i) => (
          <Tap
            key={r.k}
            onPress={() => openMember(r.k)}
            accessibilityLabel={`${r.name}, rank ${r.rank}, ${r.sub}`}
            style={{
              ...row,
              gap: 10,
              paddingVertical: 11,
              paddingHorizontal: 14,
              minHeight: 58,
              backgroundColor: people.isSelf(r.k) ? color.askTint : 'transparent',
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: 'rgba(25,30,22,.06)',
            }}
          >
            {/* Rank is a number, not only a position — colour is never the only signal. */}
            <Bri size={12.5} weight={700} color={color.faintInk} style={{ width: 18, textAlign: 'center' }}>
              {config.showRank ? String(r.rank) : '·'}
            </Bri>

            <View style={{ width: 36, height: 36 }}>
              <ProgressRing size={36} pct={r.pct} stroke={9} />
              <Avatar who={r.k} size={26} style={{ position: 'absolute', top: 5, left: 5 }} />
            </View>

            <View style={fill}>
              <Sans size={14} weight={600}>
                {r.name}
              </Sans>
              <Sans size={11} color={color.muted}>
                {r.sub}
              </Sans>
            </View>

            <Sans size={11} color={TREND_COLOR[people.trend(r.k)]} style={{ marginRight: 2 }}>
              {TREND_GLYPH[people.trend(r.k)]}
            </Sans>

            <View
              style={{
                ...row,
                gap: 4,
                backgroundColor: color.limeTintChip,
                borderRadius: 999,
                paddingHorizontal: 9,
                paddingVertical: 4,
              }}
            >
              <Icon name="heart" size={12} color={color.moss} />
              <Sans size={12} weight={700} color={color.moss}>
                {cheers(r.given)}
              </Sans>
            </View>
          </Tap>
        ))}
      </View>

      <View
        style={{
          ...row,
          gap: 10,
          backgroundColor: color.ink,
          borderRadius: radius.row,
          paddingVertical: 13,
          paddingHorizontal: 16,
          marginTop: 16,
        }}
      >
        <Sans size={16}>🔥</Sans>
        <Sans size={13} lineHeight={18} color={color.paper} style={fill}>
          <Bri size={13} weight={800} color={color.paper}>
            {/* Derived from the ranking already in hand — `totalCheersExchanged`
                re-runs the entire ranking to compute exactly this reduce. */}
            {ranked.reduce((a, r) => a + (r.given ?? 0), 0)}
          </Bri>
          {' cheers exchanged in the circle this week'}
        </Sans>
      </View>

      <Tap
        onPress={openInvite}
        style={{
          backgroundColor: color.chip,
          borderRadius: radius.chip,
          minHeight: 50,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 12,
        }}
      >
        <Bri size={15} weight={800} color={color.ink}>
          + Invite someone to the circle
        </Bri>
      </Tap>
    </View>
  );
}

function PodiumMember({
  member,
  showRank,
  onPress,
}: {
  member: RankedMember;
  showRank: boolean;
  onPress: () => void;
}) {
  const people = usePeople();
  const isFirst = member.rank === 1;
  const size = isFirst ? 92 : 74;

  return (
    <Tap
      onPress={onPress}
      accessibilityLabel={
        member.given === null
          ? `${member.name}, rank ${member.rank}, ${member.sub}`
          : `${member.name}, rank ${member.rank}, ${member.given} cheers given`
      }
      style={{ alignItems: 'center' }}
    >
      <View style={{ width: size, height: size }}>
        <ProgressRing size={size} pct={member.pct} ringColor={isFirst ? color.lime : '#C6DDA0'} />
        <View
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            right: 8,
            bottom: 8,
            borderRadius: size / 2,
            backgroundColor: people.tint(member.k),
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Bri size={Math.round(size * 0.28)} weight={700} color={color.avatarText}>
            {member.ini}
          </Bri>
        </View>

        {showRank ? (
          <View
            style={{
              position: 'absolute',
              bottom: -4,
              left: size / 2 - 11,
              width: 22,
              height: 22,
              borderRadius: 11,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: color.paper,
              backgroundColor: isFirst ? color.lime : color.ink,
            }}
          >
            <Bri size={11} weight={800} color={isFirst ? color.ink : color.lime}>
              {member.rank}
            </Bri>
          </View>
        ) : null}
      </View>

      {/* Bounded to the ring it sits under: unbounded, one long first name
          widened its podium column until the centred three-up row ran off
          both edges of the screen. */}
      <View style={[row, { marginTop: 9, maxWidth: size + 24 }]}>
        <Sans size={12} weight={700} color={color.ink} numberOfLines={1} style={{ flexShrink: 1 }}>
          {member.first}
        </Sans>
        <Sans size={12} color={color.faintInk} numberOfLines={1}>
          {' · '}
          {cheers(member.given)} given
        </Sans>
      </View>
    </Tap>
  );
}
