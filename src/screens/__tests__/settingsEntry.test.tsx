/**
 * The row that makes the page exist as far as anyone using the app is
 * concerned. An overlay nothing opens is an overlay nobody has.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StoreProvider, useStore } from '../../state/store';
import { MeScreen } from '../MeScreen';

let settingsOpen = false;

function Harness() {
  const { state } = useStore();
  React.useEffect(() => {
    settingsOpen = state.settingsOpen;
  }, [state.settingsOpen]);
  return <MeScreen />;
}

const mount = (account: 'live' | 'seeded') =>
  render(
    <StoreProvider persist={false} sync={false} restored={{ account }}>
      <Harness />
    </StoreProvider>,
  );

describe('the settings row on Me', () => {
  it('is there for a live account', () => {
    mount('live');
    expect(screen.getByLabelText('Settings')).toBeTruthy();
  });

  it('is there for the demo too — the page says which mode this is', () => {
    mount('seeded');
    expect(screen.getByLabelText('Settings')).toBeTruthy();
  });

  it('opens settings', () => {
    mount('live');
    fireEvent.press(screen.getByLabelText('Settings'));
    expect(settingsOpen).toBe(true);
  });
});
