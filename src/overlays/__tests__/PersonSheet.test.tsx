/**
 * Whose week the person sheet is actually showing.
 *
 * It read `PERSON_TASKS` — a fixture keyed by the demo's people — so for every
 * *real* friend it drew a caps label over nothing, beneath a line claiming
 * "0/0 this week". Their rows were on the device the whole time: the feed is
 * drawn from the same slice. These tests pin the sheet to that slice, and pin
 * the two things a fixture-shaped screen got wrong — the silent empty, and the
 * zero that was really an absence.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { StoreProvider } from '../../state/store';
import { DetailSheet } from '../DetailSheet';
import type { Moment } from '../../data/fixtures';
import type { PersonId } from '../../data/people';

const ME = '11111111-1111-4111-8111-111111111111' as PersonId;
const MAYA = '22222222-2222-4222-8222-222222222222' as PersonId;

const stake = (over: Partial<Moment> = {}): Moment => ({
  id: 'm1',
  who: MAYA,
  kind: 'normal',
  time: '2h',
  day: 2,
  title: 'Swim 2k',
  pts: 40,
  cat: 'Fitness',
  ...over,
});

const sheet = (moments: Moment[]) =>
  render(
    <StoreProvider
      persist={false}
      sync={false}
      restored={{
        account: 'live',
        selfId: ME,
        people: {
          [ME]: { id: ME, name: 'You', first: 'You', initials: 'Y', tintIndex: 0 },
          [MAYA]: { id: MAYA, name: 'Maya Chen', first: 'Maya', initials: 'MC', tintIndex: 1 },
        },
        moments,
        sheet: { type: 'person', id: MAYA },
      }}
    >
      <DetailSheet bottomInset={0} />
    </StoreProvider>,
  );

describe('a real friend’s sheet', () => {
  it('shows the week the feed already knows about', () => {
    sheet([stake()]);
    expect(screen.getByText('Swim 2k')).toBeTruthy();
    // The day and the price, which is what makes it a week rather than a list.
    expect(screen.getByText(/Wednesday/)).toBeTruthy();
  });

  it('offers to back it under the row it belongs to', () => {
    sheet([stake()]);
    // Open, so the offer is to back it rather than to cheer it.
    expect(screen.getByLabelText('Back Swim 2k')).toBeTruthy();
  });

  it('says a closed one is closed, and offers a cheer instead', () => {
    sheet([stake({ done: true })]);
    expect(screen.getByLabelText('Cheer Swim 2k')).toBeTruthy();
  });

  it('writes out the empty rather than heading a blank space', () => {
    sheet([]);
    expect(screen.getByText(/Nothing of theirs has landed here yet/)).toBeTruthy();
  });

  it('claims no score for a week it has never seen', () => {
    // "0/0 this week" is not a fact about somebody — it is the absence of one,
    // and it read as a person who staked nothing and closed nothing.
    sheet([]);
    expect(screen.queryByText(/0\/0 this week/)).toBeNull();
  });
});
