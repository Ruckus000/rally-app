/**
 * Everything the screens read that isn't stored directly.
 *
 * Note on ranking: the circle is ranked by follow-through, and the row metric
 * must be the metric the ranking uses — showing points there would imply a
 * different sort.
 */
import { Moment, Task, parseHours } from '../data/fixtures';
import { MemberStats, PersonId, makePeople } from '../data/people';
import { seedCircle } from '../data/seed';
import type { State } from './store';

/** The ids you've cheered. Cheers only ever land on a moment or a global post. */
const cheeredIds = (state: State) =>
  Object.keys(state.acted)
    .filter((k) => k.endsWith(':cheer'))
    .map((k) => k.slice(0, -':cheer'.length));

/**
 * Every cheer you gave, wherever it landed. Feeds YOU GAVE on Me.
 *
 * Its counterpart on that card, YOU GOT, is circle-sourced, so the two halves
 * of the exchange bar are scoped differently. Both are fixtures — there's no
 * way to receive a cheer in this build — so leave it be rather than narrowing
 * a number that is honestly reporting what you did.
 */
export const cheersGiven = (state: State) =>
  state.profile.baseCheersGiven + cheeredIds(state).length;

/**
 * Only cheers that landed on someone in your circle. The Circle bar says
 * "in the circle", so a cheer given to a stranger on the global feed must not
 * inflate it.
 */
export const circleCheersGiven = (state: State) =>
  state.profile.baseCheersGiven +
  cheeredIds(state).filter((id) => state.moments.some((m) => m.id === id)).length;

export const myStats = (state: State): MemberStats => ({
  done: state.myTasks.filter((t) => t.done).length,
  total: state.myTasks.length,
  streak: state.profile.currentStreak,
  // Circle-scoped: this feeds ranking(), the row chips and the circle total.
  given: circleCheersGiven(state),
});

export const weekPoints = (state: State) =>
  state.myTasks.filter((t) => t.done).reduce((a, t) => a + t.pts, 0);

export const stakedPoints = (state: State) => state.myTasks.reduce((a, t) => a + t.pts, 0);

export const allTasksDone = (state: State) =>
  state.myTasks.length > 0 && state.myTasks.every((t) => t.done);

export type RankedMember = {
  rank: number;
  k: PersonId;
  ini: string;
  name: string;
  first: string;
  /** "71% · 5 of 7 · 🔥 2w", or why there is no number to show. */
  sub: string;
  /** Null when this member's week is unknown — not the same as a week of zeroes. */
  pct: number | null;
  given: number | null;
};

/**
 * Follow-through score: closed tasks weighted by completion rate, so closing
 * 5 of 7 beats closing 2 of 2 but closing 7 of 7 beats both.
 */
const score = (s: MemberStats) => (s.total ? s.done * (s.done / s.total) : 0);

/** Below every real score, including a real zero, which is a week someone had. */
const UNKNOWN = -1;

/** What a member with no week to report shows instead of a fabricated 0%. */
const NO_WEEK = 'No week synced yet';

export function ranking(state: State): RankedMember[] {
  const mine = myStats(state);
  const p = makePeople(state.people, state.selfId);
  return circleMembers(state)
    .map((k) => {
      // `p.get(k).stats`, not `p.stats(k)`: the resolver's EMPTY_STATS is a
      // convenience for rendering, and here it would be a claim. A live circle
      // member's week lives in `week_rollups`, which nothing pulls yet, so the
      // truthful answer for them is "unknown" rather than a 0 of 0 that reads
      // as somebody who staked nothing and closed nothing.
      const s = p.isSelf(k) ? mine : p.get(k).stats;
      return { k, s, score: s ? score(s) : UNKNOWN, name: p.name(k) };
    })
    // Name breaks the tie so a list of members we know nothing about has a
    // stable order rather than one that implies a ranking it does not have.
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map(({ k, s, name }, i) => ({
      rank: i + 1,
      k,
      ini: p.initials(k),
      name,
      first: p.first(k),
      sub: s
        ? `${s.total ? Math.round((100 * s.done) / s.total) : 0}% · ${s.done} of ${s.total}` +
          (s.streak ? ` · 🔥 ${s.streak}w` : '')
        : NO_WEEK,
      pct: s ? (s.total ? s.done / s.total : 0) : null,
      given: s ? s.given : null,
    }));
}

export const myRank = (state: State) =>
  ranking(state).find((r) => r.k === state.selfId)?.rank ?? 0;

/** Counts the members whose week we actually have. An unknown adds nothing. */
export const totalCheersExchanged = (state: State) =>
  ranking(state).reduce((a, r) => a + (r.given ?? 0), 0);

/**
 * Who's on the leaderboard, and the only correct answer to "who is in this
 * circle". A live account's is whoever is in the directory; a demo account's is
 * the fixture it was seeded with. The header used to count the world's list
 * instead, which on a live account is one element long — so a circle of two
 * read "1 people" and a circle of eight would have too.
 *
 * Bots are excluded. They share the directory because every name and avatar on
 * the public feed resolves through it, but they are in nobody's circle. Seen on
 * device: an account that knew nobody read "5 people, ranked by follow-through"
 * over a leaderboard of four Wizard of Oz characters — and, because it was
 * never "alone", never saw the invite that would have given it a real one.
 */
export const circleMembers = (state: State): PersonId[] =>
  state.account === 'live'
    ? Object.keys(state.people).filter((id) => !state.people[id]?.bot)
    : seedCircle(state.account);

/**
 * Unread drives the bell badge, and only the "needs you" tier counts.
 *
 * Reads `state.notifications` for every account. There used to be a selector
 * here choosing between state and the world, because the world held a feed too
 * — and the one it handed a live account was empty, so the badge could never
 * light however many people cheered you. The demo's feed is seeded into the
 * same slice now, so there is nothing left to choose between.
 */
export const unreadNeedsCount = (state: State) =>
  state.notifications.filter((n) => n.tier === 'needs' && !state.notifRead[n.id]).length;

/**
 * Where a card in the merged feed came from. `circle` is someone in your
 * circle; `follow` is the public feed — the Oz bots, who nobody is in a circle
 * with. It is what the FRIENDS / FOLLOW label on the card reads.
 */
export type FeedSource = 'circle' | 'follow';

export type FeedEntry = { m: Moment; from: FeedSource };

/**
 * The Week tab's one social feed: your circle's moments and the public feed,
 * interleaved by time.
 *
 * These were two tabs over two slices, and everything but the slice was already
 * shared — same `Moment` shape, same `MomentItem` renderer, same sort. Merging
 * them is why the cards carry a label: with both halves in one list, "whose
 * feed is this" stops being answered by which tab you are standing on.
 *
 * Strictly chronological, not friends-first. A block of your people above a
 * block of strangers is the two feeds stacked, which is the thing this replaces.
 *
 * The origin is attached here rather than stored on the `Moment`, because
 * `Moment` is the persisted and synced shape and this is a rendering question —
 * one the caller already knows the answer to at the moment it merges.
 */
export function mergedFeed(state: State, quietComebacks: boolean): FeedEntry[] {
  const entries: FeedEntry[] = state.moments
    .filter((m) => quietComebacks || m.kind !== 'quiet')
    .map((m) => ({ m, from: 'circle' as const }));

  // Circle wins. Nothing can be in both slices today — `pullBots` only returns
  // bot owners, and a bot is in nobody's circle — but a card drawn twice under
  // one React key is a bad way to find that out if it ever changes.
  const seen = new Set(entries.map((e) => e.m.id));
  for (const m of state.globalPosts) {
    if (!seen.has(m.id)) entries.push({ m, from: 'follow' });
  }

  return entries.sort((a, b) => parseHours(a.m.time) - parseHours(b.m.time));
}

/** Personal feed order: closed tasks first (latest day first), then STILL OPEN. */
export function personalFeed(state: State) {
  const done = state.myTasks.filter((t) => t.done).sort((a, b) => b.day - a.day);
  const open = state.myTasks.filter((t) => !t.done).sort((a, b) => a.day - b.day);
  return { done, open };
}

/** Who helped you this week: note authors and anyone paired on a stake. */
export function helpedByThisWeek(tasks: Task[], self: PersonId) {
  const map: Partial<Record<PersonId, number>> = {};
  tasks.forEach((t) =>
    (t.cmts ?? []).forEach((c) => {
      if (c.k && c.k !== self) map[c.k] = (map[c.k] ?? 0) + 1;
    }),
  );
  tasks
    .filter((t) => t.pairKind)
    .flatMap((t) => t.pair)
    .forEach((k) => {
      map[k] = (map[k] ?? 0) + 1;
    });
  return map;
}

/** Who you helped: anyone whose moment you acted on, plus anyone you replied to. */
export function helpedThisWeek(state: State) {
  const map: Partial<Record<PersonId, number>> = {};
  Object.keys(state.acted).forEach((key) => {
    const id = key.split(':')[0];
    const m = state.moments.find((x) => x.id === id);
    if (m) map[m.who] = (map[m.who] ?? 0) + 1;
  });
  (Object.keys(state.replied) as PersonId[]).forEach((k) => {
    map[k] = (map[k] ?? 0) + 1;
  });
  return map;
}

export const pluralTimes = (n: number) => `${n} time${n > 1 ? 's' : ''}`;
