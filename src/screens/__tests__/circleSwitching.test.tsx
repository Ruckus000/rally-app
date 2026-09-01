/**
 * The Circle tab once there is more than one circle to be about.
 *
 * Two things here are regressions waiting to happen rather than features. The
 * podium has to follow the switcher — the memo that computes it reads
 * `activeCircleId`, and a dep list that forgot it would draw the previous
 * circle's people under the new circle's chip with no error and no visual tell.
 * And the empty states have to be asked in the right order, because with no
 * circles the ranking falls back to the whole directory, which for a live
 * account is you alone — so "a circle of one" is true of all three cases and
 * correct for only one of them.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { StoreProvider } from '../../state/store';
import { indexPeople, personOf, type PersonId } from '../../data/people';
import { CircleScreen } from '../CircleScreen';

const ME = '11111111-1111-4111-8111-111111111111' as PersonId;
const uuid = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n.toString().repeat(12)}`;

const A = { id: uuid(7), name: 'The Basement', inviteCode: 'basement-aaaa' };
const B = { id: uuid(8), name: 'Gym', inviteCode: 'gym-bbbb' };

const RAE = uuid(2) as PersonId;
const SAM = uuid(3) as PersonId;
const KIT = uuid(4) as PersonId;

/** Four people across two circles, so each room ranks a different pair. */
const peopleIn = () =>
  indexPeople([
    { ...personOf(ME, 'Alex Rivera'), circleIds: [A.id, B.id] },
    { ...personOf(RAE, 'Rae Silva'), circleIds: [A.id] },
    { ...personOf(SAM, 'Sam Cole'), circleIds: [A.id] },
    { ...personOf(KIT, 'Kit Nakamura'), circleIds: [B.id] },
  ]);

const draw = (restored: Record<string, unknown>) =>
  render(
    <StoreProvider persist={false} sync={false} restored={restored as never}>
      <CircleScreen />
    </StoreProvider>,
  );

const inBoth = {
  account: 'live',
  selfId: ME,
  worldSeen: true,
  circles: [A, B],
  activeCircleId: A.id,
  people: peopleIn(),
};

it('switches which room the podium is about', () => {
  // The dep-list regression guard. `Kit` is only in Gym, `Rae` only in the
  // Basement, so each name is proof the other circle is not being drawn.
  draw(inBoth);
  expect(screen.getByText('Rae')).toBeTruthy();
  expect(screen.queryByText('Kit')).toBeNull();

  fireEvent.press(screen.getByText('Gym'));
  expect(screen.getByText('Kit')).toBeTruthy();
  expect(screen.queryByText('Rae')).toBeNull();
});

it('shows the other circles even while standing in an empty one', () => {
  // The bug this slice exists to fix. The "A circle of one" state used to
  // return before anything else rendered, so somebody in three circles whose
  // active one was empty had no way to reach the other two.
  draw({
    ...inBoth,
    activeCircleId: B.id,
    people: indexPeople([
      { ...personOf(ME, 'Alex Rivera'), circleIds: [A.id, B.id] },
      { ...personOf(RAE, 'Rae Silva'), circleIds: [A.id] },
    ]),
  });

  expect(screen.getByText('A circle of one')).toBeTruthy();
  expect(screen.getByText('The Basement')).toBeTruthy();
  expect(screen.getByText('Gym')).toBeTruthy();
});

it('says nobody has answered yet before it says you are in none', () => {
  draw({ ...inBoth, circles: [], activeCircleId: null, worldSeen: false });
  expect(screen.getByText('One moment')).toBeTruthy();
  expect(screen.queryByText('No circle yet')).toBeNull();
  expect(screen.queryByText('A circle of one')).toBeNull();
});

it('offers a way in once the pull has answered that there is none', () => {
  draw({ ...inBoth, circles: [], activeCircleId: null, worldSeen: true });
  expect(screen.getByText('No circle yet')).toBeTruthy();
  expect(screen.getByText('Join or start a circle')).toBeTruthy();
  // Not the one that would be a lie about a person with nobody at all.
  expect(screen.queryByText('One moment')).toBeNull();
});

it('leaves the seeded demo alone', () => {
  // Every demo mode carries `circles: []` with `worldSeen: true` by
  // construction, so a branch that forgot to ask whether the account is live
  // would blank the first screen anybody sees.
  draw({ account: 'seeded' });
  expect(screen.queryByText('No circle yet')).toBeNull();
  expect(screen.queryByText('One moment')).toBeNull();
  expect(screen.getByText('Top performers this week')).toBeTruthy();
});
