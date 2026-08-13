/**
 * What the notification feed promises.
 *
 * The footer used to say "Cheers batch into one." It does not: the trigger
 * writes a row per cheer, and grouping them by task and window is work nobody
 * has done. A screen claiming a behaviour the build lacks is the kind of thing
 * no test would ordinarily catch — so this one does.
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

describe('the notification feed', () => {
  it('shows who cheered what', () => {
    feed();

    expect(screen.getByText(/cheered “Morning walk”/)).toBeTruthy();
  });

  it('does not claim cheers are batched, because they are not', () => {
    feed();

    expect(screen.queryByText(/batch/i)).toBeNull();
  });
});
