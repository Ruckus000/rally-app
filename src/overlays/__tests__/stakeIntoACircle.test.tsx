/**
 * Choosing which circle a goal is staked in, from the composer.
 *
 * SEEN BY absorbed the circle rather than growing a control beside it. Two
 * controls could express "staked in Gym, seen by Private" — a sentence with a
 * dead clause, since a private goal is gated on pairing and never reaches a
 * room at all. One control keeps the ladder reading narrow to wide, with the
 * narrow end wearing a proper noun.
 *
 * The load-bearing behaviour is that a one-circle account never meets a picker:
 * tapping the slot that is already the answer has to do nothing, or the
 * composer grew a dead end for everybody the feature does not apply to.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { StoreProvider } from '../../state/store';
import { indexPeople, personOf, type PersonId } from '../../data/people';
import { PlanOverlay } from '../PlanOverlay';

const ME = '11111111-1111-4111-8111-111111111111' as PersonId;
const A = { id: 'c-a', name: 'The Basement', inviteCode: 'basement-aaaa' };
const B = { id: 'c-b', name: 'Wednesday Morning Riders', inviteCode: 'gym-bbbb' };

const composer = (over: Record<string, unknown> = {}) =>
  render(
    <StoreProvider
      persist={false}
      sync={false}
      restored={
        {
          account: 'live',
          selfId: ME,
          planOpen: true,
          worldSeen: true,
          circles: [A, B],
          activeCircleId: A.id,
          people: indexPeople([personOf(ME, 'Maya Chen')]),
          ...over,
        } as never
      }
    >
      <PlanOverlay topInset={0} bottomInset={0} />
    </StoreProvider>,
  );

it('wears the circle name where the word "Friends" used to be', () => {
  composer();
  expect(screen.getByLabelText('Seen by The Basement. Change circle.')).toBeTruthy();
  expect(screen.queryByLabelText('Seen by Friends')).toBeNull();
});

it('opens a picker only from the slot that is already the answer', () => {
  composer();
  // Everyone is not selected, so tapping it selects rather than asks again.
  fireEvent.press(screen.getByLabelText('Seen by Everyone'));
  expect(screen.queryByLabelText(`Stake it in ${B.name}`)).toBeNull();
});

it('never opens anything for somebody with one circle', () => {
  // The whole reason the gesture is "tap the selected slot" rather than a
  // separate control: at one circle this tap is inert, and the composer looks
  // exactly as it did before the feature.
  composer({ circles: [A] });
  const slot = screen.getByLabelText('Seen by The Basement');
  fireEvent.press(slot);
  expect(screen.queryByLabelText(`Stake it in ${A.name}`)).toBeNull();
  // And it is still a radio, not a disclosure.
  expect(slot.props.accessibilityRole).toBe('radio');
});

it('moves the composer to the circle picked', () => {
  composer();
  fireEvent.press(screen.getByLabelText('Seen by The Basement. Change circle.'));
  fireEvent.press(screen.getByLabelText(`Stake it in ${B.name}`));

  expect(screen.getByLabelText(`Seen by ${B.name}. Change circle.`)).toBeTruthy();
  // The picker closes behind the choice.
  expect(screen.queryByLabelText(`Stake it in ${B.name}`)).toBeNull();
});

it('says what "everyone" costs the circle, and what "private" does not', () => {
  composer();
  fireEvent.press(screen.getByLabelText('Seen by Everyone'));
  expect(screen.getByText('Everyone can see it. It still counts for The Basement.')).toBeTruthy();

  fireEvent.press(screen.getByLabelText('Seen by Private'));
  // "Only you." and nothing about counting: a private goal is gated on
  // `is_paired_on`, not the circle, so a "counts for" clause would be a
  // promise the server does not keep.
  expect(screen.getByText('Only you.')).toBeTruthy();
  expect(screen.queryByText(/still counts for/)).toBeNull();
});

it('stays quiet at one circle, where there is nothing to disambiguate', () => {
  composer({ circles: [A] });
  fireEvent.press(screen.getByLabelText('Seen by Everyone'));
  expect(screen.queryByText(/still counts for/)).toBeNull();
});

it('tells somebody in no circle that this one stays with them', () => {
  // Which is true, and the server agrees: a `friends` goal with no circle is
  // owner-only. The composer used to say nothing about it at all.
  composer({ circles: [], activeCircleId: null });
  expect(screen.getByText('You’re not in a circle yet, so this one stays with you.')).toBeTruthy();
});
