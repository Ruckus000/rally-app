/**
 * The dead list, finally read by something.
 *
 * An entry lands there when the server refuses it in a way no retry can fix,
 * and the reducer is deliberately never rolled back for one — so the row stays
 * on screen while the server has never heard of it. `deadLetters()` was
 * exported and commented "kept so a debug screen can say what went wrong", and
 * for the life of the queue nothing outside a test ever called it.
 *
 * These tests are the proof that it now has a caller, and that the caller draws
 * what the queue actually gave up on rather than a hardcoded string.
 *
 * Note the order they have to run in. Choosing an account fires the store's
 * `lastAccount` effect, which calls `clearOutbox()` — and that empties the dead
 * list along with the queue. So the refusals have to be staged *after* the demo
 * account has been granted, which is also how it would happen on a real device.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../../App';
import { captureBackPress } from '../../test/backPress';
import {
  __resetOutboxForTests,
  drain,
  enqueue,
  type QueueTransport,
  type SendOutcome,
} from '../../sync/outbox';

const OWNER = '11111111-1111-4111-8111-111111111111';

/** Answers the way a check constraint does: never, for this row, ever again. */
const refuses = (error: string): QueueTransport => ({
  ownerId: () => OWNER,
  async send(): Promise<SendOutcome> {
    return { ok: false, permanent: true, error };
  },
});

let back: ReturnType<typeof captureBackPress>;

beforeEach(async () => {
  back = captureBackPress();
  __resetOutboxForTests();
  await AsyncStorage.clear();
});

afterEach(() => {
  back.restore();
  __resetOutboxForTests();
});

/** The demo account, then straight to the profile screen the readout lives on. */
const openMe = () => {
  render(<App persist={false} />);
  fireEvent.press(screen.getByLabelText('Look around first'));
  back.press();
  back.press();
  fireEvent.press(screen.getByLabelText('Me'));
};

/**
 * The readout reads module state rather than subscribing to it, so it shows
 * what was there at the last render. Leaving and returning is how a person
 * would see a fresh answer, and asserting through that rather than around it
 * keeps the test honest about what was built.
 */
const reopenMe = () => {
  fireEvent.press(screen.getByLabelText('Week'));
  fireEvent.press(screen.getByLabelText('Me'));
};

it('draws nothing at all when the queue has given up on nothing', () => {
  openMe();
  expect(screen.queryByText(/Never sent/)).toBeNull();
});

it('names what was refused, and what the server said about it', async () => {
  openMe();

  enqueue('task.upsert', 'task:abc', {
    task: { id: 'abc', title: 'Swim' },
    weekStart: '2026-08-10',
  });
  const stats = await drain(refuses('tasks_day_check'));

  // Precondition, asserted rather than assumed: `drop` is what puts an entry in
  // the dead list, and a test that silently drained empty would pass below for
  // the wrong reason.
  expect(stats.dead).toBe(1);

  reopenMe();

  expect(screen.getByText(/Never sent · 1/)).toBeTruthy();
  // The op and the key say which row, and the error says why — all three are
  // what a debug screen exists to answer.
  expect(screen.getByText(/task\.upsert task:abc — tasks_day_check/)).toBeTruthy();
});

it('lists every entry the queue dropped, not just the first', async () => {
  openMe();

  enqueue('task.upsert', 'task:one', { task: { id: 'one' }, weekStart: '2026-08-10' });
  enqueue('task.upsert', 'task:two', { task: { id: 'two' }, weekStart: '2026-08-10' });
  const stats = await drain(refuses('22P02'));

  // `drop` deliberately continues rather than breaking, so one bad row does not
  // hide the ones behind it — and neither should the readout.
  expect(stats.dead).toBe(2);

  reopenMe();

  expect(screen.getByText(/Never sent · 2/)).toBeTruthy();
  expect(screen.getByText(/task:one/)).toBeTruthy();
  expect(screen.getByText(/task:two/)).toBeTruthy();
});
