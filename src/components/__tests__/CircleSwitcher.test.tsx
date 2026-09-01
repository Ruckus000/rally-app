/**
 * The chip row, on its own.
 *
 * Tested away from the screen because the behaviour most worth pinning is the
 * one where it renders *nothing* — and asserting that through `CircleScreen`
 * would mean standing up a store and a ranking to prove an absence.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { CircleSwitcher } from '../CircleSwitcher';

const A = { id: 'c-a', name: 'The Basement', inviteCode: 'basement-aaaa' };
const B = { id: 'c-b', name: 'Gym', inviteCode: 'gym-bbbb' };

const draw = (circles: (typeof A)[], activeId: string | null, on = { select: jest.fn(), add: jest.fn() }) => {
  const r = render(
    <CircleSwitcher circles={circles} activeId={activeId} onSelect={on.select} onAdd={on.add} />,
  );
  return { ...r, ...on };
};

it('draws nothing at all below two circles', () => {
  // The whole point of the gate: an account matching the prototype's world
  // sees the prototype's screen, with no chrome the handoff never drew.
  expect(draw([], null).toJSON()).toBeNull();
  expect(draw([A], A.id).toJSON()).toBeNull();
});

it('names every circle, and offers a way to another', () => {
  draw([A, B], A.id);
  expect(screen.getByText('The Basement')).toBeTruthy();
  expect(screen.getByText('Gym')).toBeTruthy();
  expect(screen.getByLabelText('Join or start another circle')).toBeTruthy();
});

it('marks exactly the active one, by the resolved id rather than the preference', () => {
  draw([A, B], B.id);
  const chips = screen.getAllByRole('tab');
  const selected = chips.filter((c) => c.props.accessibilityState?.selected);
  expect(selected).toHaveLength(1);
  expect(selected[0]).toHaveTextContent('Gym');
});

it('reports which circle was tapped', () => {
  const { select } = draw([A, B], A.id);
  fireEvent.press(screen.getByText('Gym'));
  expect(select).toHaveBeenCalledWith(B.id);
});

it('still reports a tap on the circle already showing', () => {
  // The reducer owns the no-op — `SET_ACTIVE_CIRCLE` returns the same state for
  // an unchanged id. A component that also decided this would be a second
  // opinion about the same question.
  const { select } = draw([A, B], A.id);
  fireEvent.press(screen.getByText('The Basement'));
  expect(select).toHaveBeenCalledWith(A.id);
});

it('keeps the door separate from the rooms', () => {
  const { select, add } = draw([A, B], A.id);
  fireEvent.press(screen.getByLabelText('Join or start another circle'));
  expect(add).toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});
