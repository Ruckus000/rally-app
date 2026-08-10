/**
 * The ranking is the load-bearing selector: the Circle row must read the same
 * metric the sort uses, or the screen implies an order it doesn't have.
 */
import { reducer, State } from '../store';
import {
  allTasksDone,
  cheersGiven,
  circleCheersGiven,
  helpedByThisWeek,
  myRank,
  personalFeed,
  ranking,
  stakedPoints,
  totalCheersExchanged,
  unreadNeedsCount,
  weekPoints,
} from '../selectors';
import { WORLD } from '../../data/seed';
import { baseState as base } from '../../test/baseState';


describe('points', () => {
  it('counts only closed stakes toward the week', () => {
    expect(weekPoints(base)).toBe(40);
  });

  it('counts every stake toward what is on the line', () => {
    expect(stakedPoints(base)).toBe(190);
  });

  it('knows a perfect week from a partial one', () => {
    expect(allTasksDone(base)).toBe(false);
    const all = base.myTasks.reduce(
      (s, t) => (t.done ? s : reducer(s, { type: 'TOGGLE_TASK', id: t.id })),
      base,
    );
    expect(allTasksDone(all)).toBe(true);
  });

  it('treats an empty week as unfinished, not perfect', () => {
    expect(allTasksDone({ ...base, myTasks: [] })).toBe(false);
  });
});

describe('ranking', () => {
  it('ranks everyone in the circle', () => {
    expect(ranking(base)).toHaveLength(WORLD.seeded.members.length);
  });

  it('sorts by follow-through, so a full week beats a bigger partial one', () => {
    const order = ranking(base).map((r) => r.k);
    expect(order[0]).toBe('maya'); // 7/7
    expect(order.indexOf('nana')).toBeLessThan(order.indexOf('dre')); // 6/6 over 5/7
    expect(order[order.length - 1]).toBe('you'); // 1/6
  });

  it('states the metric the sort actually uses', () => {
    const dre = ranking(base).find((r) => r.k === 'dre');
    expect(dre?.sub).toBe('71% · 5 of 7 · 🔥 2w');
  });

  it('omits the streak from the metric when there is none', () => {
    const jordan = ranking(base).find((r) => r.k === 'jordan');
    expect(jordan?.sub).toBe('20% · 1 of 5');
  });

  it('moves you up as you close stakes', () => {
    const before = myRank(base);
    const all = base.myTasks.reduce(
      (s, t) => (t.done ? s : reducer(s, { type: 'TOGGLE_TASK', id: t.id })),
      base,
    );
    expect(myRank(all)).toBeLessThan(before);
  });
});

describe('cheers', () => {
  it('counts only cheers, not replies or joins', () => {
    let s = reducer(base, { type: 'ACT', id: 'f1', kind: 'cheer' });
    s = reducer(s, { type: 'ACT', id: 'f2', kind: 'in' });
    s = reducer(s, { type: 'ACT', id: 'f5', kind: 'cosign' });
    expect(cheersGiven(s)).toBe(WORLD.seeded.profile.baseCheersGiven + 1);
  });

  it('feeds the circle total', () => {
    const before = totalCheersExchanged(base);
    const s = reducer(base, { type: 'ACT', id: 'f1', kind: 'cheer' });
    expect(totalCheersExchanged(s)).toBe(before + 1);
  });

  describe('scope', () => {
    // The Circle bar says "in the circle", so a cheer given to a stranger on
    // the global feed must not inflate it.
    it('a cheer on a circle member counts everywhere', () => {
      const s = reducer(base, { type: 'ACT', id: 'f1', kind: 'cheer' });
      expect(cheersGiven(s)).toBe(cheersGiven(base) + 1);
      expect(circleCheersGiven(s)).toBe(circleCheersGiven(base) + 1);
      expect(totalCheersExchanged(s)).toBe(totalCheersExchanged(base) + 1);
    });

    it('a cheer on a global post counts on Me but not in the circle', () => {
      const s = reducer(base, { type: 'ACT', id: 'g1', kind: 'cheer' });
      expect(cheersGiven(s)).toBe(cheersGiven(base) + 1);
      expect(circleCheersGiven(s)).toBe(circleCheersGiven(base));
      expect(totalCheersExchanged(s)).toBe(totalCheersExchanged(base));
    });

    it('does not reorder the leaderboard — the sort ignores cheers given', () => {
      const before = ranking(base).map((r) => r.k);
      const s = reducer(base, { type: 'ACT', id: 'g1', kind: 'cheer' });
      expect(ranking(s).map((r) => r.k)).toEqual(before);
    });

    it('counts nothing toward the circle on an account that has none', () => {
      const fresh: State = { ...base, account: 'fresh', moments: [] };
      const s = reducer(fresh, { type: 'ACT', id: 'g1', kind: 'cheer' });
      expect(cheersGiven(s)).toBe(1);
      expect(circleCheersGiven(s)).toBe(0);
    });
  });
});

describe('personal feed order', () => {
  it('puts closed stakes first and opens them in day order', () => {
    const { done, open } = personalFeed(base);
    expect(done.map((t) => t.id)).toEqual(['m1']);
    expect(open.map((t) => t.day)).toEqual([...open.map((t) => t.day)].sort((a, b) => a - b));
  });
});

describe('unread badge', () => {
  it('counts only the tier that means someone is waiting', () => {
    const needs = WORLD.seeded.notifications.filter((n) => n.tier === 'needs').length;
    expect(unreadNeedsCount(base)).toBe(needs);
  });

  it('drops as those items are read', () => {
    const s = reducer(base, { type: 'READ_NOTIF', id: 'n1' });
    expect(unreadNeedsCount(s)).toBe(unreadNeedsCount(base) - 1);
  });

  it('ignores reads in the other tiers', () => {
    const s = reducer(base, { type: 'READ_NOTIF', id: 'n7' });
    expect(unreadNeedsCount(s)).toBe(unreadNeedsCount(base));
  });
});

describe('ledger rollup', () => {
  it('credits note authors and pairs, never yourself', () => {
    const map = helpedByThisWeek(base.myTasks);
    expect(map.you).toBeUndefined();
    expect(map.dre).toBeGreaterThan(0);
    expect(map.maya).toBeGreaterThan(0);
  });
});
