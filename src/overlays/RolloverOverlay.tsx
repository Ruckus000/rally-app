/**
 * The Sunday prompt.
 *
 * When the calendar moves on, nothing is rewritten until you've seen the week
 * that closed and said what carries. It reuses the ledger's shape deliberately
 * — the design already put a "Stake Week {n+1}" button there, which is it
 * telling us this is where rollover lives.
 */
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { color, gutter, radius, shadows } from '../theme/tokens';
import { useStore } from '../state/store';
import { closingWeek } from '../state/selectors';
import { queueRollup } from '../sync/engine';
import { mondayOf } from '../sync/mappers';
import { Icon } from '../components/Icon';
import { Bri, Caps, Sans, Tap, fill, row } from '../components/primitives';
import { Overlay } from './Overlay';

export function RolloverOverlay({
  topInset,
  bottomInset,
}: {
  topInset: number;
  bottomInset: number;
}) {
  const { state, dispatch } = useStore();
  const [carry, setCarry] = useState<string[]>([]);
  // `COMMIT_ROLLOVER` rewrites the week while <Presence> is still fading this
  // out. Rendering from a snapshot of the closing week's slices keeps it on
  // screen through the exit instead of flashing the new, empty one. Guarded
  // setState during render — the sanctioned previous-value pattern.
  const live = !!state.pendingRollover;
  const [snap, setSnap] = useState(() =>
    state.pendingRollover
      ? { rollover: state.pendingRollover, tasks: state.myTasks, week: state.week }
      : null,
  );
  if (
    state.pendingRollover &&
    (snap?.rollover !== state.pendingRollover ||
      snap.tasks !== state.myTasks ||
      snap.week !== state.week)
  ) {
    setSnap({ rollover: state.pendingRollover, tasks: state.myTasks, week: state.week });
  }

  if (!snap) return null;
  const to = snap.rollover.to;
  const weekLabel = snap.week.label;
  const total = snap.tasks.length;
  const done = snap.tasks.filter((t) => t.done);
  const open = snap.tasks.filter((t) => !t.done);
  const points = done.reduce((a, t) => a + t.pts, 0);
  const perfect = total > 0 && open.length === 0;

  const toggle = (id: string) =>
    setCarry((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const commit = () => {
    // Only while the rollover is still pending: a second tap during the exit
    // fade must not queue a second rollup or re-commit.
    if (!live) return;
    // Queued in the same tick as the dispatch, the way a rename is —
    // see `queueRollup` for why this is not derived from state. The
    // numbers come from the same function the reducer uses, so the week
    // on the server and the week in `history` cannot disagree.
    queueRollup({ weekStart: mondayOf(state.week), ...closingWeek(state.myTasks) });
    dispatch({ type: 'COMMIT_ROLLOVER', carryIds: carry });
  };

  return (
    <Overlay
      zIndex={60}
      background={color.paper}
      // No dismissal: the week has already turned, so there's nothing to go
      // back to. The only way out is to say what carries.
      onRequestClose={() => {}}
    >
      <View
        style={{
          paddingTop: Math.max(topInset, 20) + 16,
          paddingHorizontal: gutter,
          paddingBottom: 6,
        }}
      >
        <Caps size={10} tracking={1.9}>
          {weekLabel} is over
        </Caps>
        <Bri size={26} weight={800} tracking={-0.6} style={{ marginTop: 4 }}>
          {perfect
            ? 'You closed the whole thing.'
            : done.length
              ? `You closed ${done.length} of ${total}.`
              : 'That week didn’t land.'}
        </Bri>
        <Sans size={13} lineHeight={18} color={color.muted} style={{ marginTop: 6 }}>
          {points > 0
            ? `${points} pts banked. Pick anything you want to carry into ${to.label}.`
            : `Nothing banked. Pick anything worth another go in ${to.label}.`}
        </Sans>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 14, paddingHorizontal: gutter, paddingBottom: 12 }}
      >
        {open.length ? (
          <>
            <Caps size={11} tracking={1.4} style={{ marginHorizontal: 2, marginBottom: 9 }}>
              Carry into {to.label}
            </Caps>
            <View style={{ gap: 8 }}>
              {open.map((t) => {
                const on = carry.includes(t.id);
                return (
                  <Tap
                    key={t.id}
                    onPress={() => toggle(t.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`Carry ${t.title} into ${to.label}`}
                    style={[
                      {
                        ...row,
                        gap: 12,
                        backgroundColor: on ? color.askTint : color.card,
                        borderRadius: radius.row,
                        borderWidth: 1.5,
                        borderColor: on ? color.lime : 'transparent',
                        paddingVertical: 13,
                        paddingHorizontal: 14,
                      },
                      shadows.card,
                    ]}
                  >
                    <View
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 13,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: on ? color.lime : 'transparent',
                        ...(on
                          ? null
                          : { borderWidth: 2, borderStyle: 'dashed' as const, borderColor: color.dash }),
                      }}
                    >
                      {on ? <Icon name="check" size={14} color={color.ink} strokeWidth={3} /> : null}
                    </View>
                    <View style={fill}>
                      <Sans size={14.5} weight={600}>
                        {t.title}
                      </Sans>
                      <Sans size={11.5} color={color.muted}>
                        {t.cat}
                      </Sans>
                    </View>
                    <Bri size={13.5} weight={700} color={color.muted}>
                      +{t.pts}
                    </Bri>
                  </Tap>
                );
              })}
            </View>
          </>
        ) : (
          <Sans size={13} lineHeight={18} color={color.muted} style={{ textAlign: 'center', padding: 16 }}>
            {total
              ? 'Nothing left open. Clean slate either way.'
              : 'You didn’t stake anything. A clean slate then.'}
          </Sans>
        )}

        {done.length ? (
          <>
            <Caps size={11} tracking={1.4} style={{ marginHorizontal: 2, marginTop: 22, marginBottom: 9 }}>
              What you closed
            </Caps>
            <View style={{ gap: 7 }}>
              {done.map((t) => (
                <View
                  key={t.id}
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
                    {t.title}
                  </Sans>
                  <Bri size={13} weight={700} color={color.moss}>
                    +{t.pts}
                  </Bri>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      <View
        style={{
          paddingTop: 8,
          paddingHorizontal: gutter,
          paddingBottom: Math.max(bottomInset, 24) + 16,
        }}
      >
        <Tap
          onPress={commit}
          accessibilityLabel={`Start ${to.label}`}
          style={{
            minHeight: 54,
            borderRadius: 17,
            backgroundColor: color.lime,
            alignItems: 'center',
            justifyContent: 'center',
            ...shadows.doneCta,
          }}
        >
          <Bri size={16} weight={800}>
            {carry.length
              ? `Start ${to.label} with ${carry.length}`
              : `Start ${to.label} clean`}
          </Bri>
        </Tap>
      </View>
    </Overlay>
  );
}
