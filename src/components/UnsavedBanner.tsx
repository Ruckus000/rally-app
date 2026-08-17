/**
 * Says that something the user wrote is never going to reach the server.
 *
 * The queue moves an entry to its dead list when the server refuses it in a way
 * no retry can fix, and the reducer is deliberately never rolled back for one —
 * deleting the task somebody is looking at because a constraint disliked it
 * would be worse than the two copies disagreeing. So the row keeps rendering,
 * and until now the disagreement was permanent and completely silent: gone on
 * reinstall, absent on a second device, never mentioned.
 *
 * There is nothing to retry — permanent means permanent — so the only honest
 * affordance is to acknowledge it. `Got it` forgets the list, which costs
 * nothing: the entry is diagnostic and the row itself is untouched. Without it
 * the notice would stand for the life of the install, because the dead list
 * rides along in the outbox envelope across relaunches.
 */
import React from 'react';
import { Banner, BannerAction } from './Banner';
import { useStore } from '../state/store';
import { forgetDeadLetters } from '../sync/outbox';

/**
 * Counted in rows, not attempts — `unsavedCount()` is distinct by key. The word
 * is "things" rather than "tasks" because a refused write can also be a note, a
 * reaction or your display name.
 */
function line(count: number): string {
  return count === 1
    ? 'One thing you wrote never saved. It’s on this device, but the server has no record of it.'
    : `${count} things you wrote never saved. They’re on this device, but the server has no record of them.`;
}

export function UnsavedBanner() {
  const { state } = useStore();
  if (state.unsaved === 0) return null;

  return (
    <Banner message={line(state.unsaved)}>
      <BannerAction label="Got it" onPress={() => void forgetDeadLetters()} />
    </Banner>
  );
}
