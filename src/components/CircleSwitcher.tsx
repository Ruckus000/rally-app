/**
 * The row of chips that says which circle the Circle tab is about.
 *
 * Absent below two circles, and the gate lives in here rather than at the call
 * site so there is one condition instead of two that can drift. An account with
 * one circle sees exactly the screen HANDOFF §2 draws — podium, caps label,
 * list, total, invite — with nothing above the podium at all. The row is what
 * the second circle buys. Ratified deviation — see design-reference/DEVIATIONS.md.
 *
 * Not the Header's scope segment, which was the other obvious home. That
 * control gives each tab `flex: 1`, and five circles is five 78px columns
 * holding names people chose. This scrolls, and a chip is as wide as its name.
 *
 * The chips are `NotificationsOverlay`'s, at 44 rather than 40 — the handoff's
 * floor for a target you hit rather than read. Two things are deliberately not
 * copied. The horizontal padding is negative here, because that row is a child
 * of a full-bleed overlay and this one sits inside a ScrollView that already
 * pads by the gutter; copied straight across it would be inset twice and clip
 * short of both edges. And there is no count badge: over there the counts come
 * off an array already in hand, where a member count per chip is a walk of the
 * whole directory per circle, on every render of a row that exists to be
 * glanced at.
 */
import React from 'react';
import { ScrollView, View } from 'react-native';
import { gutter, onDark } from '../theme/tokens';
import { useColors } from '../theme/ThemeProvider';
import { Sans, Tap, row } from './primitives';
import type { CircleRef } from '../state/store';

export function CircleSwitcher({
  circles,
  activeId,
  onSelect,
  onAdd,
}: {
  /** `state.circles`, in the order the pull hands them over: oldest first. */
  circles: CircleRef[];
  /** The *resolved* id — `activeCircle(state)?.id`, not the raw preference. */
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Join one with a code, or start another. */
  onAdd: () => void;
}) {
  const color = useColors();
  if (circles.length < 2) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0, marginHorizontal: -gutter }}
      contentContainerStyle={{ gap: 7, paddingTop: 2, paddingBottom: 12, paddingHorizontal: gutter }}
    >
      {circles.map((c) => {
        const on = c.id === activeId;
        return (
          <Tap
            key={c.id}
            onPress={() => onSelect(c.id)}
            // `tab`, matching the Header's scope control, because this is the
            // same kind of control: one of several rooms, one of them current.
            // `Tap` defaults to `button`, so it has to be said.
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{
              ...row,
              borderRadius: 999,
              paddingHorizontal: 13,
              paddingVertical: 8,
              minHeight: 44,
              borderWidth: on ? 0 : 1,
              borderColor: color.divider,
              backgroundColor: on ? color.ink : color.card,
            }}
          >
            <Sans
              size={12.5}
              weight={700}
              numberOfLines={1}
              color={on ? onDark.primary : color.avatarText}
            >
              {c.name}
            </Sans>
          </Tap>
        );
      })}
      {/* Last, and never selected: it is a door rather than a room. */}
      <Tap
        onPress={onAdd}
        accessibilityLabel="Join or start another circle"
        style={{
          ...row,
          borderRadius: 999,
          paddingHorizontal: 13,
          paddingVertical: 8,
          minHeight: 44,
          borderWidth: 1,
          borderColor: color.divider,
          backgroundColor: color.card,
        }}
      >
        <Sans size={12.5} weight={700} color={color.muted}>
          + Join or start
        </Sans>
      </Tap>
      <View style={{ width: 2 }} />
    </ScrollView>
  );
}
