/**
 * The banner, driven through the same `SESSION` action the sync layer dispatches
 * — so what is asserted is the path from "the server refused us" to something a
 * person can actually see, not a component handed a prop.
 *
 * The case that matters most here is the one that renders *nothing*.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StoreProvider, useStore, type Action } from '../../state/store';
import type { SessionState } from '../../sync/session';
import { SyncBanner } from '../SyncBanner';

let dispatch: (a: Action) => void;

function Harness() {
  const store = useStore();
  React.useEffect(() => {
    dispatch = store.dispatch;
  }, [store.dispatch]);
  return <SyncBanner />;
}

/** `sync={false}` keeps the real session effects out: these tests drive it. */
const mount = () =>
  render(
    <StoreProvider persist={false} sync={false} restored={{ account: 'live' }}>
      <Harness />
    </StoreProvider>,
  );

const session = (s: SessionState) => act(() => dispatch({ type: 'SESSION', session: s }));

/**
 * Asked of the one control the banner always draws, rather than of its
 * `accessibilityRole="alert"` container: a plain View is not an accessibility
 * element, so a role query would answer null whether the banner were there or
 * not — and every "shows nothing" case below would pass for the wrong reason.
 */
const banner = () => screen.queryByLabelText('Try again');

it('says nothing while the session is fine', () => {
  mount();
  expect(banner()).toBeNull();

  session({ status: 'ready', userId: '00000000-0000-4000-8000-00000000000b' });
  expect(banner()).toBeNull();
});

it('says nothing when the network is simply gone', () => {
  mount();
  session({ status: 'offline' });

  // Deliberate. Losing signal is the normal case and it already retries by
  // itself; a banner in every tunnel is one people stop reading, and then the
  // real one is invisible again — which is the bug, reintroduced by the fix.
  expect(banner()).toBeNull();

  session({ status: 'signing-in' });
  expect(banner()).toBeNull();
});

it('shows a rejected session, and both ways out', () => {
  mount();
  session({ status: 'expired' });

  expect(banner()).not.toBeNull();
  expect(screen.getByText(/signed out/)).toBeTruthy();
  // What the user needs to know first: nothing has been lost from this device.
  expect(screen.getByText(/safe here/)).toBeTruthy();
  expect(screen.getByLabelText('Try again')).toBeTruthy();
  expect(screen.getByLabelText('Start over')).toBeTruthy();
});

it('confirms before minting a new identity rather than doing it on one tap', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mount();
  session({ status: 'expired' });

  fireEvent.press(screen.getByLabelText('Start over'));

  // Whatever the old account owns on the server becomes unreachable the moment
  // this goes through — nothing else holds its id. So it asks, in those words.
  expect(alert).toHaveBeenCalled();
  expect(String(alert.mock.calls[0][1])).toMatch(/unreachable/);
  alert.mockRestore();
});

it('shows a misconfigured project its own message, with no start-over', () => {
  mount();
  session({ status: 'error', message: 'Anonymous sign-in is disabled on this project.' });

  expect(screen.getByText(/Anonymous sign-in is disabled/)).toBeTruthy();
  expect(screen.getByLabelText('Try again')).toBeTruthy();
  // A new identity cannot fix a project that refuses to mint one.
  expect(screen.queryByLabelText('Start over')).toBeNull();
});
