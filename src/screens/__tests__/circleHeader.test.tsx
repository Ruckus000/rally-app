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

/**
 * The bell, and the two places that used to read the demo world on a live
 * account: the badge count and "mark all read".
 */
describe('the notification bell', () => {
  const needsYou = (id: string) => ({
    id,
    tier: 'needs' as const,
    kind: 'cheer' as const,
    text: 'cheered your task',
    time: '1h ago',
  });

  it('badges a live account’s own notifications', () => {
    render(
      <StoreProvider
        persist={false}
        sync={false}
        restored={{ account: 'live', selfId: ME, tab: 'circle', notifications: [needsYou('n1')] }}
      >
        <Header topInset={0} />
      </StoreProvider>,
    );

    // `world.notifications` is empty on live, so the badge was permanently dark
    // however many rows the server held.
    expect(screen.getByLabelText('Notifications, 1 needing you')).toBeTruthy();
  });

  it('still badges the demo, whose feed is a fixture — the control', () => {
    render(
      <StoreProvider persist={false} sync={false} restored={{ account: 'seeded', tab: 'circle' }}>
        <Header topInset={0} />
      </StoreProvider>,
    );

    expect(screen.getByLabelText(/Notifications, \d+ needing you/)).toBeTruthy();
  });
});

/**
 * What names your circles under your own name, on the Me tab.
 *
 * Deliberately no handle on the 2+ rung. A live handle is `anon_6e8dd5641ace`,
 * which `MeScreen` decided once already was machine noise rather than an
 * identity — and that is as true beside a count as beside a name.
 */
describe('the Me subtitle ladder', () => {
  const A = { id: 'c-a', name: 'The Basement', inviteCode: 'basement-aaaa' };
  const B = { id: 'c-b', name: 'Gym', inviteCode: 'gym-bbbb' };

  const meTab = (circles: (typeof A)[]) =>
    render(
      <StoreProvider
        persist={false}
        sync={false}
        restored={{
          account: 'live',
          selfId: ME,
          tab: 'me',
          circles,
          people: indexPeople([personOf(ME, 'Maya Chen')]),
        }}
      >
        <Header topInset={0} />
      </StoreProvider>,
    );

  it('names the circle when there is one', () => {
    meTab([A]);
    expect(screen.getByText('The Basement')).toBeTruthy();
  });

  it('counts them when there is more than one, without naming any', () => {
    meTab([A, B]);
    expect(screen.getByText('2 circles')).toBeTruthy();
    // Naming one of several would imply the others are somewhere else.
    expect(screen.queryByText('The Basement')).toBeNull();
  });

  it('falls back to the header\'s own line when there are none', () => {
    meTab([]);
    expect(screen.getByText('Your week, on the record')).toBeTruthy();
  });
});
