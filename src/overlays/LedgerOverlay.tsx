/**
 * Week ledger — what you did, who helped you, who you helped.
 *
 * Reads either the live week or a historical one; the footer labels change to
 * match, and empty states are written rather than generic.
 */
import React from 'react';
import { ScrollView, View, ViewStyle } from 'react-native';
import { gutter, radius } from '../theme/tokens';
import { useColors, type Palette } from '../theme/ThemeProvider';
import { useStore, usePeople } from '../state/store';
import { helpedByThisWeek, helpedThisWeek, pluralTimes, withoutBlocked } from '../state/selectors';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Bri, Caps, Sans, Tap, fill, row } from '../components/primitives';
import { Overlay } from './Overlay';
import type { PersonId } from '../data/people';

export function LedgerOverlay({ topInset, bottomInset }: { topInset: number; bottomInset: number }) {
  const color = useColors();
  const { state, dispatch } = useStore();
  const history = state.wrapWeek ? (state.history.find((h) => h.n === state.wrapWeek) ?? null) : null;
  const close = () => dispatch({ type: 'CLOSE_WRAP' });

  const did = history
    ? history.did
    : state.myTasks.filter((t) => t.done).map((t) => ({ title: t.title, points: t.pts }));

  const helpedByMap = helpedByThisWeek(state);
  const helpedMap = helpedThisWeek(state);

  // The two selectors above already drop the people you have blocked. A stored
  // week does not go through them — `history` is a snapshot written when the
  // week closed, before the block existed — so it gets the same filter here.
  // Retroactive is the decided rule: blocking someone takes them out of your
  // view of every week, not just the one you are standing in.
  const helpedBy = history
    ? withoutBlocked(history.helpedBy, state).map((h) => ({ k: h.k, detail: h.detail }))
    : (Object.keys(helpedByMap) as PersonId[]).map((k) => ({
        k,
        detail: `${pluralTimes(helpedByMap[k] ?? 0)} this week`,
      }));

  const helped = history
    ? withoutBlocked(history.helped, state).map((h) => ({ k: h.k, detail: h.detail }))
    : (Object.keys(helpedMap) as PersonId[]).map((k) => ({
        k,
        detail: pluralTimes(helpedMap[k] ?? 0),
      }));

  return (
    <Overlay zIndex={55} background={color.paper} onRequestClose={close}>
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
          {history ? history.label : `${state.week.label}, quietly`}
        </Bri>
        <Tap onPress={close} accessibilityLabel="Close ledger" style={closeButton(color)}>
          <Icon name="close" size={16} color={color.ink} />
        </Tap>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 10, paddingHorizontal: gutter, paddingBottom: 12 }}
      >
        <Caps size={11} tracking={1.4} style={{ marginHorizontal: 2, marginTop: 6, marginBottom: 9 }}>
          What you did
        </Caps>
        <View style={{ gap: 7, marginBottom: 16 }}>
          {did.map((d, i) => (
            <View
              key={`${d.title}-${i}`}
              style={{
                ...row,
                gap: 10,
                backgroundColor: color.card,
                borderRadius: radius.chip,
                paddingVertical: 11,
                paddingHorizontal: 13,
              }}
            >
              <Sans size={14} weight={600} style={fill}>
                {d.title}
              </Sans>
              <Bri size={13} weight={700} color={color.moss}>
                +{d.points}
              </Bri>
            </View>
          ))}
          {did.length === 0 ? (
            <Sans size={13} color={color.muted} style={{ textAlign: 'center', padding: 10 }}>
              {history
                ? 'That week didn’t land. It happens.'
                : 'Nothing finished yet — there’s still time.'}
            </Sans>
          ) : null}
        </View>

        <Caps size={11} tracking={1.4} style={{ marginHorizontal: 2, marginBottom: 9 }}>
          Who helped you
        </Caps>
        <PeopleList people={helpedBy} />

        <Caps size={11} tracking={1.4} style={{ marginHorizontal: 2, marginBottom: 9 }}>
          Who you helped
        </Caps>
        <View style={{ gap: 7, marginBottom: 6 }}>
          {helped.map((h) => (
            <PersonLine key={h.k} who={h.k} detail={h.detail} />
          ))}
          {helped.length === 0 ? (
            <Sans size={13} color={color.muted} style={{ paddingVertical: 6, paddingHorizontal: 2 }}>
              Nobody yet. Someone on the rail could use a word.
            </Sans>
          ) : null}
        </View>
      </ScrollView>

      <View
        style={{
          flexDirection: 'row',
          gap: 9,
          paddingTop: 8,
          paddingHorizontal: gutter,
          paddingBottom: Math.max(bottomInset, 24) + 16,
        }}
      >
        <Tap
          onPress={close}
          style={{
            flex: 1,
            minHeight: 52,
            borderRadius: radius.chip,
            borderWidth: 1,
            borderColor: 'rgba(25,30,22,.14)',
            backgroundColor: color.card,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Bri size={15} weight={800}>
            {history ? 'Close' : 'Not yet'}
          </Bri>
        </Tap>
        <Tap
          onPress={() =>
            history
              ? dispatch({ type: 'GO_PLACE', patch: { tab: 'me' } })
              : dispatch({ type: 'OPEN_PLAN_WITH', seed: { title: '', pair: [], day: 0 } })
          }
          style={{
            flex: 2,
            minHeight: 52,
            borderRadius: radius.chip,
            backgroundColor: color.lime,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Bri size={16} weight={800}>
            {history ? 'Back to today' : `Stake Week ${state.week.number + 1}`}
          </Bri>
        </Tap>
      </View>
    </Overlay>
  );
}

function PeopleList({ people }: { people: { k: PersonId; detail: string }[] }) {
  return (
    <View style={{ gap: 7, marginBottom: 16 }}>
      {people.map((h) => (
        <PersonLine key={h.k} who={h.k} detail={h.detail} />
      ))}
    </View>
  );
}

function PersonLine({ who, detail }: { who: PersonId; detail: string }) {
  const color = useColors();
  const people = usePeople();
  return (
    <View style={[row, { gap: 10 }]}>
      <Avatar who={who} size={32} />
      <Sans size={14} style={fill}>
        {people.name(who)}
        <Sans size={14} color={color.muted}>
          {' — '}
          {detail}
        </Sans>
      </Sans>
    </View>
  );
}

/**
 * The round close button on the three full-page overlays.
 *
 * A function of the palette rather than an object, and this is the shape every
 * module-level style object in the dark-mode migration takes — see the write-up
 * in `theme/ThemeProvider.tsx`. As a plain object it captured `color.divider`
 * and `color.card` at import, which is fine while there is one palette and
 * wrong the moment there are two: it would freeze whichever was active when
 * this module first loaded and never move again, and the bug would only show
 * on a live toggle.
 *
 * Not moved inside `LedgerOverlay` instead, because `NotificationsOverlay` and
 * `SettingsOverlay` use it too. Three components sharing one box is exactly
 * the case where hoisting a factory beats moving the object into one of them.
 *
 * The caller passes whatever palette it has. Every caller now passes
 * `useColors()`, but the parameter is what let the migration proceed one file
 * at a time — an unmigrated caller could still pass the static import — and it
 * is what a caller yet to be migrated will lean on.
 */
export const closeButton = (color: Palette): ViewStyle => ({
  width: 40,
  height: 40,
  borderRadius: 20,
  borderWidth: 1,
  borderColor: color.divider,
  backgroundColor: color.card,
  alignItems: 'center',
  justifyContent: 'center',
});
