/**
 * The engine, from outside: a real provider, a real reducer, the real outbox
 * and the strict in-memory Supabase. Nothing here mocks the seam under test —
 * what is being asserted is that a tap ends up as a row, that a row coming back
 * does not turn into a tap, and that neither of those depends on the network
 * being there at the moment it happened.
 *
 * Fake timers throughout, because the whole file is about *when*: the queue's
 * own logic has no clock and is tested on real time in `outbox.test.ts`.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { fakeSupabase } from '../../__mocks__/@supabase/supabase-js';
import { Action, StoreProvider, useStore } from '../../state/store';
import { mondayOf } from '../mappers';
import { __resetOutboxForTests, deadLetters, pending } from '../outbox';
import { __resetSessionForTests, currentUserId } from '../session';

const OTHER = '22222222-2222-4222-8222-222222222222';
const CIRCLE = '33333333-3333-4333-8333-333333333333';

let dispatch: React.Dispatch<Action>;

function Probe() {
  const store = useStore();
  // The test drives the app through the same dispatch the screens get, so that
  // what is under test is a tap and not a hand-built outbox entry.
  React.useEffect(() => {
    dispatch = store.dispatch;
  }, [store.dispatch]);
  return (
    <>
      <Text testID="people">{Object.keys(store.state.people).sort().join(',')}</Text>
      <Text testID="tasks">{store.state.myTasks.map((t) => t.title).join(',')}</Text>
      {/* The week the pull has to name. Read off state so the assertion below
          cannot drift from what the engine actually asked for. */}
      <Text testID="week">{mondayOf(store.state.week)}</Text>
    </>
  );
}

/** `account: 'live'` is what opens the gate; everything else is default. */
const mount = (account: 'live' | 'seeded' = 'live') =>
  render(
    <StoreProvider persist sync restored={{ account }}>
      <Probe />
    </StoreProvider>,
  );

const settle = async (ms = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

const stake = (title: string) => {
  act(() => dispatch({ type: 'SET_DRAFT', value: title }));
  act(() => dispatch({ type: 'ADD_TASK', aud: 'friends' }));
};

const upserts = () =>
  fakeSupabase.calls.filter((c) => c.table === 'tasks' && c.method === 'upsert');

const titles = () => fakeSupabase.rows('tasks').map((r) => r.title);

const realEnv = { ...process.env };

beforeEach(() => {
  jest.useFakeTimers();
  // Jest never loads .env, and `hasSupabaseConfig()` is half of the gate —
  // without these every assertion below would pass because sync was off.
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  fakeSupabase.reset();
  __resetOutboxForTests();
  __resetSessionForTests();
});

afterEach(() => {
  jest.useRealTimers();
  process.env = { ...realEnv };
});

it('sends a stake made offline, once, after the network comes back', async () => {
  mount();
  await settle();
  expect(currentUserId()).not.toBeNull();

  fakeSupabase.goOffline();
  stake('ride to the bridge');

  await settle(6_000);
  expect(fakeSupabase.rows('tasks')).toHaveLength(0);
  // Still owed, not lost: the reducer applied it and the queue is holding it.
  expect(pending()).toHaveLength(1);

  fakeSupabase.goOnline();
  await settle(10_000);

  expect(titles()).toEqual(['ride to the bridge']);
  expect(pending()).toHaveLength(0);

  // The interval keeps firing. An idle queue must not keep re-sending a row it
  // has already retired, which is the difference between at-least-once and
  // once-a-second-forever.
  await settle(30_000);
  expect(upserts()).toHaveLength(1);
});

it('does not write anything back when a circle merge arrives', async () => {
  mount();
  await settle();
  const me = currentUserId() as string;

  fakeSupabase.seed({
    profiles: [{ id: OTHER, handle: 'maya', name: 'Maya' }],
    circles: [
      {
        id: CIRCLE,
        name: 'The Basement',
        invite_code: 'basement-0123456789abcdef',
        created_by: me,
      },
    ],
    circle_members: [
      { circle_id: CIRCLE, profile_id: me },
      { circle_id: CIRCLE, profile_id: OTHER },
    ],
  });

  stake('swim');
  await settle(10_000);
  expect(upserts()).toHaveLength(1);

  // The pull, and with it the one merge this whole design allows per cycle.
  await settle(60_000);
  expect(screen.getByTestId('people')).toHaveTextContent(new RegExp(OTHER));

  // A merge is not a mutation.
  expect(upserts()).toHaveLength(1);
  expect(pending()).toHaveLength(0);

  // …and suppression is spent, not stuck. The next real tap still goes.
  stake('lift');
  await settle(10_000);
  expect(titles()).toEqual(['swim', 'lift']);
});

it('a merge that changes myTasks does not enqueue those rows straight back', async () => {
  mount();
  await settle();
  const me = currentUserId() as string;
  const week = screen.getByTestId('week').props.children as string;

  // Your own week, as your other phone left it. Nothing about this row is local:
  // the reducer has never seen it, and the outbox has nothing queued for it.
  fakeSupabase.seed({
    tasks: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        owner_id: me,
        week_start: week,
        day: 2,
        title: 'staked on the other phone',
        category: 'Fitness',
        points: 40,
        aud: 'friends',
        source: 'staked',
        done_at: null,
      },
    ],
  });

  await settle(60_000);

  // The merge landed — without this the rest of the test would pass vacuously.
  expect(screen.getByTestId('tasks')).toHaveTextContent('staked on the other phone');

  // …and went no further. The engine reference-diffs `myTasks`, and the merge
  // just replaced that array; only the suppression flag stops the new row from
  // reading as a local edit and being pushed back to the server it came from.
  await settle(30_000);
  expect(upserts()).toHaveLength(0);
  expect(pending()).toHaveLength(0);

  // Spent, not stuck: the tap after a merge still reaches the server.
  stake('lift');
  await settle(10_000);
  expect(titles()).toEqual(['staked on the other phone', 'lift']);
});

it('enqueues nothing at all in a demo account', async () => {
  mount('seeded');
  await settle(60_000);

  stake('ride to the bridge');
  await settle(60_000);

  expect(pending()).toHaveLength(0);
  expect(fakeSupabase.calls).toHaveLength(0);
});

it('leaves no timer running after unmount', async () => {
  const view = mount();
  await settle(10_000);

  stake('ride to the bridge');
  await settle(10_000);
  const before = upserts().length;

  view.unmount();
  expect(jest.getTimerCount()).toBe(0);

  await settle(60_000);
  expect(upserts()).toHaveLength(before);
});

it('does not wedge the queue behind a mutation the server refuses outright', async () => {
  mount();
  await settle();

  stake('blank');
  stake('ride to the bridge');

  // A check constraint answers the same way forever. Retrying it is a loop, and
  // the row queued behind it is innocent.
  fakeSupabase.failNext(1, {
    code: '23514',
    message: 'new row for relation "tasks" violates check constraint "tasks_day_check"',
  });

  await settle(10_000);

  expect(titles()).toEqual(['ride to the bridge']);
  expect(pending()).toHaveLength(0);
  expect(deadLetters()).toHaveLength(1);
});
