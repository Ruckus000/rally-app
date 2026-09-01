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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fakeSupabase } from '../../__mocks__/@supabase/supabase-js';
import { getSupabase } from '../../lib/supabase';
import { liveWeek, weekAfter } from '../../data/week';
import { Action, StoreProvider, useStore } from '../../state/store';
import { mondayOf } from '../mappers';
import { __resetOutboxForTests, deadLetters, pending } from '../outbox';
import { commitSelfName, queueProfileName } from '../engine';
import {
  __resetRealtimeForTests,
  __setRealtimeClientForTests,
  type RealtimeChannelLike,
} from '../realtime';
import { __resetSessionForTests, currentUserId } from '../session';
import { personOf } from '../../data/people';
import { activeCircle, circleMembers } from '../../state/selectors';

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
      {/* Who the Circle screen counts and ranks. Not the same as `people`: the
          bots are in the directory so their cards have names, and in nobody's
          circle. */}
      <Text testID="members">{[...circleMembers(store.state, null)].sort().join(',')}</Text>
      {/* Your own name as a screen would draw it — the thing that used to read
          "Someone" no matter what you typed. */}
      <Text testID="myname">{store.state.people[store.state.selfId]?.name ?? ''}</Text>
      {/* The invite code, which is the only string that lets anyone in. It
          is the active circle's, which for every test in this file is the only
          one — a picker is a later slice. */}
      <Text testID="circle">{activeCircle(store.state)?.inviteCode ?? ''}</Text>
      {/* Every circle, so a test can tell "one" from "two" from "none". */}
      <Text testID="circles">{store.state.circles.map((c) => c.name).join(',')}</Text>
      {/* Who is in which, by name rather than uuid so a failure is readable.
          Bots are left out: they are in none of your circles, and saying so on
          every row would bury the two that matter. */}
      <Text testID="circleIds">
        {Object.values(store.state.people)
          .filter((p) => p && !p.bot)
          .map((p) => {
            const names = (p!.circleIds ?? [])
              .map((id) => store.state.circles.find((c) => c.id === id)?.name ?? id)
              .join('+');
            return `${p!.id}:${names}`;
          })
          .sort()
          .join(',')}
      </Text>
      {/* Other people's weeks, and the thread this device has left on them. */}
      <Text testID="feed">{store.state.moments.map((m) => m.title ?? '').join(',')}</Text>
      {/* The Oz bots' week — the Global tab, and a different set of owners
          answered by the same query as the feed above. */}
      <Text testID="globals">{store.state.globalPosts.map((m) => m.title ?? '').join(',')}</Text>
      <Text testID="globalCheers">
        {store.state.globalPosts.map((m) => String(m.cheers ?? '')).join(',')}
      </Text>
      <Text testID="globalNotes">
        {store.state.globalPosts.flatMap((m) => (m.cmts ?? []).map((c) => c.t)).join(',')}
      </Text>
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
      {/* What the server refused outright, as the banner above every tab reads it. */}
      <Text testID="unsaved">{String(store.state.unsaved)}</Text>
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

beforeEach(async () => {
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
  // `__resetOutboxForTests` clears the module, not the disk. A test that ends
  // with entries still queued leaves them in `rally:outbox:v1`, and the next
  // mount hydrates them — under a different anonymous user, so the drain sees a
  // foreign owner, clears the queue and returns before sending anything of its
  // own. Every test here happened to drain empty until one deliberately did not.
  await AsyncStorage.clear();
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

it('holds the queue when the server stops accepting the token, and goes quiet', async () => {
  mount();
  await settle();
  expect(currentUserId()).not.toBeNull();

  fakeSupabase.goOffline();
  stake('ride to the bridge');
  stake('long way home');
  await settle(6_000);
  expect(pending()).toHaveLength(2);

  // The radio is back, but the account it belonged to is gone — deleted, or its
  // refresh token revoked. Every request now answers the same way.
  fakeSupabase.goOnline();
  fakeSupabase.failNext(200, { code: 'PGRST301', message: 'JWT expired' });
  await settle(10_000);

  // The point of the whole change. A 401 used to arrive as `permanent`, and
  // `drop` splices the head out and *continues* — so one drain pass emptied the
  // queue into the dead list, deleting both of these with nothing on screen.
  expect(pending()).toHaveLength(2);
  expect(deadLetters()).toEqual([]);

  // And the layer stops rather than asking a dead token the same question every
  // minute until the app is restarted. This is `currentUserId()` going null:
  // the pull bails on it, the drain returns early on it, the socket drops it.
  expect(currentUserId()).toBeNull();

  const quiet = fakeSupabase.calls.length;
  await settle(120_000);
  expect(fakeSupabase.calls.length).toBe(quiet);
});

it('says so when the server refuses a write outright, and keeps the row', async () => {
  mount();
  await settle();

  fakeSupabase.goOffline();
  stake('ride to the bridge');
  await settle(6_000);

  // A constraint, not a network or a token: the one class of failure the queue
  // gives up on. Everything answers this way so the drain cannot slip past it.
  fakeSupabase.goOnline();
  fakeSupabase.failNext(200, { code: '23514', message: 'tasks_day_check' });
  await settle(10_000);

  // The reducer is deliberately never rolled back, so the task is still there —
  // which is exactly why somebody has to be told the server has no copy of it.
  expect(screen.getByTestId('tasks').props.children).toContain('ride to the bridge');
  expect(screen.getByTestId('unsaved').props.children).toBe('1');
  expect(deadLetters()).toHaveLength(1);
  // And the queue is not still holding it: dropped is dropped, or the count
  // would climb by one on every tick for the rest of the session.
  expect(pending()).toHaveLength(0);
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

/** An Oz bot with a week on it, which is what the Global tab is made of. */
const BOT = '00000000-0000-4000-8000-0000000000b0';
const BOT_TASK = '88888888-8888-4888-8888-888888888888';

const aBotStakes = (over: Record<string, unknown> = {}) =>
  fakeSupabase.seed({
    profiles: [{ id: BOT, handle: 'dorothy.gale', name: 'Dorothy Gale', is_bot: true }],
    tasks: [
      {
        id: BOT_TASK,
        owner_id: BOT,
        week_start: weekOnScreen(),
        day: 1,
        title: 'Walked the whole way',
        category: 'Fitness',
        points: 20,
        aud: 'everyone',
        source: 'staked',
        ...over,
      },
    ],
  });

const nameOnServer = (id: string) =>
  fakeSupabase.rows('profiles').find((r) => r.id === id)?.name;

/** Exactly what `OnboardOverlay.finish()` does on a live account. */
const finishOnboarding = (name: string) => {
  dispatch({ type: 'FINISH_ONBOARD', name, stakes: [], aud: 'friends', circleId: null });
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
  // for the server — and `commitSelfName` is what both the Me card and
  // Settings call to make that pair. Calling the real function here, rather
  // than a hand-written copy of it, is what makes this test pin the thing that
  // ships rather than a stand-in for it.
  act(() => {
    commitSelfName(dispatch, 'Maya C.', 'Maya Chen');
  });
  await settle(10_000);

  expect(nameOnServer(me)).toBe('Maya C.');
  expect(screen.getByTestId('myname')).toHaveTextContent('Maya C.');
  expect(pending()).toHaveLength(0);
});

describe('commitSelfName', () => {
  it('does nothing for a name that only differs from the stored one by surrounding whitespace', async () => {
    mount();
    await settle();
    act(() => finishOnboarding('Maya Chen'));
    await settle(10_000);

    const before = pending().length;
    let did: boolean | undefined;
    act(() => {
      did = commitSelfName(dispatch, '  Maya Chen  ', 'Maya Chen');
    });

    expect(did).toBe(false);
    expect(screen.getByTestId('myname')).toHaveTextContent('Maya Chen');
    expect(pending()).toHaveLength(before);
  });

  it('does nothing for an empty draft', async () => {
    mount();
    await settle();
    act(() => finishOnboarding('Maya Chen'));
    await settle(10_000);

    const before = pending().length;
    let did: boolean | undefined;
    act(() => {
      did = commitSelfName(dispatch, '   ', 'Maya Chen');
    });

    expect(did).toBe(false);
    expect(screen.getByTestId('myname')).toHaveTextContent('Maya Chen');
    expect(pending()).toHaveLength(before);
  });
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

  it('shows two cheers on one task as one line', async () => {
    mount();
    await settle();
    const me = currentUserId() as string;
    inACircleWith(me);
    stake('ride to the bridge');
    await settle(10_000);
    const mine = taskIds()[0] as string;

    const cheer = (id: string, actor: string, name: string) => ({
      id,
      recipient_id: me,
      tier: 'circle',
      kind: 'cheer',
      payload: { actor_id: actor, actor_name: name, task_id: mine, task_title: 'ride to the bridge' },
    });
    fakeSupabase.seed({
      notifications: [
        cheer('aaaaaaaa-1111-4111-8111-111111111111', OTHER, 'Maya Chen'),
        cheer('aaaaaaaa-2222-4222-8222-222222222222', STRANGER, 'Dre Okafor'),
      ],
    });
    await settle(60_000);

    // The screen has promised this since the design shipped: one line per
    // thing that happened, not one per person who noticed.
    // Either order — two cheers landing in the same second have no meaningful
    // sequence, and pinning one would be pinning the fake's insertion order.
    expect(screen.getByTestId('notifs')).toHaveTextContent(
      /^(Maya and Dre|Dre and Maya) cheered “ride to the bridge”$/,
    );
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

  it('updates the count when a cheer lands on a moment already on screen', async () => {
    // The case the test above cannot reach: it seeds both cheers before the
    // moment is ever delivered, so `prev` is empty and `carryThreads` has
    // nothing to compare against. Once the card is on screen the comparison
    // runs, and it was reading `id`, `title`, `cmts` and the photo only — so a
    // pull whose only news was a cheer got as far as the reducer and was
    // dropped there. The count never moved until the app was restarted.
    mount();
    await settle();
    const me = currentUserId() as string;
    inACircleWith(me);
    mayaStakes();
    await settle(60_000);
    expect(screen.getByTestId('feed')).toHaveTextContent('Swim 2k');
    expect(screen.getByTestId('cheers')).toHaveTextContent('0');

    fakeSupabase.seed({
      reactions: [
        {
          actor_id: OTHER,
          target_type: 'task',
          target_id: '99999999-9999-4999-8999-999999999999',
          kind: 'cheer',
        },
      ],
    });
    await settle(60_000);

    expect(screen.getByTestId('cheers')).toHaveTextContent('1');
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

  it('updates the cheer count on a moment you have written on', async () => {
    // `carryThreads` returns `prev` by identity when nothing it compares has
    // moved, which is what lets an unchanged feed skip a render. It compared
    // `id`, `title`, `cmts` and the photo — not `cheers`. On a moment with no
    // thread the comparison never fired, because the pull builds a fresh
    // `cmts` every time and reference equality failed. On a moment you *have*
    // written on, the thread is carried across by reference, that clause
    // passes, and the whole merge is discarded — so the count froze at
    // whatever it was when you wrote the note, until the app restarted.
    mount();
    await settle();
    inACircleWith(currentUserId() as string);
    mayaStakes();
    await settle(60_000);

    say('99999999-9999-4999-8999-999999999999', 'proud of you');
    await settle(10_000);
    expect(screen.getByTestId('feedNotes')).toHaveTextContent('proud of you');
    expect(screen.getByTestId('cheers')).toHaveTextContent('0');

    fakeSupabase.seed({
      reactions: [
        {
          actor_id: OTHER,
          target_type: 'task',
          target_id: '99999999-9999-4999-8999-999999999999',
          kind: 'cheer',
        },
      ],
    });
    await settle(60_000);

    expect(screen.getByTestId('cheers')).toHaveTextContent('1');
    // And the note is still there — the carry-over is what this must not cost.
    expect(screen.getByTestId('feedNotes')).toHaveTextContent('proud of you');
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

/**
 * The Global feed, once it is made of rows.
 *
 * The behavioural hinge of the whole change is at the bottom of this block: a
 * cheer on a bot's post is a cheer on a real task with a uuid, so it enqueues —
 * where the identical tap on a demo post is dropped, three tests above.
 */
describe('the Oz bots', () => {
  it('arrive in their own feed, not the circle’s', async () => {
    mount();
    await settle();
    aBotStakes();

    await settle(60_000);

    expect(screen.getByTestId('globals')).toHaveTextContent('Walked the whole way');
    // Not in `moments`. They share no circle with you, and a bot in the Friends
    // feed would be a stranger sitting among your people.
    expect(screen.getByTestId('feed')).toHaveTextContent('');
  });

  it('land in the directory, so the card has a name to draw', async () => {
    mount();
    await settle();
    aBotStakes();

    await settle(60_000);

    // Without this every Global card reads "Someone", which is the state the
    // feed was in for as long as it was made of real rows. Your own row is in
    // the directory alongside them, whether or not you are in a circle —
    // `pullCircle` asks for it by id, because it is where your avatar's state
    // arrives from.
    expect(screen.getByTestId('people')).toHaveTextContent(
      [currentUserId() as string, BOT].sort().join(','),
    );
    // `withStats` counts their week off the same rows — the card's stat line.
    expect(screen.getByTestId('stats')).toHaveTextContent(`${BOT}:0/1`);
  });

  it('are in the directory but in nobody’s circle', async () => {
    // Seen on device: an account that knew nobody read "5 people, ranked by
    // follow-through" over a leaderboard of four Wizard of Oz characters —
    // `circleMembers` is the whole directory on a live account, and the bots
    // are in it. It also meant the account was never "alone", so the one
    // prompt that would have got it a real circle never appeared.
    mount();
    await settle();
    aBotStakes();

    await settle(60_000);

    expect(screen.getByTestId('people')).toHaveTextContent(
      [currentUserId() as string, BOT].sort().join(','),
    );
    expect(screen.getByTestId('members')).not.toHaveTextContent(BOT);
  });

  it('stay out of the circle even when they are in one', async () => {
    // The overlap `dedupePeople` exists for. `pullCircle` and `pullBots` are
    // separate reads over the same table, the circle read comes first, and
    // first copy wins — so a bot that shares a circle with you arrives as the
    // *unflagged* copy. Marked from the bot query's id set instead of stamped
    // onto its rows, which is what makes the flag survive whichever copy won.
    mount();
    await settle();
    const me = currentUserId() as string;
    inACircleWith(me);
    aBotStakes();
    // Put the bot in that circle too, so both reads name it.
    fakeSupabase.seed({
      circle_members: [{ circle_id: CIRCLE, profile_id: BOT }],
    });

    await settle(60_000);

    // Regexes, not bare strings: both probes render comma-joined lists here,
    // and `toHaveTextContent` matches a bare string exactly.
    expect(screen.getByTestId('people')).toHaveTextContent(new RegExp(BOT));
    expect(screen.getByTestId('members')).not.toHaveTextContent(new RegExp(BOT));
  });

  it('bring their cheer counts, minus your own', async () => {
    mount();
    await settle();
    const me = currentUserId() as string;
    inACircleWith(me);
    aBotStakes();
    fakeSupabase.seed({
      reactions: [
        { actor_id: OTHER, target_type: 'task', target_id: BOT_TASK, kind: 'cheer' },
        { actor_id: me, target_type: 'task', target_id: BOT_TASK, kind: 'cheer' },
      ],
    });

    await settle(60_000);

    // One, not two: the screen adds your own tap, exactly as it does on the
    // Friends feed. Counting it here would double it.
    expect(screen.getByTestId('globalCheers')).toHaveTextContent('1');
  });

  it('take a cheer that a demo post could never send', async () => {
    mount();
    await settle();
    aBotStakes();
    await settle(60_000);

    act(() => dispatch({ type: 'ACT', id: BOT_TASK, kind: 'cheer' }));
    await settle(10_000);

    // The hinge. `parseActedKey` gates on the id being a uuid, so the same tap
    // on `g1` is dropped and this one is a row Dorothy's ledger can hold.
    expect(fakeSupabase.rows('reactions')).toHaveLength(1);
    expect(pending()).toHaveLength(0);
  });

  it('take a note, for the same reason', async () => {
    mount();
    await settle();
    aBotStakes();
    await settle(60_000);

    act(() => dispatch({ type: 'OPEN_SHEET', sheet: { type: 'task', id: BOT_TASK } }));
    act(() => dispatch({ type: 'SET_NOTE', value: 'Respect.' }));
    act(() => dispatch({ type: 'SEND_NOTE' }));
    await settle(10_000);

    expect(screen.getByTestId('globalNotes')).toHaveTextContent('Respect.');
    expect(fakeSupabase.rows('notes')).toHaveLength(1);
    expect(fakeSupabase.rows('notes')[0]?.body).toBe('Respect.');
  });

  it('keep a note you left when their feed refreshes', async () => {
    mount();
    await settle();
    aBotStakes();
    await settle(60_000);

    act(() => dispatch({ type: 'OPEN_SHEET', sheet: { type: 'task', id: BOT_TASK } }));
    act(() => dispatch({ type: 'SET_NOTE', value: 'Respect.' }));
    act(() => dispatch({ type: 'SEND_NOTE' }));
    await settle(10_000);

    // The pull answers for the rows, not for the thread this device wrote on
    // them — so a merge that did not carry it would blink the note away. Poked
    // directly rather than re-seeded: it has to be the *same* row coming back
    // changed, which is what a refresh is.
    const row = fakeSupabase.rows('tasks').find((r) => r.id === BOT_TASK);
    if (row) row.done_at = new Date().toISOString();
    await settle(60_000);

    expect(screen.getByTestId('globalNotes')).toHaveTextContent('Respect.');
  });

  /**
   * Seen on a live account against a local stack: the composer's "In it with
   * me" row offered Dorothy twice.
   *
   * A bot's account is minted by `scripts/seed-bots.mjs`, so re-seeding after a
   * database reset — or pointing the app at a second backend — gives the same
   * character a new uuid. Both rows then sat in `people`, which only ever grew,
   * and `circleMembers()` is `Object.keys(people)`: one chip each, same name,
   * same face. It survived restarts too, because `people` is persisted.
   */
  it('do not linger under an id the server has stopped answering with', async () => {
    mount();
    await settle();
    aBotStakes();
    await settle(60_000);
    expect(screen.getByTestId('people')).toHaveTextContent(new RegExp(BOT));

    // The same bot, re-seeded: one profile row, one uuid, and the old one gone
    // — which is exactly what `npm run db:bots` does after a `db reset`.
    const REBORN = '00000000-0000-4000-8000-0000000000b1';
    await act(async () => {
      await getSupabase().from('tasks').delete().eq('owner_id', BOT);
      await getSupabase().from('profiles').delete().eq('id', BOT);
    });
    fakeSupabase.seed({
      profiles: [{ id: REBORN, handle: 'dorothy.gale', name: 'Dorothy Gale', is_bot: true }],
      tasks: [
        {
          id: BOT_TASK,
          owner_id: REBORN,
          week_start: weekOnScreen(),
          day: 1,
          title: 'Walked the whole way',
          category: 'Fitness',
          points: 20,
          aud: 'everyone',
          source: 'staked',
        },
      ],
    });

    await settle(60_000);

    expect(screen.getByTestId('people')).toHaveTextContent(new RegExp(REBORN));
    expect(screen.getByTestId('people')).not.toHaveTextContent(new RegExp(BOT));
  });

  /**
   * The same bug one step further out, and the reason the pull answers with the
   * directory even when the directory is empty.
   *
   * A backend that names nobody — an `.env` repointed at a stack with no bots
   * seeded and no circle joined yet — used to say nothing at all rather than
   * "nobody", because the merge only carried `people` when it had rows. The
   * previous backend's whole cast then sat in the directory, and on disk, with
   * no pull that could ever clear it.
   */
  it('leave the directory when the backend stops naming anyone at all', async () => {
    mount();
    await settle();
    aBotStakes();
    await settle(60_000);
    expect(screen.getByTestId('people')).toHaveTextContent(new RegExp(BOT));

    await act(async () => {
      await getSupabase().from('tasks').delete().eq('owner_id', BOT);
      await getSupabase().from('profiles').delete().eq('id', BOT);
    });

    await settle(60_000);

    expect(screen.getByTestId('people')).not.toHaveTextContent(new RegExp(BOT));
    expect(screen.getByTestId('globals')).toHaveTextContent('');
  });

  /**
   * The control on the test above. Dropping whoever the payload does not name
   * is only safe because the payload is the *whole* directory; if a merge that
   * carries the bots could evict your circle, this would be a worse bug than
   * the one it fixes.
   */
  it('arriving does not evict the people you share a circle with', async () => {
    mount();
    await settle();
    inACircleWith(currentUserId() as string);
    aBotStakes();

    await settle(60_000);

    expect(screen.getByTestId('people')).toHaveTextContent(new RegExp(OTHER));
    expect(screen.getByTestId('people')).toHaveTextContent(new RegExp(BOT));
  });
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
  act(() => dispatch({ type: 'FINISH_ONBOARD', stakes: [], aud: 'friends', name: '', circleId: null }));
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

describe('pull_world', () => {
  const mayaTask = () =>
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
        },
      ],
    });

  it('answers a whole pull in one round trip, with no per-table reads', async () => {
    mount();
    await settle();
    inACircleWith(currentUserId() as string);
    mayaTask();
    fakeSupabase.calls.length = 0;

    await settle(60_000);

    // The feed landed…
    expect(screen.getByTestId('feed')).toHaveTextContent('Swim 2k');
    // …through the RPC, and through nothing else. A read appearing here means
    // the waterfall ran alongside the fast path and the two answers could
    // disagree — the exact bug the single round trip exists to rule out.
    const worlds = fakeSupabase.calls.filter(
      (c) => c.method === 'rpc' && c.table === 'pull_world',
    );
    expect(worlds.length).toBeGreaterThan(0);
    expect(fakeSupabase.calls.filter((c) => c.method === 'select')).toHaveLength(0);
  });

  it('falls back to the per-table pulls on a server without it, and stops asking', async () => {
    // The next rpc call — the first pull's `pull_world` — answers as an
    // un-migrated backend would: the function is not in the schema cache.
    fakeSupabase.failNext(1, {
      code: 'PGRST202',
      message: 'Could not find the function public.pull_world in the schema cache',
    });
    mount();
    await settle();
    inACircleWith(currentUserId() as string);
    mayaTask();

    await settle(120_000);

    // The waterfall carried the same world the RPC would have.
    expect(screen.getByTestId('feed')).toHaveTextContent('Swim 2k');
    // Asked exactly once. "No such function" is a fact about the deployment,
    // not the request — every pull after the first goes straight to the
    // per-table reads rather than paying a doomed round trip at the head.
    const worlds = fakeSupabase.calls.filter(
      (c) => c.method === 'rpc' && c.table === 'pull_world',
    );
    expect(worlds).toHaveLength(1);
    expect(fakeSupabase.calls.filter((c) => c.method === 'select').length).toBeGreaterThan(0);
  });
});

/**
 * Deleting the goal has to take the photo with it, and until now it did not.
 *
 * Taking a photo *off* a goal sends `media.detach`, which deletes the row and
 * then the object. Deleting the goal underneath that photo sent only
 * `task.delete` and relied on `task_media`'s `on delete cascade` — which takes
 * the row and leaves the object, because Postgres cannot reach into a bucket.
 * The file then belongs to nobody: `can_see_media` refuses an object no `ready`
 * row claims, so it is unreadable, and it is also uncollectable, because
 * nothing else in the app or the schema ever looks at it again.
 *
 * Asserted through the reducer rather than through the chip, because this is
 * the engine's diff loop noticing a task has gone, not a tap. The chip's own
 * removal path is covered in `src/overlays/__tests__/taskPhoto.test.tsx`.
 */
describe('a goal deleted with a photo on it', () => {
  it('detaches the photo instead of leaving the object behind', async () => {
    mount();
    await settle();
    stake('Run 5k');
    await settle();

    const id = taskIds()[0];
    const mediaId = '44444444-4444-4444-8444-444444444444';
    act(() =>
      dispatch({
        type: 'ATTACH_MEDIA',
        id,
        media: { id: mediaId, path: `owner/${id}/${mediaId}.jpg`, w: 10, h: 10 },
      }),
    );
    await settle();

    act(() => dispatch({ type: 'REMOVE_TASK', id }));
    await settle();

    expect(ops()).toContain('media.detach');
  });

  it('sends nothing extra for a goal that never had one', async () => {
    // The guard is `gone.media`, and this is the half of it that would
    // otherwise go unasserted: a detach enqueued for every deleted goal would
    // still pass the test above.
    mount();
    await settle();
    stake('Read a chapter');
    await settle();

    const id = taskIds()[0];
    act(() => dispatch({ type: 'REMOVE_TASK', id }));
    await settle();

    expect(ops()).not.toContain('media.detach');
  });
});

/**
 * More than one circle, which the pull has answered for since
 * `20260901090000_pull_world_all_circles.sql` and the client has carried since
 * `state.circle` became `state.circles`.
 */
describe('an account in two circles', () => {
  const SECOND = '44444444-4444-4444-8444-444444444444';

  const inTwoCircles = (me: string) => {
    inACircleWith(me);
    fakeSupabase.seed({
      circles: [
        { id: SECOND, name: 'Gym', invite_code: 'gym-0123456789abcdef', created_by: me },
      ],
      circle_members: [{ circle_id: SECOND, profile_id: me }],
    });
  };

  it('lands both, oldest first', async () => {
    mount();
    await settle();
    inTwoCircles(currentUserId() as string);
    await settle(60_000);

    expect(screen.getByTestId('circles')).toHaveTextContent('The Basement,Gym');
    // The active one, with no picker yet, is the first — and it is the invite
    // code the share sheet would hand out.
    expect(screen.getByTestId('circle')).toHaveTextContent('basement-0123456789abcdef');
  });

  it('says which circle each member is in, and survives the directory pipeline', async () => {
    // The pipeline is the risk, not the read. A person goes through
    // `dedupePeople` → the `isBot` stamp → `withStats` before reaching the
    // reducer, and `dedupePeople`'s own comment names this hazard for `bot`:
    // it keeps the *first* copy of an id, so anything the later copy carried is
    // dropped. Memberships come from the circle read, which is first — asserted
    // rather than assumed, because the last field to be dropped this way was
    // only ever found on a device.
    mount();
    await settle();
    const me = currentUserId() as string;
    inTwoCircles(me);
    await settle(60_000);

    expect(screen.getByTestId('circleIds')).toHaveTextContent(
      `${me}:The Basement+Gym,${OTHER}:The Basement`,
    );
  });

  it('says nothing on a second pull that carries the same two', async () => {
    mount();
    await settle();
    inTwoCircles(currentUserId() as string);
    await settle(60_000);

    const renders = rendered.count;
    await settle(120_000);

    // Every pull mints new objects for the same circles, so this is the
    // field-wise comparison holding. Without it the provider would re-render
    // every screen once a minute for a payload that said nothing.
    expect(rendered.count).toBe(renders);
  });

  it('brings both back after a reseed empties them', async () => {
    mount();
    await settle();
    inTwoCircles(currentUserId() as string);
    await settle(60_000);
    expect(screen.getByTestId('circles')).toHaveTextContent('The Basement,Gym');

    act(() => dispatch({ type: 'SET_ACCOUNT', mode: 'live' }));
    expect(screen.getByTestId('circles')).toHaveTextContent('');

    // `rearmCleared` generalised to a list: emptiness is still the trigger, and
    // `[]` is what emptiness looks like when the slice is an array.
    await settle(60_000);
    expect(screen.getByTestId('circles')).toHaveTextContent('The Basement,Gym');
  });
});

/**
 * A reseed that happens while the engine keeps running.
 *
 * `SET_ACCOUNT` and `RESET` both clear every slice the pull owns, on the
 * reasoning that the server they came from belongs to the account being left
 * behind. But choosing `live` again does not move `syncOn`, so the engine is
 * not rebuilt — and its "did this move?" baselines are private to the closure.
 * A baseline that outlives the clear makes the next pull answer "nothing to
 * do" about a slice the store no longer has, and the answer never comes back
 * until the process restarts.
 *
 * That is the resumed-onboarding bug in its smallest form: the circle is the
 * slice people notice, but the same tap takes the feed, the Global tab, the
 * bell and the Me screen's cheer count with it.
 */
describe('a reseed while the engine keeps running', () => {
  const FRIEND_TASK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  /** Every slice only a pull can fill, populated: circle, feed, globals, bell, count. */
  const everythingTheServerOwns = async () => {
    mount();
    await settle();
    const me = currentUserId() as string;
    inACircleWith(me);
    aBotStakes();
    fakeSupabase.seed({
      tasks: [
        {
          id: FRIEND_TASK,
          owner_id: OTHER,
          week_start: weekOnScreen(),
          day: 2,
          title: 'Swim 2k',
          category: 'Fitness',
          points: 40,
          aud: 'friends',
          source: 'staked',
        },
      ],
    });
    stake('ride to the bridge');
    await settle(10_000);
    const mine = taskIds()[0] as string;
    fakeSupabase.seed({
      // The cheer twice over: the reaction row is what the Me screen counts,
      // and the notification row is what the bell draws. They are separate
      // tables answered by separate reads, so seeding one proves nothing about
      // the other.
      reactions: [{ actor_id: OTHER, target_type: 'task', target_id: mine, kind: 'cheer' }],
      notifications: [
        {
          id: 'aaaaaaaa-1111-4111-8111-111111111111',
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
    return me;
  };

  const fiveSlices = () => ({
    circle: screen.getByTestId('circle').props.children,
    feed: screen.getByTestId('feed').props.children,
    globals: screen.getByTestId('globals').props.children,
    notifs: screen.getByTestId('notifs').props.children,
    received: screen.getByTestId('received').props.children,
  });

  it('makes every slice the pull owns come back', async () => {
    await everythingTheServerOwns();
    expect(fiveSlices()).toEqual({
      circle: 'basement-0123456789abcdef',
      feed: 'Swim 2k',
      globals: 'Walked the whole way',
      notifs: 'Maya Chen cheered “ride to the bridge”',
      received: '1',
    });

    // Choosing `live` again — what the welcome screen dispatches when onboarding
    // resumes after a force-quit. Everything server-derived goes.
    act(() => dispatch({ type: 'SET_ACCOUNT', mode: 'live' }));
    expect(fiveSlices()).toEqual({
      circle: '',
      feed: '',
      globals: '',
      notifs: '',
      received: '0',
    });

    // One pull is all it should take. Nothing about the server changed, so
    // every one of these is the engine deciding whether to speak.
    await settle(60_000);
    expect(fiveSlices()).toEqual({
      circle: 'basement-0123456789abcdef',
      feed: 'Swim 2k',
      globals: 'Walked the whole way',
      notifs: 'Maya Chen cheered “ride to the bridge”',
      received: '1',
    });
  });

  it('does not mistake the reseed for the user deleting their week', async () => {
    // The reseed empties `myTasks`, and a reference diff cannot tell that from
    // somebody clearing their week by hand — so it enqueued a `task.delete`
    // per goal, and they drained against real rows. What made this survivable
    // for so long was an accident: reseeding also pinned `selfId` back to the
    // sentinel, which tripped the store's identity-change effect, which threw
    // the queue away first. That clear is async and this one is not a race
    // worth keeping.
    await everythingTheServerOwns();
    expect(fakeSupabase.rows('tasks').map((r) => r.title)).toContain('ride to the bridge');

    act(() => dispatch({ type: 'SET_ACCOUNT', mode: 'live' }));
    await settle(60_000);

    expect(pending().map((e) => e.op)).not.toContain('task.delete');
    // The row itself, which is the thing a friend's feed is reading.
    expect(fakeSupabase.rows('tasks').map((r) => r.title)).toContain('ride to the bridge');
  });

  it('goes quiet again once it has spoken', async () => {
    // The failure mode of the obvious fix. Mirroring the baselines onto state
    // every commit would make a slice the reducer declines to adopt disagree
    // with the pull forever, and dispatch a merge a minute for the life of the
    // app. Re-arming only on a slice the store has emptied can fire once.
    await everythingTheServerOwns();
    act(() => dispatch({ type: 'SET_ACCOUNT', mode: 'live' }));
    await settle(60_000);

    const renders = rendered.count;
    await settle(180_000);

    expect(rendered.count).toBe(renders);
  });
});
