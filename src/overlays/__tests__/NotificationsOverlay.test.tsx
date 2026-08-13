/**
 * What the notification feed promises, and whether it keeps it.
 *
 * The footer said "Cheers batch into one" before anything did — so the claim
 * was removed, and now that `batchCheers` groups them it is back. The test
 * moved with it: it no longer asserts the words are absent, it asserts the
 * behaviour they describe, which is the only version worth having.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { StoreProvider } from '../../state/store';
import { NotificationsOverlay } from '../NotificationsOverlay';

const ME = '11111111-1111-4111-8111-111111111111';

const feed = () =>
  render(
    <StoreProvider
      persist={false}
      sync={false}
      restored={{
        account: 'live',
        selfId: ME,
        notifOpen: true,
        notifications: [
          {
            id: 'n1',
            tier: 'circle',
            kind: 'cheer',
            name: 'Dre Okafor',
            text: 'cheered “Morning walk”',
            time: '1h ago',
          },
        ],
      }}
    >
      <NotificationsOverlay topInset={0} />
    </StoreProvider>,
  );

/** What the engine hands the overlay once `batchCheers` has run. */
const batched = () =>
  render(
    <StoreProvider
      persist={false}
      sync={false}
      restored={{
        account: 'live',
        selfId: ME,
        notifOpen: true,
        notifications: [
          {
            id: 'cheer:task-1:n2',
            tier: 'circle',
            kind: 'cheer',
            name: 'Dre and Maya',
            faces: ['dre', 'maya'],
            text: 'cheered “Morning walk”',
            time: '1h ago',
            sheetId: 'task-1',
          },
        ],
      }}
    >
      <NotificationsOverlay topInset={0} />
    </StoreProvider>,
  );

describe('the notification feed', () => {
  it('shows who cheered what', () => {
    feed();

    expect(screen.getByText(/cheered “Morning walk”/)).toBeTruthy();
  });

  it('shows several cheers on one task as a single row', () => {
    batched();

    // The claim in the footer, held to. Two people, one line, one avatar stack.
    expect(screen.getByText(/Dre and Maya/)).toBeTruthy();
    expect(screen.queryAllByText(/cheered “Morning walk”/)).toHaveLength(1);
  });
});
