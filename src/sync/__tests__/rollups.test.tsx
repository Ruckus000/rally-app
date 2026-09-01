/**
 * A closed week reaching the server, and coming back onto a device that has
 * never seen it.
 *
 * Both halves are asserted end to end rather than at their seams, for one
 * specific reason: **the engine swallows pull failures**. A `pullRollups` that
 * threw on every cycle would leave every other test in this suite green and this
 * feature silently dead, so the only honest assertion is the restored history
 * itself.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { fakeSupabase } from '../../__mocks__/@supabase/supabase-js';
import { StoreProvider, useStore, type Action } from '../../state/store';
import { liveWeek } from '../../data/week';
import { mondayOf } from '../mappers';
import { __resetOutboxForTests, pending } from '../outbox';
import { __resetSessionForTests, currentUserId } from '../session';
import { __resetSupabaseForTests } from '../../lib/supabase';
import { queueRollup, queueWeekShare } from '../engine';

let dispatch: (a: Action) => void;

function Probe() {
  const store = useStore();
  const state = store.state;
  React.useEffect(() => {
    dispatch = store.dispatch;
  }, [store.dispatch]);
  return (
    <>
      <Text testID="weeks">{String(state.history.length)}</Text>
      <Text testID="labels">{state.history.map((h) => h.label).join(',')}</Text>
      <Text testID="points">{String(state.profile.allTimePoints)}</Text>
      <Text testID="streak">{String(state.profile.currentStreak)}</Text>
      <Text testID="levels">{state.yearLevels.join(',')}</Text>
      <Text testID="feed">{state.moments.map((m) => m.title ?? '').join('|')}</Text>
      {/* The numbers, separately from the title: `BIG_CARD_STATS` is
          7/7 · 285 · 5w, so a card drawing the constant would satisfy an
          assertion about the title alone. */}
      <Text testID="feedStats">
        {state.moments
          .filter((m) => m.week)
          .map((m) => `${m.week!.done}/${m.week!.total}|${m.week!.points}|${m.week!.streak}w`)
          .join(',')}
      </Text>
    </>
  );
}

const realEnv = { ...process.env };

beforeEach(() => {
  jest.useFakeTimers();
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  fakeSupabase.reset();
  __resetSupabaseForTests();
  __resetSessionForTests();
  __resetOutboxForTests();
});

afterEach(() => {
  jest.useRealTimers();
  process.env = { ...realEnv };
});

const mount = () =>
  render(
    <StoreProvider persist sync restored={{ account: 'live' }}>
      <Probe />
    </StoreProvider>,
  );

const settle = async (ms = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

const read = (id: string) => screen.getByTestId(id).props.children as string;

const OTHER = '22222222-2222-4222-8222-222222222222';
const CIRCLE = '33333333-3333-4333-8333-333333333333';

/** Somebody else in a circle with you, so their rows can reach this account. */
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

/** Weeks already on the server, as a recovered account would find them. */
const serverHas = (userId: string, weeks: { start: string; points: number; done: number; total: number }[]) => {
  fakeSupabase.seed({
    week_rollups: weeks.map((w) => ({
      profile_id: userId,
      week_start: w.start,
      points: w.points,
      done: w.done,
      total: w.total,
      perfect: w.total > 0 && w.done === w.total,
      streak_held: w.done > 0,
    })),
  });
};

describe('sending a week that closed', () => {
  it('queues one rollup for the week, keyed so it cannot queue twice', () => {
    queueRollup({
      weekStart: '2026-08-10',
      points: 120,
      done: 5,
      total: 6,
      perfect: false,
      streakHeld: true,
    });
    queueRollup({
      weekStart: '2026-08-10',
      points: 120,
      done: 5,
      total: 6,
      perfect: false,
      streakHeld: true,
    });

    const queued = pending().filter((e) => e.op === 'rollup.add');
    expect(queued).toHaveLength(1);
    expect(queued[0].key).toBe('rollup:2026-08-10');
  });

  it('reaches the table, and a replay leaves the first row alone', async () => {
    mount();
    await settle(0);
    const me = currentUserId() as string;

    queueRollup({
      weekStart: mondayOf(liveWeek()),
      points: 120,
      done: 5,
      total: 6,
      perfect: false,
      streakHeld: true,
    });
    await settle(6_000);

    const rows = fakeSupabase.rows('week_rollups');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ profile_id: me, points: 120, done: 5, total: 6 });
  });
});

describe('posting a week to your circles', () => {
  it('queues one share, keyed so a double tap cannot post twice', () => {
    const share = { weekStart: '2026-08-10', points: 150, done: 6, total: 6, streak: 5 };
    queueWeekShare(share);
    queueWeekShare(share);

    const queued = pending().filter((e) => e.op === 'week.share');
    expect(queued).toHaveLength(1);
    expect(queued[0].key).toBe('share:2026-08-10');
  });

  it('refuses a week that is not actually finished', () => {
    // The table's own check constraint refuses it too, and a 23514 is permanent
    // — so it would sit in dead letters saying nothing useful. The button cannot
    // produce this, so the guard is against a caller rather than a user.
    queueWeekShare({ weekStart: '2026-08-10', points: 100, done: 4, total: 6, streak: 2 });
    queueWeekShare({ weekStart: '2026-08-10', points: 0, done: 0, total: 0, streak: 0 });

    expect(pending().filter((e) => e.op === 'week.share')).toHaveLength(0);
  });

  it('reaches the table, and a replay leaves the first row alone', async () => {
    mount();
    await settle(0);
    const me = currentUserId() as string;

    queueWeekShare({
      weekStart: mondayOf(liveWeek()),
      points: 150,
      done: 6,
      total: 6,
      streak: 5,
    });
    await settle(6_000);

    const rows = fakeSupabase.rows('week_shares');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ profile_id: me, points: 150, done: 6, total: 6, streak: 5 });
  });
});

describe('somebody else\'s posted week, in your feed', () => {
  it('arrives as a card carrying their real numbers', async () => {
    mount();
    await settle(0);
    const me = currentUserId() as string;
    inACircleWith(me);

    fakeSupabase.seed({
      week_shares: [
        {
          profile_id: OTHER,
          week_start: mondayOf(liveWeek()),
          points: 210,
          done: 7,
          total: 7,
          streak: 4,
        },
      ],
    });
    await settle(60_000);

    // The numbers are the point. `BIG_CARD_STATS` is 7/7 · 285 · 5w, so a card
    // rendering the constant would pass a looser assertion than this one.
    expect(read('feed')).toContain('7 of 7 — the entire week');
    expect(read('feedStats')).toBe('7/7|210|4w');
  });

  it('does not arrive until they post it', async () => {
    mount();
    await settle(0);
    inACircleWith(currentUserId() as string);
    await settle(60_000);

    expect(read('feed')).not.toContain('the entire week');
  });
});

describe('getting the weeks back', () => {
  it('restores history, the year grid and the totals onto an empty device', async () => {
    mount();
    await settle(0);
    const me = currentUserId() as string;

    serverHas(me, [
      { start: '2026-07-27', points: 40, done: 2, total: 5 },
      { start: '2026-08-03', points: 150, done: 6, total: 6 },
      { start: '2026-08-10', points: 90, done: 3, total: 4 },
    ]);
    // The next pull, which is the first one that has anything to find.
    await settle(60_000);

    expect(read('weeks')).toBe('3');
    // Newest first, which is the order the Ledger reads.
    expect(read('labels').split(',')[0]).toBe('Week 33');
    // Rebuilt rather than restored: nothing on the server carries a total.
    expect(read('points')).toBe('280');
    // Three weeks that each closed something.
    expect(read('streak')).toBe('3');
    // Ascending, and one entry per week: partial, perfect, partial.
    expect(read('levels')).toBe('1,3,2');
  });

  it('leaves a device that already has history alone', async () => {
    mount();
    await settle(0);
    const me = currentUserId() as string;

    // A week closed on this device, before any pull could answer.
    act(() =>
      dispatch({
        type: 'SERVER_MERGE',
        merge: {
          rollups: [
            {
              n: 99,
              label: 'Week 99',
              points: 10,
              done: 1,
              total: 1,
              sub: '1 of 1 done',
              quiet: false,
              did: [],
              helpedBy: [],
              helped: [],
            },
          ],
        },
      }),
    );
    expect(read('weeks')).toBe('1');

    serverHas(me, [
      { start: '2026-07-27', points: 40, done: 2, total: 5 },
      { start: '2026-08-03', points: 150, done: 6, total: 6 },
    ]);
    await settle(60_000);

    // Still the one week. Filling the gaps would mean matching on `n`, an ISO
    // week number that repeats every year — so this deliberately does nothing.
    expect(read('weeks')).toBe('1');
    expect(read('labels')).toBe('Week 99');
  });

  it('changes nothing on the second pull, so a repeat is free', async () => {
    mount();
    await settle(0);
    const me = currentUserId() as string;

    serverHas(me, [{ start: '2026-08-03', points: 150, done: 6, total: 6 }]);
    await settle(60_000);
    expect(read('weeks')).toBe('1');
    const before = read('points');

    await settle(60_000);

    // The merge is sent on every pull; the reducer's empty-history rule is what
    // makes the repeat a no-op rather than a doubling.
    expect(read('weeks')).toBe('1');
    expect(read('points')).toBe(before);
  });
});
