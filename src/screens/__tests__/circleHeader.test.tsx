/**
 * How many people the Circle header says are in your circle.
 *
 * It used to count `world.members`, and the world a *live* account gets is the
 * `FRESH` fixture — one element, always. So it read "1 people" for a circle of
 * two, and would have read it for eight. The demo cases below are the control:
 * they pass with the old code too, which is what makes them worth keeping.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { StoreProvider } from '../../state/store';
import { indexPeople, personOf } from '../../data/people';
import { Header } from '../../shell/Header';

const ME = '11111111-1111-4111-8111-111111111111';
const DRE = '22222222-2222-4222-8222-222222222222';

const live = (...people: string[]) =>
  render(
    <StoreProvider
      persist={false}
      sync={false}
      restored={{
        account: 'live',
        selfId: ME,
        tab: 'circle',
        people: indexPeople(people.map((id) => personOf(id, id === ME ? 'Maya Chen' : 'Dre Okafor'))),
      }}
    >
      <Header topInset={0} />
    </StoreProvider>,
  );

describe('the circle header count', () => {
  it('counts the people who are actually in the circle', () => {
    live(ME, DRE);

    expect(screen.getByText('2 people, ranked by follow-through')).toBeTruthy();
  });

  it('says "person" when the circle is just you', () => {
    // The plural was wrong independently of the count: a circle of one read
    // "1 people" even on the demo, where the count had always been right.
    live(ME);

    expect(screen.getByText('1 person, ranked by follow-through')).toBeTruthy();
  });

  it('still counts the demo circle, which never went through the server', () => {
    render(
      <StoreProvider persist={false} sync={false} restored={{ account: 'seeded', tab: 'circle' }}>
        <Header topInset={0} />
      </StoreProvider>,
    );

    expect(screen.getByText('7 people, ranked by follow-through')).toBeTruthy();
  });
});
