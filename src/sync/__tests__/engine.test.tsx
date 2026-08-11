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
import { AppState, Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { fakeSupabase } from '../../__mocks__/@supabase/supabase-js';
import { getSupabase } from '../../lib/supabase';
import { liveWeek, weekAfter } from '../../data/week';
import { Action, StoreProvider, useStore } from '../../state/store';
import { mondayOf } from '../mappers';
import { __resetOutboxForTests, deadLetters, pending } from '../outbox';
import {
  __resetRealtimeForTests,
  __setRealtimeClientForTests,
  type RealtimeChannelLike,
} from '../realtime';
import { __resetSessionForTests, currentUserId } from '../session';

const OTHER = '22222222-2222-4222-8222-222222222222';
const CIRCLE = '33333333-3333-4333-8333-333333333333';
const TARGET = '55555555-5555-4555-8555-555555555555';
const SERVER_TASK = '66666666-6666-4666-8666-666666666666';
const NOTE_ON_TASK = '77777777-7777-4777-8777-777777777777';
const NOTE_TO_ME = '88888888-8888-4888-8888-888888888888';

/**
 * A channel that records rather than connects.
 *
 * The strict Supabase fake refuses to mock realtime, and is right to: nothing
 * about a socket's ordering or its RLS behaviour can be honestly reproduced in
 * memory. This does not try. It reproduces the one thing the design depends on —
 * *a message arrives on a channel this app subscribed to* — and the whole point
 * of `realtime.ts` is that nothing else about the message is ever read.
 */
type FakeChannel = {
  topic: string;
  open: boolean;
  handlers: { table: string; fire: (payload: unknown) => void }[];
};

const realtime = (() => {
  let channels: FakeChannel[] = [];
  let removals = 0;

  return {
    reset(): void {
      channels = [];
      removals = 0;
    },
    client: () => ({
      channel(topic: string): RealtimeChannelLike {
        const entry: FakeChannel = { topic, open: false, handlers: [] };
        channels.push(entry);
        const ch: RealtimeChannelLike = {
          on(_type, filter, callback) {
            entry.handlers.push({ table: filter.table, fire: callback });
            return ch;
          },
          subscribe() {
            entry.open = true;
            return ch;
          },
          unsubscribe() {
            entry.open = false;
            return 'ok';
          },
        };
        return ch;
      },
      removeAllChannels() {
        removals += 1;
        for (const c of channels) c.open = false;
        return [];
      },
    }),
    /** Only the live ones. A closed channel is indistinguishable from no channel. */
    open: (): FakeChannel[] => channels.filter((c) => c.open),
    removals: (): number => removals,
    /** One row's worth of news, on every open channel listening to that table. */
    emit(table: string, payload: unknown): void {
      for (const c of channels) {
        if (!c.open) continue;
        for (const h of c.handlers) if (h.table === table) h.fire(payload);
      }
    },
  };
})();

/** The store's own AppState listener, captured so a test can drive it. */
let appState: (next: string) => void = () => {};

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
      {/* The ids are minted in the reducer, so a note or a cheer aimed at a real
          row has to read them back off state rather than invent one. */}
      <Text testID="ids">{store.state.myTasks.map((t) => t.id).join(',')}</Text>
      {/* The week the pull has to name. Read off state so the assertion below
          cannot drift from what the engine actually asked for. */}
      <Text testID="week">{mondayOf(store.state.week)}</Text>
      {/* The two slices a pull now has to be able to move. Rendered rather than
          reached for through the store, so what is asserted is what a screen
          would draw. */}
      <Text testID="acted">{Object.keys(store.state.acted).sort().join(',')}</Text>
      <Text testID="cmts">{store.state.myTasks.flatMap((t) => t.cmts.map((c) => c.t)).join(',')}</Text>
      <Text testID="said">
        {Object.entries(store.state.personNotes)
          .flatMap(([who, notes]) => (notes ?? []).map((n) => `${who}:${n.t}`))
          .join(',')}
      </Text>
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

/** The Monday the pull names, as the app currently has it. */
const weekOnScreen = (): string => screen.getByTestId('week').props.children as string;

const taskIds = (): string[] => {
  const text = screen.getByTestId('ids').props.children as string;
  return text ? text.split(',') : [];
};

const ops = () => pending().map((e) => e.op);

/**
 * Writes only. A pull reads `reactions` and `notes` on every cycle now, so
 * "nothing was sent" has to be asked of the mutations rather than of the whole
 * call log — which would otherwise be satisfied by the poll that is meant to be
 * running.
 */
const writesTo = (table: string) =>
  fakeSupabase.calls.filter((c) => c.table === table && c.method !== 'select');

const actedKeys = (): string[] => {
  const text = screen.getByTestId('acted').props.children as string;
  return text ? text.split(',') : [];
};

const say = (id: string, note: string) => {
  act(() => dispatch({ type: 'OPEN_SHEET', sheet: { type: 'task', id } }));
  act(() => dispatch({ type: 'SET_NOTE', value: note }));
  act(() => dispatch({ type: 'SEND_NOTE' }));
};

beforeEach(() => {
  jest.useFakeTimers();
  realtime.reset();
  __resetRealtimeForTests();
  __setRealtimeClientForTests(realtime.client);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
    appState = handler as (next: string) => void;
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
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
  jest.restoreAllMocks();
  __setRealtimeClientForTests(null);
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

// ─── reactions ────────────────────────────────────────────────────────────

it('sends a cheer, and only for a target the server can hold', async () => {
  mount();
  await settle();
  const me = currentUserId() as string;

  act(() => dispatch({ type: 'ACT', id: TARGET, kind: 'cheer' }));
  expect(ops()).toEqual(['reaction.add']);

  await settle(10_000);
  expect(fakeSupabase.rows('reactions')).toEqual([
    expect.objectContaining({ actor_id: me, target_type: 'task', target_id: TARGET, kind: 'cheer' }),
  ]);
  expect(pending()).toHaveLength(0);
});

it('cancels a cheer taken back before it left the device', async () => {
  mount();
  await settle();

  // No timers advanced between the two: this is the tap and the second thought,
  // inside the five seconds the scheduler waits.
  act(() => dispatch({ type: 'ACT', id: TARGET, kind: 'cheer' }));
  act(() => dispatch({ type: 'ACT', id: TARGET, kind: 'cheer' }));
  expect(pending()).toHaveLength(0);

  await settle(10_000);
  // Not an insert followed by a delete — nothing at all. An add that outlives
  // its own cancellation puts a cheer on someone's phone this device is not
  // showing, and the delete behind it would race the row it is meant to remove.
  expect(writesTo('reactions')).toHaveLength(0);
  expect(fakeSupabase.rows('reactions')).toHaveLength(0);
});

it('enqueues nothing for a cheer on a public post', async () => {
  mount();
  await settle();

  // `g1` is a fixture id. It is a real tap that stays highlighted, and a row the
  // schema has nowhere to put — sending it would be a permanent 22P02.
  act(() => dispatch({ type: 'ACT', id: 'g1', kind: 'cheer' }));
  await settle(10_000);

  expect(pending()).toHaveLength(0);
  expect(writesTo('reactions')).toHaveLength(0);
});

it('enqueues nothing for sharing your own win', async () => {
  mount();
  await settle();

  act(() => dispatch({ type: 'ACT', id: 'mywin', kind: 'share' }));
  await settle(10_000);

  expect(pending()).toHaveLength(0);
  expect(writesTo('reactions')).toHaveLength(0);
});

it('keeps the cheers a week produced when that week rolls over', async () => {
  mount();
  await settle();

  act(() => dispatch({ type: 'ACT', id: TARGET, kind: 'cheer' }));
  await settle(10_000);
  expect(fakeSupabase.rows('reactions')).toHaveLength(1);

  // The prompt is deliberately suppressed while onboarding is on screen, and a
  // restored account starts there — without this the rollover never commits and
  // the assertion below passes for a reason that has nothing to do with cheers.
  act(() => dispatch({ type: 'FINISH_ONBOARD', stakes: [], aud: 'friends' }));
  act(() => dispatch({ type: 'ROLLOVER_DETECTED', to: weekAfter(liveWeek()) }));
  act(() => dispatch({ type: 'COMMIT_ROLLOVER', carryIds: [] }));
  await settle(10_000);

  // `acted` is week-scoped and `COMMIT_ROLLOVER` empties it. That is a week
  // ending, not the user taking every cheer back, and diffing across it would
  // delete rows other people can see.
  expect(fakeSupabase.rows('reactions')).toHaveLength(1);
  expect(pending()).toHaveLength(0);
});

it('lights a cheer another device made, and does not send it back', async () => {
  mount();
  await settle();
  const me = currentUserId() as string;

  // A tap that is not a row, made before the pull. It has to survive one.
  act(() => dispatch({ type: 'ACT', id: 'g1', kind: 'cheer' }));

  // Your own cheer, as your other phone left it.
  fakeSupabase.seed({
    reactions: [{ actor_id: me, target_type: 'task', target_id: TARGET, kind: 'cheer' }],
  });

  await settle(60_000);
  expect(actedKeys()).toContain(`${TARGET}:cheer`);
  expect(actedKeys()).toContain('g1:cheer');

  // …and went no further. `observe` diffs `acted` and enqueues from it, so only
  // adoption stops the merged cheer from reading as a tap made here.
  await settle(30_000);
  expect(writesTo('reactions')).toHaveLength(0);
  expect(pending()).toHaveLength(0);

  // Spent, not stuck: the tap after a merge still reaches the server.
  act(() => dispatch({ type: 'ACT', id: SERVER_TASK, kind: 'cheer' }));
  await settle(10_000);
  expect(fakeSupabase.rows('reactions')).toHaveLength(2);
});

it('puts out a cheer another device took back, without deleting it twice', async () => {
  mount();
  await settle();
  const me = currentUserId() as string;

  act(() => dispatch({ type: 'ACT', id: TARGET, kind: 'cheer' }));
  await settle(10_000);
  expect(fakeSupabase.rows('reactions')).toHaveLength(1);

  // The other phone, taking it back. Through the same client the transport
  // uses, so the row goes exactly the way a real withdrawal would.
  await act(async () => {
    await getSupabase().from('reactions').delete().match({
      actor_id: me,
      target_type: 'task',
      target_id: TARGET,
      kind: 'cheer',
    });
  });
  const deletes = writesTo('reactions').length;

  await settle(60_000);
  expect(actedKeys()).not.toContain(`${TARGET}:cheer`);

  // The absence is the server's own answer. Sending a delete back for it would
  // be this device arguing with a row that is already gone.
  await settle(30_000);
  expect(writesTo('reactions')).toHaveLength(deletes);
  expect(pending()).toHaveLength(0);
});

// ─── notes ────────────────────────────────────────────────────────────────

it('sends a note on your own task, after the task it points at', async () => {
  mount();
  await settle();
  const me = currentUserId() as string;

  stake('ride to the bridge');
  const [taskId] = taskIds();
  say(taskId, 'Halfway.');

  // Order is the point: `notes.task_id` is a foreign key, and the queue is
  // strictly serial, so an insert ahead of its task is a permanent 23503.
  expect(ops()).toEqual(['task.upsert', 'note.add']);

  await settle(10_000);
  expect(fakeSupabase.rows('notes')).toEqual([
    expect.objectContaining({ author_id: me, task_id: taskId, recipient_id: null, body: 'Halfway.' }),
  ]);
  expect(pending()).toHaveLength(0);
});

it('enqueues nothing for a note on a public post', async () => {
  mount();
  await settle();

  say('g1', 'Respect.');
  await settle(10_000);

  expect(pending()).toHaveLength(0);
  expect(writesTo('notes')).toHaveLength(0);
});

it('shows a note from another device, on the task and on the person', async () => {
  mount();
  await settle();
  const me = currentUserId() as string;

  // The task has to be on the server before a note can name it: `notes.task_id`
  // is a foreign key, and the fake enforces it exactly as Postgres does.
  stake('ride to the bridge');
  const [taskId] = taskIds();
  await settle(10_000);

  fakeSupabase.seed({
    profiles: [{ id: OTHER, handle: 'maya', name: 'Maya' }],
    notes: [
      { id: NOTE_ON_TASK, author_id: OTHER, task_id: taskId, body: 'Strong.' },
      { id: NOTE_TO_ME, author_id: OTHER, recipient_id: me, body: 'Proud of you.' },
    ],
  });

  await settle(60_000);
  expect(screen.getByTestId('cmts')).toHaveTextContent('Strong.');
  expect(screen.getByTestId('said')).toHaveTextContent(`${me}:Proud of you.`);

  // A note landing in a task's `cmts` builds a new task object, which is
  // indistinguishable from an edit to the reference diff — so the merge has to
  // be adopted on both slices, or the row and the note both go straight back.
  const writes = writesTo('tasks').length;
  await settle(30_000);
  expect(writesTo('notes')).toHaveLength(0);
  expect(writesTo('tasks')).toHaveLength(writes);
  expect(pending()).toHaveLength(0);

  // Spent, not stuck.
  say(taskId, 'Halfway.');
  await settle(10_000);
  expect(fakeSupabase.rows('notes').map((r) => r.body)).toEqual(
    expect.arrayContaining(['Strong.', 'Proud of you.', 'Halfway.']),
  );
});

// ─── realtime ─────────────────────────────────────────────────────────────

it('refetches on an event rather than believing what it carries', async () => {
  mount();
  await settle();
  const me = currentUserId() as string;
  const week = weekOnScreen();

  // One channel, subscribed as soon as there is a session to subscribe for.
  expect(realtime.open()).toHaveLength(1);

  fakeSupabase.seed({
    tasks: [
      {
        id: SERVER_TASK,
        owner_id: me,
        week_start: week,
        day: 2,
        title: 'from the server',
        category: 'Fitness',
        points: 40,
        aud: 'friends',
        source: 'staked',
        done_at: null,
      },
    ],
  });

  // The poll is a minute away, so nothing has asked yet.
  await settle(1_000);
  expect(screen.getByTestId('tasks')).not.toHaveTextContent('from the server');

  // A payload that is a lie in every field, which is the point: a DELETE is not
  // RLS-filtered and carries only replica identity, so no event is data.
  realtime.emit('tasks', {
    eventType: 'INSERT',
    table: 'tasks',
    new: { id: SERVER_TASK, title: 'from the payload' },
  });
  await settle(1_000);

  expect(screen.getByTestId('tasks')).toHaveTextContent('from the server');
  expect(screen.getByTestId('tasks')).not.toHaveTextContent('from the payload');
});

it('closes the channel in the background and opens it again on return', async () => {
  mount();
  await settle();
  expect(realtime.open()).toHaveLength(1);

  await act(async () => appState('background'));
  expect(realtime.open()).toHaveLength(0);

  // …and stays closed. A pull tick behind a backgrounded app must not quietly
  // reopen the socket the AppState listener just closed.
  await settle(120_000);
  expect(realtime.open()).toHaveLength(0);

  await act(async () => appState('active'));
  await settle();
  expect(realtime.open()).toHaveLength(1);
});

it('drops every channel when the account changes', async () => {
  mount();
  await settle();
  expect(realtime.open()).toHaveLength(1);

  act(() => dispatch({ type: 'RESET', mode: 'seeded' }));
  await settle(10_000);

  expect(realtime.open()).toHaveLength(0);
  expect(realtime.removals()).toBe(1);
});

it('leaves no channel behind after unmount', async () => {
  const view = mount();
  await settle();
  expect(realtime.open()).toHaveLength(1);

  view.unmount();
  expect(realtime.open()).toHaveLength(0);
});
