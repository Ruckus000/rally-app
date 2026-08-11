/**
 * Who anyone is, resolved through one place.
 *
 * A person used to be a closed union of seven demo keys, and every screen read
 * them out of total `Record`s. Once an id is a uuid from the server that stops
 * being true: any lookup can miss. So identity now goes through `People`, which
 * is total by construction — it answers for ids it has never seen rather than
 * handing back an undefined the compiler swore was a string.
 */
import { hashTint } from '../theme/tokens';

export type PersonId = string;
export type Trend = 'up' | 'down' | 'same';
export type MemberStats = { done: number; total: number; streak: number; given: number };

export type Person = {
  id: PersonId;
  name: string;
  first: string;
  initials: string;
  tint?: string;
  trend?: Trend;
  stats?: MemberStats;
};

/** Deliberately `| undefined`: without noUncheckedIndexedAccess a plain Record would hand back a
 *  confidently-typed undefined. This signature forces the check the config skips. */
export type PeopleIndex = { readonly [id: string]: Person | undefined };

export const SELF_DEMO_ID: PersonId = 'you';

export const EMPTY_STATS: MemberStats = { done: 0, total: 0, streak: 0, given: 0 };

/** 'Maya Chen' -> 'MC'. `profiles` has no initials column, so live mode derives them. */
export const initialsFromName = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.slice(0, 2).map((p) => p[0]);
  return letters.join('').toUpperCase();
};

/** Everything but the name is optional, because a live row is only ever an id and a name. */
export const personOf = (
  id: PersonId,
  name: string,
  extra: Partial<Omit<Person, 'id'>> = {},
): Person => ({
  id,
  name,
  first: name.trim().split(/\s+/)[0] || name,
  initials: initialsFromName(name),
  ...extra,
});

/**
 * The demo circle, transcribed from the fixtures it replaces. Each one keeps
 * its explicit tint — these were picked against the design reference, and a
 * pure hash would restyle the whole app.
 */
export const DEMO_PEOPLE: Person[] = [
  // No stats: yours are live, off your own week.
  { id: 'you', name: 'You', first: 'You', initials: 'AR', tint: '#E0E6D3', trend: 'up' },
  {
    id: 'maya',
    name: 'Maya Chen',
    first: 'Maya',
    initials: 'MC',
    tint: '#D5E2BD',
    trend: 'up',
    stats: { done: 7, total: 7, streak: 5, given: 9 },
  },
  {
    id: 'dre',
    name: 'Dre Okafor',
    first: 'Dre',
    initials: 'DO',
    tint: '#E9E0C2',
    trend: 'down',
    stats: { done: 5, total: 7, streak: 2, given: 6 },
  },
  {
    id: 'jordan',
    name: 'Jordan Lee',
    first: 'Jordan',
    initials: 'JL',
    tint: '#E8CFBE',
    trend: 'down',
    stats: { done: 1, total: 5, streak: 0, given: 1 },
  },
  {
    id: 'sofia',
    name: 'Sofia Park',
    first: 'Sofia',
    initials: 'SP',
    tint: '#C9D9CE',
    trend: 'up',
    stats: { done: 4, total: 6, streak: 4, given: 3 },
  },
  {
    id: 'nana',
    name: 'Nana Rosa',
    first: 'Nana',
    initials: 'NR',
    tint: '#EFE3AE',
    trend: 'same',
    stats: { done: 6, total: 6, streak: 1, given: 5 },
  },
  {
    id: 'tomas',
    name: 'Tomás Vega',
    first: 'Tomás',
    initials: 'TV',
    tint: '#CBD6C4',
    trend: 'up',
    stats: { done: 2, total: 2, streak: 1, given: 0 },
  },
];

/**
 * Null-prototype on purpose. Ids are arbitrary strings and will soon come from
 * a server, and on a normal object literal `index['toString']` returns the
 * inherited function rather than undefined — so the `?? stranger(id)` fallback
 * never fires and the resolver hands back a Function with no initials. The
 * same object also refuses to store `__proto__` as an ordinary key, which
 * would silently drop that person. Both disappear with a null prototype.
 */
export const indexPeople = (list: Person[]): PeopleIndex =>
  list.reduce<Record<PersonId, Person>>((acc, p) => {
    acc[p.id] = p;
    return acc;
  }, Object.create(null) as Record<PersonId, Person>);

export const DEMO_INDEX: PeopleIndex = indexPeople(DEMO_PEOPLE);

/** A fresh account knows exactly one person. */
export const SELF_ONLY_INDEX: PeopleIndex = indexPeople(
  DEMO_PEOPLE.filter((p) => p.id === SELF_DEMO_ID),
);

export type People = {
  get(id: PersonId): Person;
  name(id: PersonId): string;
  first(id: PersonId): string;
  initials(id: PersonId): string;
  tint(id: PersonId): string;
  trend(id: PersonId): Trend;
  stats(id: PersonId): MemberStats;
  isSelf(id: PersonId): boolean;
  selfId: PersonId;
};

/**
 * A stranger renders as "Someone" rather than as a blank or a crash. Visible on
 * purpose: a name that never resolves is a data bug worth seeing, not hiding.
 */
const stranger = (id: PersonId): Person => ({
  id,
  name: 'Someone',
  first: 'Someone',
  initials: '?',
  tint: hashTint(id),
});

export function makePeople(index: PeopleIndex, selfId: PersonId): People {
  const get = (id: PersonId): Person => index[id] ?? stranger(id);
  return {
    get,
    name: (id) => get(id).name,
    first: (id) => get(id).first,
    initials: (id) => get(id).initials,
    tint: (id) => get(id).tint ?? hashTint(id),
    trend: (id) => get(id).trend ?? 'same',
    stats: (id) => get(id).stats ?? EMPTY_STATS,
    isSelf: (id) => id === selfId,
    selfId,
  };
}
