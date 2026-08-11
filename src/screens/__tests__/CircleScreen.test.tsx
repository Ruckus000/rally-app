/**
 * The circle, once the people in it are real rows rather than fixtures.
 *
 * A live member arrives from `profiles`, which carries a name and nothing else.
 * What this file pins down is what the screen says about a week it has not got:
 * the demo circle ships stats with every person, so every rendering path here
 * was previously exercised only against numbers that always existed.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { StoreProvider } from '../../state/store';
import { indexPeople, personOf } from '../../data/people';
import { CircleScreen } from '../CircleScreen';

const ME = '11111111-1111-4111-8111-111111111111';
const uuid = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n.toString().repeat(12)}`;

/** Four, because three or fewer is all podium and never renders a list row. */
const live = () =>
  render(
    <StoreProvider
      persist={false}
      sync={false}
      restored={{
        account: 'live',
        selfId: ME,
        people: indexPeople([
          personOf(ME, 'Alex Rivera'),
          personOf(uuid(2), 'Maya Chen'),
          personOf(uuid(3), 'Nia Okafor'),
          personOf(uuid(4), 'Sofia Park'),
        ]),
      }}
    >
      <CircleScreen />
    </StoreProvider>,
  );

it('ranks the people the pull actually found', () => {
  live();
  // The podium shows first names, the list below shows full ones.
  expect(screen.getByText('Alex')).toBeTruthy();
  expect(screen.getByText('Maya')).toBeTruthy();
  expect(screen.getByText('Sofia Park')).toBeTruthy();
  // Not the demo circle leaking in through a fixture-shaped default.
  expect(screen.queryByText('Dre Okafor')).toBeNull();
});

it('says a member’s week is unknown rather than showing it as a zero', () => {
  live();
  // Nothing pulls `week_rollups` yet, so "0% · 0 of 0" would be an invention
  // about Sofia — a week in which she staked nothing and closed nothing.
  expect(screen.getByText('No week synced yet')).toBeTruthy();
  expect(screen.queryByText('0% · 0 of 0')).toBeNull();
  // …and the cheers chip says the same thing rather than a confident 0.
  expect(screen.getAllByText('– given').length).toBeGreaterThan(0);
});

it('puts you first, because yours is the only week it can vouch for', () => {
  live();
  // Not a claim that you are winning: an unknown week sorts below every real
  // score, including a real zero, rather than tying with one.
  expect(screen.getByLabelText(/Alex Rivera, rank 1/)).toBeTruthy();
  expect(screen.getByLabelText(/Sofia Park, rank 4, No week synced yet/)).toBeTruthy();
});
