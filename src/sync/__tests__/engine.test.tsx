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
import { queueProfileName } from '../engine';
import {
  __resetRealtimeForTests,
  __setRealtimeClientForTests,
  type RealtimeChannelLike,
} from '../realtime';
import { __resetSessionForTests, currentUserId } from '../session';
import { personOf } from '../../data/people';

const OTHER = '22222222-2222-4222-8222-222222222222';
const CIRCLE = '33333333-3333-4333-8333-333333333333';
const TARGET = '55555555-5555-4555-8555-555555555555';
const SERVER_TASK = '66666666-6666-4666-8666-666666666666';
const NOTE_ON_TASK = '77777777-7777-4777-8777-777777777777';
const NOTE_TO_ME = '88888888-8888-4888-8888-888888888888';
/** In no circle with us, but staking in the same week. */
const STRANGER = '44444444-4444-4444-8444-444444444444';

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
/**
 * Renders of a store consumer, which is what a wasteful merge actually costs:
 * the context is `useMemo(..., [state, config])`, so a dispatch that changes
 * nothing re-renders every screen in the app. Counted in an effect rather than
 * during render — a render must have no side effects, refs included.
 */
const rendered = { count: 0 };

function Probe() {
  const store = useStore();
  React.useEffect(() => {
    rendered.count += 1;
  });
  // The test drives the app through the same dispatch the screens get, so that
  // what is under test is a tap and not a hand-built outbox entry.
  React.useEffect(() => {
    dispatch = store.dispatch;
  }, [store.dispatch]);
  return (
    <>
      <Text testID="people">{Object.keys(store.state.people).sort().join(',')}</Text>
      {/* Your own name as a screen would draw it — the thing that used to read
          "Someone" no matter what you typed. */}
      <Text testID="myname">{store.state.people[store.state.selfId]?.name ?? ''}</Text>
      {/* The invite code, which is the only string that lets anyone in. */}
      <Text testID="circle">{store.state.circle?.inviteCode ?? ''}</Text>
      {/* Other people's weeks, and the thread this device has left on them. */}
      <Text testID="feed">{store.state.moments.map((m) => m.title ?? '').join(',')}</Text>
      {/* The bell's feed: who did what, as the overlay draws it. */}
      <Text testID="notifs">
        {store.state.notifications.map((n) => `${n.name} ${n.text}`).join(',')}
      </Text>
      {/* Cheers that landed on your own week — the Me screen's "you got". */}
      <Text testID="received">{String(store.state.profile.cheersReceived)}</Text>
      {/* Other people's cheers, per moment — never including your own. */}
      <Text testID="cheers">{store.state.moments.map((m) => String(m.cheers ?? '')).join(',')}</Text>
      <Text testID="feedNotes">
        {store.state.moments.flatMap((m) => (m.cmts ?? []).map((c) => c.t)).join(',')}
      </Text>
      {/* What `ranking()` reads for everyone who is not you. */}
      <Text testID="stats">
        {Object.values(store.state.people)
          .filter((p) => p && p.id !== store.state.selfId && p.stats)
          .map((p) => `${p!.id}:${p!.stats!.done}/${p!.stats!.total}`)
          .join(',')}
      </Text>
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
  rendered.count = 0;
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

/** The circle that makes your own `profiles` row come back on a pull. */
const inACircleWith = (me: string) =>
  fakeSupabase.seed({
    profiles: [{ id: OTHER, handle: 'maya', name: 'Maya' }],
    circles: [
      { id: CIRCLE, name: 'The Basement', invite_code: 'basement-0123456789abcdef', created_by: me },
    ],
    circle_members: [
      { circle_id: CIRCLE, profile_id: me },
      { circle_id: CIRCLE, profile_id: OTHER },
    ],
  });

const nameOnServer = (id: string) =>
  fakeSupabase.rows('profiles').find((r) => r.id === id)?.name;

/** Exactly what `OnboardOverlay.finish()` does on a live account. */
const finishOnboarding = (name: string) => {
  dispatch({ type: 'FINISH_ONBOARD', name, stakes: [], aud: 'friends' });
  queueProfileName(name);
};

it('sends the name you typed in onboarding', async () => {
  mount();
  await settle();
  const me = currentUserId() as string;
  // What the signup trigger left. Asserted so the rename below is visibly a
  // change rather than a value that was already there.
  expect(nameOnServer(me)).toBe('Someone');

  act(() => finishOnboarding('Maya Chen'));
  await settle(10_000);

  expect(nameOnServer(me)).toBe('Maya Chen');
  expect(pending()).toHaveLength(0);
});

/**
 * The race the two-device run found, in both of the orders it can happen.
 *
 * Creating a circle calls `kickSync()`, so a pull is in flight while the last
 * two onboarding screens are being tapped through — and React batches, so the
 * merge it produces can share a commit with `FINISH_ONBOARD`. One commit means
 * one observation, and the name is lost in whichever direction they land:
 *
 * The codebase already documents this failure mode for tasks, at `observe`:
 * "if a tap lands in the same React commit as the merge, one observation covers
 * both, and the user's edit is adopted as though the server had sent it."
 * Tasks solve it by adopting per id. The profile adopted all-or-nothing.
 */
describe('a merge landing in the same commit as onboarding', () => {
  const inACircleAlready = async () => {
    mount();
    await settle();
    const me = currentUserId() as string;
    inACircleWith(me);
    // One pull, so the directory already holds the server's placeholder — which
    // is what makes the merge below carry a *different* name to the typed one.
    await settle(60_000);
    expect(nameOnServer(me)).toBe('Someone');
    return me;
  };

  const serverSaysSomeone = (me: string) => ({
    type: 'SERVER_MERGE' as const,
    merge: { people: [personOf(me, 'Someone')] },
  });

  it('sends the name when the merge is applied first', async () => {
    const me = await inACircleAlready();

    act(() => {
      dispatch(serverSaysSomeone(me));
      finishOnboarding('Maya Chen');
    });
    await settle(10_000);

    expect(screen.getByTestId('myname')).toHaveTextContent('Maya Chen');
    expect(nameOnServer(me)).toBe('Maya Chen');
  });

  it('sends the name when the merge is applied second', async () => {
    const me = await inACircleAlready();

    act(() => {
      finishOnboarding('Maya Chen');
      dispatch(serverSaysSomeone(me));
    });
    await settle(10_000);

    expect(screen.getByTestId('myname')).toHaveTextContent('Maya Chen');
    expect(nameOnServer(me)).toBe('Maya Chen');
  });
});

it('pushes a rename made long after onboarding', async () => {
  mount();
  await settle();
  const me = currentUserId() as string;
  act(() => finishOnboarding('Maya Chen'));
  await settle(10_000);

  // Renaming is two calls in one tick — the reducer for the screen, the queue
  // for the server — and this is the pair `MeScreen.commitRename` makes. They
  // are deliberately not one action: a reducer that enqueued would be a reducer
  // with a side effect, and an `observe` that watched the directory is what the
  // race above was.
  act(() => {
    dispatch({ type: 'RENAME_SELF', name: 'Maya C.' });
    queueProfileName('Maya C.');
  });
  await settle(10_000);

  expect(nameOnServer(me)).toBe('Maya C.');
  expect(screen.getByTestId('myname')).toHaveTextContent('Maya C.');
  expect(pending()).toHaveLength(0);
});

it('takes a rename from another device without sending it back', async () => {
  mount();
  await settle();
  const me = currentUserId() as string;
  inACircleWith(me);

  act(() => finishOnboarding('Maya Chen'));
  await settle(10_000);
  expect(writesTo('profiles')).toHaveLength(1);

  // Your other phone renames you. The merge that delivers it *must* differ from
  // what this device holds — otherwise the diff below reports nothing whether
  // the echo guard is there or not, and this test proves only that two equal
  // strings are equal.
  await act(async () => {
    await getSupabase().from('profiles').update({ name: 'Maya C.' }).eq('id', me);
  });
  const written = writesTo('profiles').length;

  await settle(60_000);

  // On screen, and not queued straight back — which would then arrive again on
  // the next pull, forever.
  expect(screen.getByTestId('myname')).toHaveTextContent('Maya C.');
  expect(writesTo('profiles')).toHaveLength(written);
  expect(pending()).toHaveLength(0);
});

it('keeps the name on screen when a pull races the push', async () => {
  mount();
  await settle();
  const me = currentUserId() as string;
  inACircleWith(me);

  // Offline, so the rename is stuck in the queue while the pull still answers
  // from the row the trigger wrote. This is the race the dirty guard is for.
  fakeSupabase.goOffline();
  act(() => finishOnboarding('Maya Chen'));
  await settle(60_000);
  fakeSupabase.goOnline();
  await settle(60_000);

  expect(screen.getByTestId('myname')).toHaveTextContent('Maya Chen');
  expect(nameOnServer(me)).toBe('Maya Chen');
});

describe('other people’s weeks', () => {
  /** One of Maya's tasks, in the week the app is showing. */
  const mayaStakes = (over: Record<string, unknown> = {}) =>
    fakeSupabase.seed({
      tasks: [
        {
          id: '99999999-9999-4999-8999-999999999999',
          owner_id: OTHER,
          week_start: weekOnScreen(),
          day: 2,
          title: 'Swim 2k',
          category: 'Fitness',
          points: 40,
          aud: 'friends',
          source: 'staked',
          ...over,
        },
      ],
    });

  it('puts a circle member’s task in the feed', async () => {
    mount();
    await settle();
    inACircleWith(currentUserId() as string);
    mayaStakes();

    await settle(60_000);

    expect(screen.getByTestId('feed')).toHaveTextContent('Swim 2k');
    // Ranking reads `Person.stats`, and renders "No week synced yet" without
    // it — so the Circle screen was empty for every live member until now.
    expect(screen.getByTestId('stats')).toHaveTextContent(`${OTHER}:0/1`);
  });

  it('counts a closed task as done', async () => {
    mount();
    await settle();
    inACircleWith(currentUserId() as string);
    mayaStakes({ done_at: new Date().toISOString() });

    await settle(60_000);

    expect(screen.getByTestId('stats')).toHaveTextContent(`${OTHER}:1/1`);
  });

  it('shows nothing when you are in no circle', async () => {
    mount();
    await settle();
    fakeSupabase.seed({ profiles: [{ id: OTHER, handle: 'maya', name: 'Maya' }] });
    mayaStakes();

    await settle(60_000);

    expect(screen.getByTestId('feed')).toHaveTextContent('');
    expect(writesTo('tasks')).toHaveLength(0);
  });

  it('leaves out someone who staked the same week but shares no circle', async () => {
    // The real control for the scoping. The test above passes on the early
    // return for an empty member list, so it holds even if the read stops
    // filtering by owner entirely — this one is in a circle, so the query
    // actually runs, and the fake models no RLS. What keeps a stranger out of
    // the feed here is the client asking only about members.
    mount();
    await settle();
    inACircleWith(currentUserId() as string);
    mayaStakes();
    fakeSupabase.seed({
      profiles: [{ id: STRANGER, handle: 'jordan', name: 'Jordan' }],
      tasks: [
        {
          id: 'aaaaaaaa-1111-4111-8111-111111111111',
          owner_id: STRANGER,
          week_start: weekOnScreen(),
          day: 3,
          title: 'Not your business',
          category: 'Work',
          points: 20,
          aud: 'friends',
          source: 'staked',
        },
      ],
    });

    await settle(60_000);

    // Regexes, not strings: this matcher compares whole text content, so
    // `not.toHaveTextContent('Not your business')` would pass against any feed
    // that merely differed — including the right answer for the wrong reason.
    expect(screen.getByTestId('feed')).toHaveTextContent(/Swim 2k/);
    expect(screen.getByTestId('feed')).not.toHaveTextContent(/Not your business/);
  });

  it('tells you who cheered, and when', async () => {
    // The gap this closes: the count went up and nothing said whose it was.
    // The row is written by a trigger — the client has no INSERT on
    // `notifications` — so this is seeded the way the database would leave it.
    mount();
    await settle();
    const me = currentUserId() as string;
    inACircleWith(me);
    stake('ride to the bridge');
    await settle(10_000);
    const mine = taskIds()[0] as string;

    fakeSupabase.seed({
      notifications: [
        {
          id: 'aaaaaaaa-9999-4999-8999-999999999999',
          recipient_id: me,
          tier: 'circle',
          kind: 'cheer',
          payload: {
            actor_id: OTHER,
            actor_name: 'Maya Chen',
            task_id: mine,
            task_title: 'ride to the bridge',
          },
        },
      ],
    });
    await settle(60_000);

    // Everything the row renders comes off the payload: a cheer can arrive from
    // an `everyone` task whose owner shares no circle with the actor, and a
    // notification that had to join `profiles` would read "Someone" precisely
    // when it mattered.
    expect(screen.getByTestId('notifs')).toHaveTextContent('Maya Chen cheered “ride to the bridge”');
  });

  it('leaves the feed alone when nothing new arrived', async () => {
    mount();
    await settle();
    inACircleWith(currentUserId() as string);
    await settle(60_000);

    const renders = rendered.count;
    await settle(60_000);

    // `time` is recomputed from the clock every pull, so a comparison over the
    // rendered shape would report a change every minute forever.
    expect(rendered.count).toBe(renders);
  });

  it('counts the cheers that landed on your own week', async () => {
    // The gap the two-device run ended on: B cheered A's task, the row was in
    // the database, and A's screen said 0. `pullCheerCounts` answered for the
    // tasks in your feed, and your own are never in it.
    mount();
    await settle();
    const me = currentUserId() as string;
    inACircleWith(me);
    stake('ride to the bridge');
    await settle(10_000);
    const mine = taskIds()[0] as string;

    fakeSupabase.seed({
      reactions: [
        { actor_id: OTHER, target_type: 'task', target_id: mine, kind: 'cheer' },
      ],
    });
    await settle(60_000);

    expect(screen.getByTestId('received')).toHaveTextContent('1');
  });

  it('does not count cheering your own task as a cheer received', async () => {
    mount();
    await settle();
    const me = currentUserId() as string;
    inACircleWith(me);
    stake('ride to the bridge');
    await settle(10_000);
    const mine = taskIds()[0] as string;

    // The read excludes you in both directions, and this is the direction that
    // would flatter: a number you can raise by cheering yourself is not a
    // count of anything.
    act(() => dispatch({ type: 'ACT', id: mine, kind: 'cheer', toast: 'x' }));
    await settle(60_000);

    expect(screen.getByTestId('received')).toHaveTextContent('0');
  });

  it('brings back how many other people cheered', async () => {
    mount();
    await settle();
    const me = currentUserId() as string;
    inACircleWith(me);
    mayaStakes();
    fakeSupabase.seed({
      profiles: [{ id: STRANGER, handle: 'nana', name: 'Nana' }],
      reactions: [
        {
          actor_id: OTHER,
          target_type: 'task',
          target_id: '99999999-9999-4999-8999-999999999999',
          kind: 'cheer',
        },
        {
          actor_id: STRANGER,
          target_type: 'task',
          target_id: '99999999-9999-4999-8999-999999999999',
          kind: 'cheer',
        },
      ],
    });

    await settle(60_000);

    expect(screen.getByTestId('cheers')).toHaveTextContent('2');
  });

  it('leaves your own cheer out of the count, so the screen can add it once', async () => {
    mount();
    await settle();
    const me = currentUserId() as string;
    inACircleWith(me);
    mayaStakes();
    await settle(60_000);

    // Cheer it, and let the push land. The server now holds your reaction —
    // the count must still say nobody else has, or the card reads 2 for what
    // is one cheer, yours.
    act(() =>
      dispatch({
        type: 'ACT',
        id: '99999999-9999-4999-8999-999999999999',
        kind: 'cheer',
        toast: 'x',
      }),
    );
    await settle(10_000);
    expect(fakeSupabase.rows('reactions')).toHaveLength(1);

    await settle(60_000);

    expect(screen.getByTestId('cheers')).toHaveTextContent('0');
  });

  it('does not re-render every minute for a feed that has not moved', async () => {
    mount();
    await settle();
    inACircleWith(currentUserId() as string);
    mayaStakes();
    await settle(60_000);

    const renders = rendered.count;
    await settle(60_000);

    // `time` is recomputed from the clock on every pull, so a comparison that
    // included it would report a change every cycle, forever.
    expect(rendered.count).toBe(renders);
  });

  it('keeps a note you left on a friend’s task when the feed refreshes', async () => {
    mount();
    await settle();
    inACircleWith(currentUserId() as string);
    mayaStakes();
    await settle(60_000);

    say('99999999-9999-4999-8999-999999999999', 'proud of you');
    await settle(10_000);
    expect(screen.getByTestId('feedNotes')).toHaveTextContent('proud of you');

    // Maya stakes something else, so the feed genuinely moves and the merge
    // rebuilds the list. Without this the poll finds nothing changed, dispatches
    // no merge at all, and the note survives for a reason this test is not
    // about — which is how it passed with the carry-over deleted.
    mayaStakes({ id: 'bbbbbbbb-2222-4222-8222-222222222222', title: 'Long ride' });
    await settle(60_000);

    expect(screen.getByTestId('feed')).toHaveTextContent(/Long ride/);
    // `pullNotes` answers for your own tasks and your own inbox, so the server's
    // version of a friend's row carries no thread. An assignment would blink
    // the note away a minute after it was written.
    expect(screen.getByTestId('feedNotes')).toHaveTextContent('proud of you');
  });
});

it('learns which circle it is in, and stops asking once it knows', async () => {
  mount();
  await settle();
  const me = currentUserId() as string;
  inACircleWith(me);

  await settle(60_000);

  // The invite code the sheet shows, taken from the row rather than a literal
  // so it cannot pass against a hardcoded string.
  const row = fakeSupabase.rows('circles')[0];
  expect(screen.getByTestId('circle')).toHaveTextContent(String(row.invite_code));

  // A second identical answer must not re-render the app. Every pull mints a
  // new object for the same circle, so this is only true if the comparison is
  // field-wise rather than by reference.
  const renders = rendered.count;
  await settle(60_000);
  expect(rendered.count).toBe(renders);
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
  act(() => dispatch({ type: 'FINISH_ONBOARD', stakes: [], aud: 'friends', name: '' }));
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
