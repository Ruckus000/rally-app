/**
 * Step 5 promises what cheers do. Until push exists, that is "they wait in the
 * app", not "they arrive the moment you close a task" — the second is a
 * lock-screen claim, and nothing here reaches a locked phone.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { NotificationsScreen } from '../NotificationsScreen';

const show = () =>
  render(
    <NotificationsScreen
      stakeSum={35}
      hasPicks
      weekNumber={33}
      onAllow={() => {}}
      onLater={() => {}}
    />,
  );

describe('the notifications step', () => {
  it('does not promise a cheer arrives the moment you close a task', () => {
    show();

    expect(screen.queryByText(/right when you close/i)).toBeNull();
    expect(screen.getByText(/waiting when you open Rally/)).toBeTruthy();
  });
});
