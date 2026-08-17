/**
 * A bot cannot finish a goal on a day nobody has reached yet.
 *
 * `seed-bots.mjs` stakes a whole week — days, prices and outcomes — in one
 * command, whenever you happen to run it. Asked for the week's shape, the model
 * quite reasonably returns a finished week, and staking that on a Monday
 * evening produced a Global feed announcing that Dorothy had completed "Hike
 * six miles with the dog on Saturday". That is the first screen a new account
 * sees, and it was describing a Saturday that had not happened.
 *
 * No prompt wording makes a future outcome true, so this is enforced in code
 * rather than asked for. The prompt is told the day as well, but only so the
 * shape it proposes is plausible before the clamp has to correct it.
 */
import { possible, thisMonday, todayIndex } from '../week.mjs';

// Wednesday, so there are days on both sides of today to test against.
const WEDNESDAY = new Date(2026, 7, 19, 14, 0, 0);

describe('what could have happened by now', () => {
  const today = todayIndex(WEDNESDAY);

  it('lets a goal on a day already past be closed', () => {
    expect(possible(0, true, today)).toBe(true);
    expect(possible(1, true, today)).toBe(true);
  });

  it('lets a goal staked for today be closed, because the day is not over', () => {
    expect(possible(today, true, today)).toBe(true);
  });

  it('refuses to close anything later in the week', () => {
    // The bug. Every one of these came back closed on a Monday.
    for (const day of [3, 4, 5, 6]) {
      expect(possible(day, true, today)).toBe(false);
    }
  });

  it('never invents a closure the model did not ask for', () => {
    // The clamp only ever takes away. A missed goal stays missed.
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      expect(possible(day, false, today)).toBe(false);
    }
  });

  it('treats anything that is not exactly true as not done', () => {
    // The value came out of a model's JSON, so it can be a string or absent.
    for (const done of ['true', 1, undefined, null]) {
      expect(possible(0, done as unknown as boolean, today)).toBe(false);
    }
  });
});

describe('where the week starts', () => {
  it('counts Monday as day 0 and Sunday as day 6', () => {
    expect(todayIndex(new Date(2026, 7, 17))).toBe(0);
    expect(todayIndex(new Date(2026, 7, 23))).toBe(6);
  });

  it('walks back to Monday from any day in the week', () => {
    // Sunday is the one that catches a naive `getDay()`, since it is 0 there
    // and six days into the week here.
    expect(thisMonday(new Date(2026, 7, 17))).toBe('2026-08-17');
    expect(thisMonday(WEDNESDAY)).toBe('2026-08-17');
    expect(thisMonday(new Date(2026, 7, 23))).toBe('2026-08-17');
  });

  it('pads a single-digit month and day', () => {
    expect(thisMonday(new Date(2026, 0, 8))).toBe('2026-01-05');
  });
});
