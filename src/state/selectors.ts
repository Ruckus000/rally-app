/**
 * Everything the screens read that isn't stored directly.
 *
 * Note on ranking: the circle is ranked by follow-through, and the row metric
 * must be the metric the ranking uses — showing points there would imply a
 * different sort.
 */
import { FIRST, INITIALS, MemberStats, NAME, STATS, Task } from '../data/fixtures';
import { getWorld } from '../data/seed';
import type { PersonKey } from '../theme/tokens';
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
  k: PersonKey;
  ini: string;
  name: string;
  first: string;
  /** "71% · 5 of 7 · 🔥 2w" — the follow-through metric the sort uses. */
  sub: string;
  pct: number;
  given: number;
};

/**
 * Follow-through score: closed tasks weighted by completion rate, so closing
 * 5 of 7 beats closing 2 of 2 but closing 7 of 7 beats both.
 */
const score = (s: MemberStats) => (s.total ? s.done * (s.done / s.total) : 0);

export function ranking(state: State): RankedMember[] {
  const mine = myStats(state);
  return getWorld(state.account).members.map((k) => {
    const s = k === 'you' ? mine : STATS[k as Exclude<PersonKey, 'you'>];
    return { k, s, score: score(s) };
  })
    .sort((a, b) => b.score - a.score)
    .map(({ k, s }, i) => ({
      rank: i + 1,
      k,
      ini: INITIALS[k],
      name: NAME[k],
      first: FIRST[k],
      sub:
        `${s.total ? Math.round((100 * s.done) / s.total) : 0}% · ${s.done} of ${s.total}` +
        (s.streak ? ` · 🔥 ${s.streak}w` : ''),
      pct: s.total ? s.done / s.total : 0,
      given: s.given,
    }));
}

export const myRank = (state: State) => ranking(state).find((r) => r.k === 'you')?.rank ?? 0;

export const totalCheersExchanged = (state: State) =>
  ranking(state).reduce((a, r) => a + r.given, 0);

/** Unread drives the bell badge, and only the "needs you" tier counts. */
export const unreadNeedsCount = (state: State) =>
  getWorld(state.account).notifications.filter(
    (n) => n.tier === 'needs' && !state.notifRead[n.id],
  ).length;

/** Personal feed order: closed tasks first (latest day first), then STILL OPEN. */
export function personalFeed(state: State) {
  const done = state.myTasks.filter((t) => t.done).sort((a, b) => b.day - a.day);
  const open = state.myTasks.filter((t) => !t.done).sort((a, b) => a.day - b.day);
  return { done, open };
}

/** Who helped you this week: note authors and anyone paired on a stake. */
export function helpedByThisWeek(tasks: Task[]) {
  const map: Partial<Record<PersonKey, number>> = {};
  tasks.forEach((t) =>
    (t.cmts ?? []).forEach((c) => {
      if (c.k && c.k !== 'you') map[c.k] = (map[c.k] ?? 0) + 1;
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
  const map: Partial<Record<PersonKey, number>> = {};
  Object.keys(state.acted).forEach((key) => {
    const id = key.split(':')[0];
    const m = state.moments.find((x) => x.id === id);
    if (m) map[m.who] = (map[m.who] ?? 0) + 1;
  });
  (Object.keys(state.replied) as PersonKey[]).forEach((k) => {
    map[k] = (map[k] ?? 0) + 1;
  });
  return map;
}

export const pluralTimes = (n: number) => `${n} time${n > 1 ? 's' : ''}`;
