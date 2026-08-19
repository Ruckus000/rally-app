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

/**
 * `profiles.avatar_state`, mirrored by hand from the migration's check
 * constraint. Only `ready` may ever render bytes — see `Avatar`.
 */
export type AvatarState = 'none' | 'pending' | 'ready' | 'refused';

/** The four the server will answer with, as a set, for narrowing a wire value. */
const AVATAR_STATES: readonly string[] = ['none', 'pending', 'ready', 'refused'];

/**
 * The longest `avatar_path` this app will hold, and the same argument as
 * `NAME_MAX` one column over: the path is written by another person's client
 * (`set_avatar` checks only that the first segment is their own uuid, not that
 * the rest is short), it arrives in a payload this device persists, and a
 * payload that fails validation on restore is discarded whole. A real path is
 * `<uuid>/<uuid>.jpg` — 78 characters — so this is generous by a factor of two.
 */
export const AVATAR_PATH_MAX = 160;

/** Anything the server did not say, or said in a shape from a later build, is "no photo". */
export const avatarStateOf = (value: unknown): AvatarState =>
  typeof value === 'string' && AVATAR_STATES.includes(value) ? (value as AvatarState) : 'none';

/** Dropped rather than truncated: half a path names no object, and the honest answer is initials. */
export const avatarPathOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= AVATAR_PATH_MAX
    ? value
    : undefined;

export type MemberStats = { done: number; total: number; streak: number; given: number };

export type Person = {
  id: PersonId;
  name: string;
  first: string;
  initials: string;
  tint?: string;
  trend?: Trend;
  stats?: MemberStats;
  /**
   * An Oz bot. They share the directory with real people — every avatar and
   * name on the public feed resolves through it, and an author missing from it
   * renders as "Someone" — but they are in nobody's circle, and `circleMembers`
   * is the directory on a live account. Without this they were counted as your
   * circle: five people and a leaderboard of fictional characters, for an
   * account that knew nobody.
   */
  bot?: boolean;
  /**
   * The object name in the private `avatars` bucket — never a URL. Signing it
   * happens in `lib/avatarUrl.ts`, whose answers expire; this is the durable
   * half and the only one that is persisted.
   */
  avatarPath?: string;
  /**
   * Whether those bytes have been screened. Absent means `none`, which is what
   * every demo person and every row from a build before this feature is.
   */
  avatarState?: AvatarState;
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

/**
 * The longest display name this app will hold, and the one place it is spelled.
 *
 * A display name is the only string another person controls that reaches your
 * screen, and — because `people` is persisted — your disk. `peopleAreSound`
 * rejects a payload containing a longer one, and rejection there discards the
 * *whole* payload: your staked week, your history, your streak. So an unbounded
 * name is not a layout bug, it is one circle member able to wipe your device.
 * Bounded on write (`profiles_name_length`), on read (here), and on restore.
 */
export const NAME_MAX = 80;

/** Everything but the name is optional, because a live row is only ever an id and a name. */
export const personOf = (
  id: PersonId,
  name: string,
  extra: Partial<Omit<Person, 'id'>> = {},
): Person => {
  // Truncated rather than refused: a name this long is someone else's row, and
  // dropping the person entirely would leave their tasks attributed to nobody.
  const bounded = name.length > NAME_MAX ? name.slice(0, NAME_MAX) : name;
  return {
    id,
    name: bounded,
    first: bounded.trim().split(/\s+/)[0] || bounded,
    initials: initialsFromName(bounded),
    ...extra,
  };
};

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

/**
 * The Global feed's cast, and openly not people.
 *
 * The feed used to be four invented accounts with handles like `@kwon.builds`
 * — names chosen to pass for real, attached to cheer counts no ledger backs.
 * These are chosen to fail: nobody mistakes the Tin Man for a person they
 * might know, and that is the point of the choice rather than a joke about it.
 *
 * On a live account the same characters arrive from the server as ordinary
 * profile rows, so this list is what the two demo modes read instead. Their
 * ids are not uuids, which is what keeps a demo cheer out of the outbox.
 */
export const OZ_PEOPLE: Person[] = [
  {
    id: 'dorothy',
    name: 'Dorothy Gale',
    first: 'Dorothy',
    initials: 'DG',
    tint: '#D8C9E0',
    trend: 'up',
    stats: { done: 5, total: 6, streak: 4, given: 11 },
  },
  {
    id: 'scarecrow',
    name: 'The Scarecrow',
    first: 'Scarecrow',
    initials: 'SC',
    tint: '#E9E0C2',
    trend: 'up',
    stats: { done: 4, total: 4, streak: 2, given: 7 },
  },
  {
    id: 'tinman',
    name: 'Tin Man',
    first: 'Tin',
    initials: 'TM',
    tint: '#C9DCE0',
    trend: 'same',
    stats: { done: 3, total: 6, streak: 1, given: 5 },
  },
  {
    id: 'lion',
    name: 'Cowardly Lion',
    first: 'Lion',
    initials: 'CL',
    tint: '#E0D8C9',
    trend: 'down',
    stats: { done: 2, total: 5, streak: 0, given: 3 },
  },
];

export const DEMO_INDEX: PeopleIndex = indexPeople([...DEMO_PEOPLE, ...OZ_PEOPLE]);

/**
 * A fresh account knows exactly one person — and the four who are not people.
 * The Global feed is public, so it renders before you know anybody, which is
 * precisely the account that has nothing else to look at.
 */
export const SELF_ONLY_INDEX: PeopleIndex = indexPeople([
  ...DEMO_PEOPLE.filter((p) => p.id === SELF_DEMO_ID),
  ...OZ_PEOPLE,
]);

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
