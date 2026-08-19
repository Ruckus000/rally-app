/**
 * Rebuilding the Me screen's numbers from the weeks themselves.
 *
 * This runs on exactly one path — the first pull after a reinstall, where
 * `history` came back from the server and the totals did not — which is a path
 * nobody exercises by accident. So the arithmetic is pinned here rather than
 * left to be discovered wrong by somebody who has just got their account back
 * and is looking at the wrong streak.
 *
 * The two streak numbers are different questions and are the easy ones to
 * conflate: `longestStreak` is the best run anywhere in the history,
 * `currentStreak` is the run still going at the newest end. A history that ends
 * quietly has a current streak of zero and a longest streak of whatever it
 * managed earlier.
 */
import { aggregatesFrom, closingWeek } from '../selectors';
import { weekSummary, type HistoryWeek, type Task } from '../../data/fixtures';

/** Newest first, as the reducer keeps it. */
const week = (n: number, points: number, done: number, total: number): HistoryWeek => ({
  n,
  label: `Week ${n}`,
  points,
  done,
  total,
  ...weekSummary(done, total),
  did: [],
  helpedBy: [],
  helped: [],
});

describe('rebuilding the totals', () => {
  it('adds up an empty history without inventing anything', () => {
    expect(aggregatesFrom([])).toEqual({
      allTimePoints: 0,
      weeksIn: 0,
      bestWeekPoints: 0,
      bestWeekLabel: '',
      longestStreak: 0,
      currentStreak: 0,
      mostTasksClosed: 0,
      perfectWeeks: 0,
    });
  });

  it('sums, counts and finds the best week', () => {
    const history = [week(35, 90, 3, 4), week(34, 150, 6, 6), week(33, 40, 2, 5)];

    expect(aggregatesFrom(history)).toMatchObject({
      allTimePoints: 280,
      weeksIn: 3,
      bestWeekPoints: 150,
      bestWeekLabel: 'Week 34',
      mostTasksClosed: 6,
      // Only week 34 closed everything it staked.
      perfectWeeks: 1,
    });
  });

  it('does not count a week that staked nothing as perfect', () => {
    // 0 of 0 is vacuously "all done" and is the trap in `done === total`.
    expect(aggregatesFrom([week(33, 0, 0, 0)]).perfectWeeks).toBe(0);
  });

  it('tells the current streak apart from the longest one', () => {
    // Newest first: two held, then a quiet week, then three held.
    const history = [
      week(38, 50, 2, 3),
      week(37, 50, 1, 3),
      week(36, 0, 0, 2),
      week(35, 60, 3, 3),
      week(34, 60, 3, 3),
      week(33, 60, 2, 3),
    ];

    const totals = aggregatesFrom(history);
    // The run still going at the newest end stops at the quiet week.
    expect(totals.currentStreak).toBe(2);
    // The best run anywhere is the three older ones.
    expect(totals.longestStreak).toBe(3);
  });

  it('gives a history that ends quietly no current streak at all', () => {
    const history = [week(35, 0, 0, 3), week(34, 60, 3, 3), week(33, 60, 3, 3)];

    expect(aggregatesFrom(history).currentStreak).toBe(0);
    expect(aggregatesFrom(history).longestStreak).toBe(2);
  });
});

describe('what a closing week scored', () => {
  const task = (done: boolean, pts: number): Task =>
    ({ id: `t${pts}${done}`, title: 't', cat: 'Work', pts, day: 0, done, aud: 'friends' }) as Task;

  it('counts only what was closed', () => {
    expect(closingWeek([task(true, 45), task(false, 30), task(true, 15)])).toEqual({
      points: 60,
      done: 2,
      total: 3,
      perfect: false,
      streakHeld: true,
    });
  });

  it('calls a fully closed week perfect, and an empty one neither', () => {
    expect(closingWeek([task(true, 45)])).toMatchObject({ perfect: true, streakHeld: true });
    // Nothing staked is not a perfect week, and does not hold a streak.
    expect(closingWeek([])).toMatchObject({ perfect: false, streakHeld: false, points: 0 });
  });
});
