/**
 * The ranking is the load-bearing selector: the Circle row must read the same
 * metric the sort uses, or the screen implies an order it doesn't have.
 */
import { reducer } from '../store';
import { personOf, type PersonId } from '../../data/people';
import {
  activeCircle,
  allTasksDone,
  cheersGiven,
  circleCheersGiven,
  circleMembers,
  circleSuggestions,
  helpedByThisWeek,
  helpedThisWeek,
  mergedFeed,
  myRank,
  personalFeed,
  ranking,
  stakedPoints,
  totalCheersExchanged,
  unreadNeedsCount,
  weekPoints,
} from '../selectors';
import { seedCircle, seedNotifications } from '../../data/seed';
import { parseHours } from '../../data/fixtures';
import { baseState as base, freshState } from '../../test/baseState';


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
    expect(ranking(base, null)).toHaveLength(seedCircle('seeded').length);
  });

  it('sorts by follow-through, so a full week beats a bigger partial one', () => {
    const order = ranking(base, null).map((r) => r.k);
    expect(order[0]).toBe('maya'); // 7/7
    expect(order.indexOf('nana')).toBeLessThan(order.indexOf('dre')); // 6/6 over 5/7
    expect(order[order.length - 1]).toBe('you'); // 1/6
  });

  it('states the metric the sort actually uses', () => {
    const dre = ranking(base, null).find((r) => r.k === 'dre');
    expect(dre?.sub).toBe('71% · 5 of 7 · 🔥 2w');
  });

  it('omits the streak from the metric when there is none', () => {
    const jordan = ranking(base, null).find((r) => r.k === 'jordan');
    expect(jordan?.sub).toBe('20% · 1 of 5');
  });

  it('moves you up as you close stakes', () => {
    const before = myRank(base, null);
    const all = base.myTasks.reduce(
      (s, t) => (t.done ? s : reducer(s, { type: 'TOGGLE_TASK', id: t.id })),
      base,
    );
    expect(myRank(all, null)).toBeLessThan(before);
  });
});

describe('cheers', () => {
  it('counts only cheers, not replies or joins', () => {
    let s = reducer(base, { type: 'ACT', id: 'f1', kind: 'cheer' });
    s = reducer(s, { type: 'ACT', id: 'f2', kind: 'in' });
    s = reducer(s, { type: 'ACT', id: 'f5', kind: 'cosign' });
    expect(cheersGiven(s)).toBe(base.profile.baseCheersGiven + 1);
  });

  it('feeds the circle total', () => {
    const before = totalCheersExchanged(base, null);
    const s = reducer(base, { type: 'ACT', id: 'f1', kind: 'cheer' });
    expect(totalCheersExchanged(s, null)).toBe(before + 1);
  });

  describe('scope', () => {
    // The Circle bar says "in the circle", so a cheer given to a stranger on
    // the global feed must not inflate it.
    it('a cheer on a circle member counts everywhere', () => {
      const s = reducer(base, { type: 'ACT', id: 'f1', kind: 'cheer' });
      expect(cheersGiven(s)).toBe(cheersGiven(base) + 1);
      expect(circleCheersGiven(s)).toBe(circleCheersGiven(base) + 1);
      expect(totalCheersExchanged(s, null)).toBe(totalCheersExchanged(base, null) + 1);
    });

    it('a cheer on a global post counts on Me but not in the circle', () => {
      const s = reducer(base, { type: 'ACT', id: 'g1', kind: 'cheer' });
      expect(cheersGiven(s)).toBe(cheersGiven(base) + 1);
      expect(circleCheersGiven(s)).toBe(circleCheersGiven(base));
      expect(totalCheersExchanged(s, null)).toBe(totalCheersExchanged(base, null));
    });

    it('does not reorder the leaderboard — the sort ignores cheers given', () => {
      const before = ranking(base, null).map((r) => r.k);
      const s = reducer(base, { type: 'ACT', id: 'g1', kind: 'cheer' });
      expect(ranking(s, null).map((r) => r.k)).toEqual(before);
    });

    it('counts nothing toward the circle on an account that has none', () => {
      const s = reducer(freshState, { type: 'ACT', id: 'g1', kind: 'cheer' });
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
    const needs = seedNotifications('seeded').filter((n) => n.tier === 'needs').length;
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

describe('who counts as your circle', () => {
  /** A live account: one real person, and the bots every account can see. */
  const live = {
    ...base,
    account: 'live' as const,
    people: {
      'u-1': personOf('u-1' as PersonId, 'Rae Silva'),
      'b-1': { ...personOf('b-1' as PersonId, 'Dorothy Gale'), bot: true },
      'b-2': { ...personOf('b-2' as PersonId, 'Tin Man'), bot: true },
    },
  };

  it('leaves the bots out', () => {
    // Seen on device: "5 people, ranked by follow-through" over a leaderboard
    // of Wizard of Oz characters, on an account that knew nobody.
    expect(circleMembers(live, null)).toEqual(['u-1']);
  });

  it('so an account with only bots is still a circle of one', () => {
    // Which is what the feed's invite prompt keys off. While the bots counted,
    // a brand-new account was never alone and never saw it.
    const { 'u-1': _, ...botsOnly } = live.people;
    expect(circleMembers({ ...live, people: botsOnly }, null)).toEqual([]);
  });
});

/**
 * The Week tab's one social feed. What used to be two tabs is now one list, so
 * the ordering and the label are the whole of what merging them decided — and
 * both are here rather than in a render test.
 */
describe('the merged feed', () => {
  it('carries every card from both halves', () => {
    const feed = mergedFeed(base, true);
    expect(feed).toHaveLength(base.moments.length + base.globalPosts.length);
    expect(feed.filter((e) => e.from === 'circle')).toHaveLength(base.moments.length);
    expect(feed.filter((e) => e.from === 'follow')).toHaveLength(base.globalPosts.length);
  });

  it('labels each card by the slice it came from', () => {
    const feed = mergedFeed(base, true);
    for (const { m, from } of feed) {
      const inCircle = base.moments.some((x) => x.id === m.id);
      expect(from).toBe(inCircle ? 'circle' : 'follow');
    }
  });

  it('interleaves by time rather than stacking one half on the other', () => {
    const feed = mergedFeed(base, true);
    const times = feed.map((e) => parseHours(e.m.time));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // Friends-first would change source exactly once. Interleaved is more.
    const flips = feed.filter((e, i) => i > 0 && e.from !== feed[i - 1]!.from).length;
    expect(flips).toBeGreaterThan(1);
  });

  it('still honours quietComebacks, and only on the circle half', () => {
    const quiet = mergedFeed(base, false);
    expect(quiet.some((e) => e.m.kind === 'quiet')).toBe(false);
    expect(quiet.filter((e) => e.from === 'follow')).toHaveLength(base.globalPosts.length);
  });

  it('draws an id in both slices once, as the circle’s', () => {
    // Impossible today — `pullBots` only returns bot owners, and a bot is in
    // nobody's circle — but a card drawn twice under one React key is a bad
    // way to find out that changed.
    const dupe = { ...base.globalPosts[0]!, id: base.moments[0]!.id };
    const feed = mergedFeed({ ...base, globalPosts: [dupe] }, true);
    const mine = feed.filter((e) => e.m.id === base.moments[0]!.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.from).toBe('circle');
  });
});

describe('reported content', () => {
  /**
   * The other half of what the report sheet promises. A block hides a person
   * and the server enforces it; a report hides one thing and *nothing* on the
   * server enforces that — `reports` is write-only and no queue drains it — so
   * this filter is the entire mechanism behind "it's hidden from you".
   */
  it('leaves the feed, without taking the rest of the person with it', () => {
    const theirs = base.moments.filter((m) => m.who !== base.selfId);
    const state = { ...base, reported: [theirs[0]!.id] };
    const ids = mergedFeed(state, true).map((e) => e.m.id);
    expect(ids).not.toContain(theirs[0]!.id);
    expect(ids.filter((id) => id !== theirs[0]!.id)).toEqual(
      mergedFeed(base, true)
        .map((e) => e.m.id)
        .filter((id) => id !== theirs[0]!.id),
    );
  });
});

describe('ledger rollup', () => {
  it('credits note authors and pairs, never yourself', () => {
    const map = helpedByThisWeek(base);
    expect(map.you).toBeUndefined();
    expect(map.dre).toBeGreaterThan(0);
    expect(map.maya).toBeGreaterThan(0);
  });

  /**
   * The ledger is your view of the week, so it follows the feed's rule and not
   * `circleMembers`' rule: a blocked person's contributions leave it, and they
   * leave it with their count rather than leaving a name-less number behind.
   * Both halves are asserted, because they are two functions and the one that
   * gets forgotten is whichever one a later change did not touch.
   */
  it('drops the people you have blocked, in both directions', () => {
    const blocked = { ...base, blocked: ['maya' as const] };
    expect(helpedByThisWeek(blocked).maya).toBeUndefined();
    expect(helpedByThisWeek(blocked).dre).toBeGreaterThan(0);

    const acted = {
      ...blocked,
      acted: { [`${base.moments.find((m) => m.who === 'maya')!.id}:cheer`]: true as const },
    };
    expect(helpedThisWeek(acted).maya).toBeUndefined();
  });
});

describe('pick it back up', () => {
  /** A live account whose circle has staked things, with a week of its own. */
  const withCircle = (moments: typeof base.moments, myTitles: string[] = []) => ({
    ...base,
    account: 'live' as const,
    usedSugg: {},
    myTasks: myTitles.map((title, i) => ({ ...base.myTasks[0]!, id: `mine-${i}`, title })),
    moments,
  });

  const stake = (id: string, who: PersonId, title: string, over = {}) => ({
    ...base.moments[0]!,
    id,
    who,
    kind: 'normal' as const,
    title,
    pts: 40,
    cat: 'Fitness' as const,
    ...over,
  });

  it('offers what the circle has staked', () => {
    const out = circleSuggestions(withCircle([stake('m1', 'maya', 'Swim 2k')]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: 'Swim 2k', pts: 40, cat: 'Fitness', pair: ['maya'] });
    // The card names who is already in it — that is the whole pitch.
    expect(out[0]!.sub).toContain('Maya');
  });

  it('never offers something already on your own week', () => {
    // Case and surrounding space are not a different goal.
    const out = circleSuggestions(withCircle([stake('m1', 'maya', 'Swim 2k')], ['  swim 2K ']));
    expect(out).toEqual([]);
  });

  it('draws one card for a goal several people share, naming them together', () => {
    const out = circleSuggestions(
      withCircle([
        stake('m1', 'maya', 'Run 3x this week'),
        stake('m2', 'dre', 'Run 3x this week'),
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.pair).toEqual(['maya', 'dre']);
    expect(out[0]!.sub).toContain('and');
  });

  it('drops a card once it has been staked, so it cannot be taken twice', () => {
    const state = withCircle([stake('m1', 'maya', 'Swim 2k')]);
    const [offer] = circleSuggestions(state);
    expect(circleSuggestions({ ...state, usedSugg: { [offer!.id]: true } })).toEqual([]);
  });

  it('says nothing when the circle has staked nothing', () => {
    expect(circleSuggestions(withCircle([]))).toEqual([]);
  });
});

/**
 * Who is in *which* circle, now that there can be more than one.
 *
 * `circleMembers` used to define "my circle" as the whole non-bot directory,
 * which was only ever correct because the pull unions the members of every
 * circle you are in. With two circles that union is the wrong answer to every
 * question a screen actually asks.
 */
describe('who counts as a particular circle', () => {
  const A = { id: 'c-a', name: 'The Basement', inviteCode: 'basement-aaaa' };
  const B = { id: 'c-b', name: 'Gym', inviteCode: 'gym-bbbb' };
  const ME = 'u-me' as PersonId;

  const inBoth = {
    ...base,
    account: 'live' as const,
    selfId: ME,
    circles: [A, B],
    activeCircleId: A.id,
    people: {
      [ME]: { ...personOf(ME, 'Me'), circleIds: [A.id, B.id] },
      'u-1': { ...personOf('u-1' as PersonId, 'Rae Silva'), circleIds: [A.id] },
      'u-2': { ...personOf('u-2' as PersonId, 'Sam Cole'), circleIds: [B.id] },
      'b-1': { ...personOf('b-1' as PersonId, 'Dorothy Gale'), bot: true, circleIds: [] },
    },
  };

  it('answers for one room at a time', () => {
    expect(circleMembers(inBoth, A.id).sort()).toEqual([ME, 'u-1'].sort());
    expect(circleMembers(inBoth, B.id).sort()).toEqual([ME, 'u-2'].sort());
  });

  it('still answers the union when asked for it', () => {
    // Not a leftover: "is anybody at all watching" is a different question from
    // "who is in this room", and the Week feed's empty state asks the first.
    expect(circleMembers(inBoth, null).sort()).toEqual([ME, 'u-1', 'u-2'].sort());
  });

  it('leaves the bots out of both', () => {
    expect(circleMembers(inBoth, A.id)).not.toContain('b-1');
    expect(circleMembers(inBoth, null)).not.toContain('b-1');
  });

  it('ranks one circle without the other', () => {
    // The consequence that matters: a leaderboard of people who cannot see
    // each other is a board nobody is on together.
    expect(ranking(inBoth, A.id).map((r) => r.k).sort()).toEqual([ME, 'u-1'].sort());
    expect(ranking(inBoth, B.id).map((r) => r.k).sort()).toEqual([ME, 'u-2'].sort());
  });

  it('falls back to the whole directory when nothing knows its memberships', () => {
    // The upgrade path, and it has to be a fact about the data rather than a
    // version flag: a directory written before memberships existed carries
    // none. Read as "in no circles" this would show every account "A circle of
    // one" on the first launch after an upgrade, until a pull landed.
    const older = {
      ...inBoth,
      people: {
        [ME]: personOf(ME, 'Me'),
        'u-1': personOf('u-1' as PersonId, 'Rae Silva'),
        'u-2': personOf('u-2' as PersonId, 'Sam Cole'),
      },
    };

    expect(circleMembers(older, A.id).sort()).toEqual([ME, 'u-1', 'u-2'].sort());
  });

  it('self-heals the moment one row knows', () => {
    // The other half of the fallback: it is checked per-directory, not
    // per-person, so a single row carrying the key switches the whole selector
    // over — and anyone still without one is genuinely in no circle of yours.
    const mixed = {
      ...inBoth,
      people: {
        ...inBoth.people,
        'u-2': personOf('u-2' as PersonId, 'Sam Cole'),
      },
    };

    expect(circleMembers(mixed, A.id).sort()).toEqual([ME, 'u-1'].sort());
  });

  it('never drops you from a circle you are in', () => {
    // The window where the directory knows about others and not yet about you.
    // Without the self-guard you vanish from your own leaderboard.
    const meUnknown = {
      ...inBoth,
      people: { ...inBoth.people, [ME]: personOf(ME, 'Me') },
    };

    expect(circleMembers(meUnknown, A.id)).toContain(ME);
    // …and not from a circle you are *not* in, which is the same guard read
    // the other way: `circleId` is checked against `state.circles`.
    expect(circleMembers(meUnknown, 'c-never')).not.toContain(ME);
  });
});

/**
 * `activeCircleId` is a preference and `circles` is server-derived, and the two
 * are allowed to disagree — which is exactly why resolution lives here rather
 * than in the reducer. A reducer that corrected the id would erase the user's
 * choice on every cold start, because `circles` is empty for one pull.
 */
describe('which circle the app is about', () => {
  const A = { id: 'c-a', name: 'The Basement', inviteCode: 'basement-aaaa' };
  const B = { id: 'c-b', name: 'Gym', inviteCode: 'gym-bbbb' };
  const withCircles = (circles: typeof A[], activeCircleId: string | null) => ({
    ...base,
    circles,
    activeCircleId,
  });

  it('resolves the one that was chosen', () => {
    expect(activeCircle(withCircles([A, B], B.id))?.name).toBe('Gym');
  });

  it('falls back to the first when nothing has been chosen', () => {
    // Oldest membership, which is the order the pull hands them over in.
    expect(activeCircle(withCircles([A, B], null))?.name).toBe('The Basement');
  });

  it('falls back when the choice names a circle the pull has not delivered', () => {
    // The cold-start window: `activeCircleId` is on disk, `circles` is not, so
    // for one pull the preference names something the list does not hold. The
    // screen shows a circle rather than nothing, and repairs itself.
    expect(activeCircle(withCircles([A], B.id))?.name).toBe('The Basement');
  });

  it('answers null when there are none, without inventing one', () => {
    expect(activeCircle(withCircles([], B.id))).toBeNull();
  });

  it('keeps the preference even while it resolves to something else', () => {
    // The half that would be lost to a normalising reducer: the id survives, so
    // when the circle comes back — a partial pull, a slow launch — the user is
    // where they left off rather than wherever the fallback put them.
    const s = reducer(withCircles([A], null), { type: 'SET_ACTIVE_CIRCLE', id: B.id });

    expect(s.activeCircleId).toBe(B.id);
    expect(activeCircle(s)?.name).toBe('The Basement');
    expect(activeCircle({ ...s, circles: [A, B] })?.name).toBe('Gym');
  });
});
