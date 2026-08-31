/**
 * Everything the screens read that isn't stored directly.
 *
 * Note on ranking: the circle is ranked by follow-through, and the row metric
 * must be the metric the ranking uses — showing points there would imply a
 * different sort.
 */
import {
  CATEGORY_POINTS,
  HistoryWeek,
  Moment,
  Note,
  Suggestion,
  Task,
  parseHours,
  weekHeldStreak,
} from '../data/fixtures';
import type { Profile } from '../data/seed';
import { MemberStats, PersonId, makePeople } from '../data/people';
import { seedCircle } from '../data/seed';
import type { CircleRef, State } from './store';

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

/**
 * Your running totals, rebuilt from the weeks themselves.
 *
 * Used on exactly one path — a reinstall, where `history` arrived from the server
 * and the totals did not. Everywhere else `COMMIT_ROLLOVER` keeps them, and it
 * stays the only writer: two writers for one number is how a total quietly ends
 * up counting a week twice, and the second writer would only run on a path
 * nobody exercises often enough to notice.
 *
 * Every field is derived from `points`, `done` and `total`, which is why
 * `week_rollups`' `perfect` and `streak_held` columns are never read back. They
 * are restatements of `done` and `total`, and a restatement that can disagree is
 * worse than one that cannot exist.
 *
 * `history` is newest-first, as the reducer keeps it.
 */
export const aggregatesFrom = (
  history: HistoryWeek[],
): Pick<
  Profile,
  | 'allTimePoints'
  | 'weeksIn'
  | 'bestWeekPoints'
  | 'bestWeekLabel'
  | 'longestStreak'
  | 'currentStreak'
  | 'mostTasksClosed'
  | 'perfectWeeks'
> => {
  let best = history[0];
  let longest = 0;
  let run = 0;

  for (const w of history) {
    if (w.points > (best?.points ?? -1)) best = w;
    // Walking newest-first, so the run that is still going when the loop starts
    // is the current one — captured below before it can be reset by an older
    // quiet week.
    if (weekHeldStreak(w.done)) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }

  // The current streak is the unbroken run at the *newest* end, which is however
  // many weeks pass before the first quiet one.
  let current = 0;
  for (const w of history) {
    if (!weekHeldStreak(w.done)) break;
    current += 1;
  }

  return {
    allTimePoints: history.reduce((a, w) => a + w.points, 0),
    weeksIn: history.length,
    bestWeekPoints: best?.points ?? 0,
    bestWeekLabel: best?.label ?? '',
    longestStreak: longest,
    currentStreak: current,
    mostTasksClosed: history.reduce((a, w) => Math.max(a, w.done), 0),
    perfectWeeks: history.filter((w) => w.total > 0 && w.done === w.total).length,
  };
};

/**
 * What a week scored, as the closing of it records the score.
 *
 * Extracted for two callers who must agree exactly. `COMMIT_ROLLOVER` writes
 * these numbers into `history` and into your running totals; `RolloverOverlay`
 * reads the same numbers to queue the rollup for the server, in the tick it
 * dispatches. If those two ever disagreed, the week on your phone and the week
 * on the server would be different weeks — and the disagreement would only
 * surface on a reinstall, months later, as history that does not match what you
 * remember.
 *
 * Takes the tasks rather than the state so the caller can pass the week it is
 * closing, which is not always the week the state is on by the time this runs.
 */
export const closingWeek = (
  tasks: Task[],
): { points: number; done: number; total: number; perfect: boolean; streakHeld: boolean } => {
  const done = tasks.filter((t) => t.done);
  return {
    points: done.reduce((a, t) => a + t.pts, 0),
    done: done.length,
    total: tasks.length,
    perfect: tasks.length > 0 && done.length === tasks.length,
    streakHeld: weekHeldStreak(done.length),
  };
};

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
 *
 * A blocked member is **not** excluded, and that is a decision rather than an
 * oversight: this feeds `ranking()` and the circle total, which are rollups
 * over the whole circle, not over what one viewer wants to see. Filtering them
 * per-viewer would make "how many did the circle close this week" a different
 * number depending on who was asking — the leaderboard would disagree with
 * itself the moment two members had blocked different people. Blocking hides a
 * person's *feed presence* from you (`mergedFeed`, above); it does not remove
 * them from a circle-wide count. If a later reader "fixes" this to filter
 * blocked members out here, they will have reintroduced a per-viewer rollup —
 * read this note first.
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
 * Strip a blocked person's fingerprints off a moment that survives the block
 * itself — the note thread and the cheer roster, the two places someone can
 * still show up on a card that is not theirs.
 *
 * Never touches `who`: whether the *card itself* belongs to a blocked person is
 * `mergedFeed`'s question, not this one, and answering it here would filter it
 * twice for no gain.
 *
 * The self-guard is the reason this exists at all rather than a plain
 * `.filter(id => !blocked.has(id))`: `blocked` is reducer state, not a promise
 * the server enforces locally, and nothing stops it from naming `state.selfId`
 * — `BLOCK` performs no self-check, because the constraint that actually
 * matters (`blocks_not_self`) lives in the migration and is proven there. A
 * feed that could make your own note vanish because of a bad local write would
 * be a worse bug than the one this task exists to close.
 */
const stripBlocked = (
  m: Moment,
  blocked: ReadonlySet<PersonId>,
  reported: ReadonlySet<string>,
  self: PersonId,
): Moment => {
  const hides = (id: PersonId) => id !== self && blocked.has(id);
  // A note is hidden by its own id as well as by its author: reporting one note
  // is not reporting the person, and must not take the rest of their thread
  // with it. `id` is optional on `Note` — a fixture note has none, and one
  // without an id is one nothing could have reported.
  const gone = (c: Note) => hides(c.k) || (!!c.id && reported.has(c.id));
  if (!m.cmts?.some(gone) && !m.backers?.some(hides)) return m;
  return {
    ...m,
    cmts: m.cmts?.filter((c) => !gone(c)),
    backers: m.backers?.filter((id) => !hides(id)),
  };
};

/**
 * Notes with the ones you have blocked or reported taken out.
 *
 * Exported because two note threads never pass through `mergedFeed` — the ones
 * the detail sheet reads straight off `state.moments` and `state.personNotes` —
 * and "it's hidden from you now" has to be true on the screen you were standing
 * on when you filed it, not only in the feed.
 */
export function visibleNotes(notes: Note[], state: State): Note[] {
  const blocked = new Set(state.blocked);
  const reported = new Set(state.reported);
  return notes.filter(
    (c) => !((c.k !== state.selfId && blocked.has(c.k)) || (!!c.id && reported.has(c.id))),
  );
}

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
 *
 * Blocking is filtered here, and only here — see `state.blocked`'s comment in
 * `store.tsx`. The server already hides a blocked person's rows via RLS, which
 * is the *real* enforcement; this is the offline half, the second or two (or
 * the whole flight) before the next pull can answer. One place because
 * `mergedFeed` is the one path every card on the Week tab comes through —
 * `WeekScreen` has no second feed assembler to forget the check in.
 *
 * A blocked person never loses their seat in `circleMembers` or the totals it
 * feeds — see that function's own note. Only the feed, not the roster.
 */
export function mergedFeed(state: State, quietComebacks: boolean): FeedEntry[] {
  const blocked = new Set(state.blocked);
  const reported = new Set(state.reported);
  // Never hides your own card, whatever `blocked` says — see `stripBlocked`.
  // A card you reported *is* hidden whoever wrote it, because you asked for
  // that one specifically rather than for a person.
  const hidden = (m: Moment) =>
    (m.who !== state.selfId && blocked.has(m.who)) || reported.has(m.id);

  const entries: FeedEntry[] = state.moments
    .filter((m) => quietComebacks || m.kind !== 'quiet')
    .filter((m) => !hidden(m))
    .map((m) => ({
      m: stripBlocked(m, blocked, reported, state.selfId),
      from: 'circle' as const,
    }));

  // Circle wins. Nothing can be in both slices today — `pullBots` only returns
  // bot owners, and a bot is in nobody's circle — but a card drawn twice under
  // one React key is a bad way to find that out if it ever changes.
  const seen = new Set(entries.map((e) => e.m.id));
  for (const m of state.globalPosts) {
    if (hidden(m) || seen.has(m.id)) continue;
    entries.push({ m: stripBlocked(m, blocked, reported, state.selfId), from: 'follow' });
  }

  return entries.sort((a, b) => parseHours(a.m.time) - parseHours(b.m.time));
}

/** Personal feed order: closed tasks first (latest day first), then STILL OPEN. */
export function personalFeed(state: State) {
  const done = state.myTasks.filter((t) => t.done).sort((a, b) => b.day - a.day);
  const open = state.myTasks.filter((t) => !t.done).sort((a, b) => a.day - b.day);
  return { done, open };
}

/**
 * Anyone you have blocked, gone from a list of people.
 *
 * The ledger is *your* view of the week, so the rule for it is the same rule
 * the feed follows and the opposite of the one `circleMembers` follows: a
 * blocked person's contributions disappear from what you are shown, past weeks
 * included. Retroactive on purpose — a ledger that still reads "Sam, 4 times
 * this week" is the block visibly not working on the one screen that names
 * people one by one.
 *
 * Never drops you. Same guard, same reason as `stripBlocked`: `blocked` is
 * local state and nothing but a database constraint stops it naming yourself.
 */
export const withoutBlocked = <T extends { k: PersonId }>(rows: T[], state: State): T[] => {
  const blocked = new Set(state.blocked);
  return rows.filter((r) => r.k === state.selfId || !blocked.has(r.k));
};

/**
 * Who helped you this week: note authors and anyone paired on a stake.
 *
 * Takes the whole state rather than the two fields it reads, so that the
 * blocked filter is not something a caller can forget to pass — the same shape
 * `helpedThisWeek` below already had.
 */
export function helpedByThisWeek(state: State) {
  const tasks = state.myTasks;
  const self = state.selfId;
  const blocked = new Set(state.blocked);
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
  // Dropped whole, rather than counted and then hidden. There is no "3 people
  // helped you" headline above this list — the only number rendered is the
  // per-person one, which leaves with its person — so removing the key removes
  // the name and the count together and nothing is left saying otherwise.
  blocked.forEach((k) => {
    if (k !== self) delete map[k];
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
  // See `helpedByThisWeek`. Filtered here rather than in `LedgerOverlay` so
  // there is one place the rule lives, the way `mergedFeed` is the one place
  // the feed's copy of it lives.
  new Set(state.blocked).forEach((k) => {
    if (k !== state.selfId) delete map[k];
  });
  return map;
}

export const pluralTimes = (n: number) => `${n} time${n > 1 ? 's' : ''}`;

/**
 * "Pick it back up", for an account with a real circle.
 *
 * The rail was demo furniture: `DEMO_CONTENT.live` is deliberately empty, so
 * a live account never saw the section at all — a named part of the Plan
 * screen that only existed for the fixtures. Of the three sources the handoff
 * names, exactly one can be answered from what the device actually holds:
 * **what your circle has staked that you have not**. The other two cannot be,
 * honestly — `history` keeps only what was *closed*, so last week's unfinished
 * titles are already gone by the time this could ask for them, and a
 * streak-at-risk card has no goal to name.
 *
 * Titles are matched case-insensitively against your own week so the rail
 * never offers you something you are already doing, and one card per title so
 * three friends running the same 5k is one offer, not three.
 */
export function circleSuggestions(state: State, limit = 6): Suggestion[] {
  const mine = new Set(state.myTasks.map((t) => t.title.trim().toLowerCase()));
  const used = state.usedSugg;
  const byTitle = new Map<string, { m: Moment; who: PersonId[] }>();

  for (const m of state.moments) {
    const title = (m.title ?? '').trim();
    if (!title || mine.has(title.toLowerCase())) continue;
    const key = title.toLowerCase();
    const hit = byTitle.get(key);
    if (hit) {
      if (!hit.who.includes(m.who)) hit.who.push(m.who);
    } else {
      byTitle.set(key, { m, who: [m.who] });
    }
  }

  const p = makePeople(state.people, state.selfId);
  const out: Suggestion[] = [];
  for (const { m, who } of byTitle.values()) {
    const id = `circle:${m.id}`;
    if (used[id]) continue;
    const names = who.map((k) => p.first(k));
    const cat = m.cat ?? 'Fitness';
    out.push({
      id,
      tag: 'Already in',
      title: m.title ?? '',
      sub: `${joinFirstNames(names)} staked this one.`,
      pts: m.pts ?? CATEGORY_POINTS[cat] ?? 30,
      cat,
      pair: who,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Which circle the app is currently about.
 *
 * Resolution lives here rather than in the reducer, and that is the whole
 * design. `activeCircleId` is a *preference* — persisted, chosen by the user —
 * while `circles` is server-derived and not persisted, so on every cold start
 * there is a window where the preference names a circle the list does not yet
 * contain. A reducer that corrected the id would erase the choice on that
 * window, every launch. Here the same disagreement costs one pull's worth of
 * falling back, and is repaired the moment the answer arrives.
 *
 * `circles[0]` rather than nothing, because the list is ordered oldest-first
 * and a screen that has to name a circle would otherwise have to invent the
 * same fallback itself.
 */
export const activeCircle = (state: State): CircleRef | null =>
  state.circles.find((c) => c.id === state.activeCircleId) ?? state.circles[0] ?? null;

/** "Maya", "Maya and Dre", "Maya, Dre and 2 others" — the card has one line. */
const joinFirstNames = (names: string[]): string => {
  if (names.length <= 1) return names[0] ?? 'Someone';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
};
