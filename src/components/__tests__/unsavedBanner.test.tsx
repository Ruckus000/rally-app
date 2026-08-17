/**
 * The notice that says a write is never going to reach the server, driven
 * through the same `UNSAVED` action the outbox subscription dispatches.
 *
 * The case that matters most is still the one that renders nothing: a person
 * whose week is syncing fine must never see this, and a count of zero is the
 * only thing standing between them and a permanent scare.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StoreProvider, useStore, type Action } from '../../state/store';
import { UnsavedBanner } from '../UnsavedBanner';
import { __resetOutboxForTests, deadLetters, drain, enqueue } from '../../sync/outbox';
import type { QueueTransport, SendOutcome } from '../../sync/outbox';

let dispatch: (a: Action) => void;

function Harness() {
  const store = useStore();
  React.useEffect(() => {
    dispatch = store.dispatch;
  }, [store.dispatch]);
  return <UnsavedBanner />;
}

/** `sync={false}` keeps the real subscription out: these tests drive it. */
const mount = () =>
  render(
    <StoreProvider persist={false} sync={false} restored={{ account: 'live' }}>
      <Harness />
    </StoreProvider>,
  );

const unsaved = (count: number) => act(() => dispatch({ type: 'UNSAVED', count }));

const banner = () => screen.queryByLabelText('Got it');

afterEach(() => {
  __resetOutboxForTests();
});

it('says nothing when everything the user wrote has saved', () => {
  mount();
  expect(banner()).toBeNull();

  unsaved(0);
  expect(banner()).toBeNull();
});

it('tells them, in rows rather than in retries', () => {
  mount();
  unsaved(1);

  expect(banner()).not.toBeNull();
  expect(screen.getByText(/One thing you wrote never saved/)).toBeTruthy();
  // Both halves matter: it is still here, and the server does not have it.
  expect(screen.getByText(/on this device/)).toBeTruthy();
  expect(screen.getByText(/server has no record/)).toBeTruthy();
});

it('counts up without turning into "1 things"', () => {
  mount();
  unsaved(3);
  expect(screen.getByText(/3 things you wrote never saved/)).toBeTruthy();
  expect(screen.getByText(/They’re on this device/)).toBeTruthy();
});

it('offers no retry, because permanent means permanent', () => {
  mount();
  unsaved(1);

  // A "Try again" here would be a button that cannot work: the server has
  // already answered, and it will answer the same way forever.
  expect(screen.queryByLabelText('Try again')).toBeNull();
  expect(screen.getByLabelText('Got it')).toBeTruthy();
});

it('acknowledging forgets the list rather than only hiding the notice', async () => {
  enqueue('task.upsert', 'task:abc', { title: 'Swim' });
  const refusing: QueueTransport = {
    ownerId: () => '11111111-1111-4111-8111-111111111111',
    async send(): Promise<SendOutcome> {
      return { ok: false, permanent: true, error: 'tasks_day_check' };
    },
  };
  await drain(refusing);
  expect(deadLetters()).toHaveLength(1);

  mount();
  unsaved(1);
  fireEvent.press(screen.getByLabelText('Got it'));

  // Hiding it alone would bring it straight back: the dead list rides along in
  // the outbox envelope, so the next launch would hydrate and re-announce it.
  await act(async () => {});
  expect(deadLetters()).toEqual([]);
});
