/**
 * Circle — which circle, then a podium, then the ranked list.
 *
 * The list row shows follow-through, which is what the ranking sorts by.
 * Points deliberately do not appear here: they'd imply a different sort.
 *
 * The switcher is a sibling of the body rather than part of it, and that is the
 * point of the arrangement: standing in an empty circle used to return the
 * "A circle of one" empty state before anything else rendered, so somebody in
 * three circles whose active one was empty had no way out of it.
 */
import React from 'react';
import { View } from 'react-native';
import { onDark, onLight, radius } from '../theme/tokens';
import { useColors, usePersonTints, useShadows, type Palette } from '../theme/ThemeProvider';
import { Avatar, ProgressRing } from '../components/Avatar';
import { Bri, Caps, Sans, Tap, fill, row } from '../components/primitives';
import { Icon } from '../components/Icon';
import { useStore, usePeople } from '../state/store';
import { activeCircle, RankedMember, ranking } from '../state/selectors';
import { EmptyState } from '../components/FeedCards';
import { CircleSwitcher } from '../components/CircleSwitcher';

const TREND_GLYPH = { up: '▲', down: '▼', same: '–' } as const;
/**
 * `down` and `same` were drawn at faintInk and dash — around 2:1 on white, so
 * the two states that are not "up" were the ones you could not see. The glyph
 * still carries the meaning; the colour only has to be legible.
 */
const TREND_COLOR = (color: Palette) =>
  ({ up: color.moss, down: color.muted, same: color.muted }) as const;
/** The same fact in words, for a screen reader that cannot read a triangle. */
const TREND_SAID = { up: 'trending up', down: 'trending down', same: 'holding steady' } as const;

/**
 * A member whose week has not been pulled has no cheer count, and a 0 in that
 * chip would read as one. An en dash says "nothing to report" — the same thing
 * the row's own metric line says in words.
 */
const cheers = (given: number | null) => (given === null ? '–' : String(given));

export function CircleScreen() {
  const color = useColors();
  const shadows = useShadows();
  const { state, dispatch, config, people } = useStore();
  const live = state.account === 'live';
  // Resolved once. Three separate `activeCircle` calls could disagree if a pull
  // landed between them, and the invite sheet would then be handed a different
  // room from the one the podium was drawn for.
  const activeId = activeCircle(state)?.id ?? null;
  // The screen has never named the room it draws. With a switcher above it,
  // "the circle" is the one line left that does not say which.
  const activeName = state.account === 'live' ? (activeCircle(state)?.name ?? null) : null;
  // The ranking sorts the whole circle and walks every cheer against every
  // moment — too much to redo on renders where none of its inputs moved.
  // Keyed on the slices `ranking` actually reads (via `myStats`).
  const ranked = React.useMemo(
    () => ranking(state, activeId),
    // `circles` and `activeCircleId` are in the deps because the memo is keyed
    // on what `ranking` reads, and it now reads both. Without them, switching
    // circles would draw the previous circle's podium under the new circle's
    // name — no error, no visual tell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      state.myTasks,
      state.acted,
      state.moments,
      state.people,
      state.selfId,
      state.account,
      state.profile,
      state.circles,
      state.activeCircleId,
    ],
  );
  const top3 = ranked.slice(0, 3);
  const rest = ranked.slice(3);
  // Centre the winner: 2nd · 1st · 3rd.
  const podium = top3.length === 3 ? [top3[1], top3[0], top3[2]] : top3;

  // Named, not null: this screen has already decided which room it is drawing,
  // and resolving it a second time inside the sheet could answer differently.
  const openInvite = () => dispatch({ type: 'OPEN_SHEET', sheet: { type: 'invite', id: activeId } });
  const openFork = () => dispatch({ type: 'OPEN_SHEET', sheet: { type: 'joinCircle', id: null } });

  const openMember = (k: RankedMember['k']) =>
    people.isSelf(k)
      ? dispatch({ type: 'SET_TAB', tab: 'me' })
      : dispatch({ type: 'OPEN_SHEET', sheet: { type: 'person', id: k } });

  /**
   * Ordered, and the order is load-bearing. "Nobody has answered yet" has to
   * be asked before "you are in none", and both before "a circle of one" —
   * because with `circles: []` the ranking falls back to the whole directory,
   * which for a live account with no circle is you alone. Asked last, the
   * third branch would answer all three cases with the one that is only
   * sometimes true.
   *
   * Every branch is gated on `live`. The demo modes carry `circles: []` with
   * `worldSeen: true` by construction, so an ungated branch would blank the
   * seeded world — which is the first screen anybody sees.
   */
  const body =
    live && state.circles.length === 0 && !state.worldSeen ? (
      <EmptyState
        title="One moment"
        body="Checking which circles you’re in. If there are any, they’ll be here in a second."
      />
    ) : live && state.circles.length === 0 ? (
      <EmptyState
        title="No circle yet"
        body="Rally works when someone notices. Join one with a code, or start one and send it."
        cta="Join or start a circle"
        onPress={openFork}
      />
    ) : ranked.length < 2 ? (
      // A circle of one has nothing to rank. Ask for people instead of
      // showing a podium of you — but under the switcher now, so being alone
      // in this room is not being stuck in it.
      <EmptyState
        title="A circle of one"
        body="Rally works when someone notices. Bring in the people who would."
        cta="Invite someone"
        onPress={openInvite}
      />
    ) : (
      <>
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
                accessibilityLabel={`${r.name}, rank ${r.rank}, ${r.sub}, ${TREND_SAID[people.trend(r.k)]}`}
                style={{
                  ...row,
                  gap: 10,
                  paddingVertical: 11,
                  paddingHorizontal: 14,
                  minHeight: 58,
                  backgroundColor: people.isSelf(r.k) ? color.askTint : 'transparent',
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: color.rowDivider,
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

                <Sans size={11} color={TREND_COLOR(color)[people.trend(r.k)]} style={{ marginRight: 2 }}>
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
            <Sans size={13} lineHeight={18} color={onDark.primary} style={fill}>
              <Bri size={13} weight={800} color={onDark.primary}>
                {/* Derived from the ranking already in hand — `totalCheersExchanged`
                    re-runs the entire ranking to compute exactly this reduce. */}
                {ranked.reduce((a, r) => a + (r.given ?? 0), 0)}
              </Bri>
              {activeName ? ` cheers exchanged in ${activeName} this week` : ' cheers exchanged in the circle this week'}
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
            <Bri size={15} weight={800} color={color.textPrimary}>
              {activeName ? `+ Invite someone to ${activeName}` : '+ Invite someone to the circle'}
            </Bri>
          </Tap>
      </>
    );

  return (
    <View>
      <CircleSwitcher
        circles={state.circles}
        activeId={activeId}
        onSelect={(id) => dispatch({ type: 'SET_ACTIVE_CIRCLE', id })}
        onAdd={openFork}
      />
      {body}
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
  const color = useColors();
  const personTints = usePersonTints();
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
        <ProgressRing size={size} pct={member.pct} ringColor={isFirst ? color.lime : color.ringQuiet} />
        <View
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            right: 8,
            bottom: 8,
            borderRadius: size / 2,
            backgroundColor: personTints[people.tintIndex(member.k)],
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
            <Bri size={11} weight={800} color={isFirst ? onLight : color.lime}>
              {member.rank}
            </Bri>
          </View>
        ) : null}
      </View>

      {/* Bounded to the ring it sits under: unbounded, one long first name
          widened its podium column until the centred three-up row ran off
          both edges of the screen. */}
      <View style={[row, { marginTop: 9, maxWidth: size + 24 }]}>
        <Sans size={12} weight={700} color={color.textPrimary} numberOfLines={1} style={{ flexShrink: 1 }}>
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
