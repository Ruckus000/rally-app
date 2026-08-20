/**
 * The guard on the one part of PR 6c that could have changed a colour.
 *
 * Everything else in that change is a read moving from an import to a hook,
 * which either compiles to the same value or does not compile. Avatar tints
 * are different: the hex left the person and became an *index*, the palette
 * grew from seven entries to ten, and the hash that answers for an id nobody
 * has a designed tint for now returns a slot rather than a colour. Three
 * moving parts, any one of which could re-tint a face without anything
 * failing to build.
 *
 * So this file states the only thing that matters — **every id resolves to
 * exactly the colour it resolved to before** — twice, from both ends: the
 * eleven fixture people by name, and the hash by re-running the implementation
 * it replaced against the palette it replaced.
 *
 * It lives under `src/theme/` rather than beside `people.ts` because that is
 * the directory the raw-colour lint rule exempts, and a test whose whole
 * purpose is to write down historical hexes has to be able to write them down.
 */
import {
  DEMO_INDEX,
  HASHED_TINTS,
  indexPeople,
  makePeople,
  Person,
  SELF_DEMO_ID,
  tintIndex,
  withFixtureTints,
} from '../../data/people';
import { hydrate } from '../../state/store';
import { personTints } from '../tokens';

const people = makePeople(DEMO_INDEX, SELF_DEMO_ID);

/** What `people.tint(id)` used to hand back, now that it hands back a slot. */
const colourOf = (id: string): string => personTints[people.tintIndex(id)];

/**
 * The array as it stood before the Oz hues joined it, and the modulus that
 * went with it. Copied on purpose: this is a record of what shipped, not a
 * second definition of what should ship, so it must *not* follow `tokens.ts`
 * when the dark palette edits it. When that PR lands, these values stop
 * matching and the failure is the point — it will say which face moved.
 */
const LEGACY_TINTS = [
  '#E0E6D3',
  '#D5E2BD',
  '#E9E0C2',
  '#E8CFBE',
  '#C9D9CE',
  '#EFE3AE',
  '#CBD6C4',
];

/** `hashTint`, verbatim, from before it was split into hash and lookup. */
const legacyHashTint = (id: string): string => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return LEGACY_TINTS[(h >>> 0) % LEGACY_TINTS.length];
};

describe('every fixture person keeps the exact colour they had', () => {
  it('draws the demo circle in slots 0-6, in order', () => {
    // These seven hexes used to be written into `DEMO_PEOPLE` as a
    // byte-for-byte second copy of `personTints`. That duplication is what the
    // index removes; this is the proof it removed nothing else.
    expect(colourOf('you')).toBe('#E0E6D3');
    expect(colourOf('maya')).toBe('#D5E2BD');
    expect(colourOf('dre')).toBe('#E9E0C2');
    expect(colourOf('jordan')).toBe('#E8CFBE');
    expect(colourOf('sofia')).toBe('#C9D9CE');
    expect(colourOf('nana')).toBe('#EFE3AE');
    expect(colourOf('tomas')).toBe('#CBD6C4');
  });

  it('draws the Oz bots in their own three hues, and the Scarecrow beside Dre', () => {
    expect(colourOf('dorothy')).toBe('#D8C9E0');
    expect(colourOf('tinman')).toBe('#C9DCE0');
    expect(colourOf('lion')).toBe('#E0D8C9');
    // The one overlap, and it was there before: slot 2, the same warm sand.
    expect(colourOf('scarecrow')).toBe('#E9E0C2');
    expect(colourOf('scarecrow')).toBe(colourOf('dre'));
  });

  it('gives the bots hues the palette proper does not contain', () => {
    // Which is the design point of slots 7-9: nobody mistakes the Tin Man for
    // somebody they might know, and the colour is part of saying so.
    for (const bot of ['dorothy', 'tinman', 'lion']) {
      expect(LEGACY_TINTS).not.toContain(colourOf(bot));
    }
  });
});

describe('an id nobody has a designed tint for', () => {
  /** Uuid-shaped, demo-shaped and degenerate — the three kinds that reach it. */
  const ids = [
    '',
    'a',
    'someone',
    '__proto__',
    'Tomás',
    ...Array.from({ length: 400 }, (_, i) => `9f8b${i}c1e-4d2a-4c3b-8e7f-${i}0a1b2c3d4e5`),
  ];

  it('lands on exactly the colour the old hash gave it', () => {
    // The whole claim of the split, checked end to end: the arithmetic in
    // `people.ts` plus the lookup in `tokens.ts` equals the function that used
    // to do both. 405 ids rather than a handful, because a modulus change is
    // the failure mode and a modulus change is invisible on a small sample.
    for (const id of ids) {
      expect(colourOf(id)).toBe(legacyHashTint(id));
    }
  });

  it('never lands on a bot hue, however many ids you try', () => {
    // `HASHED_TINTS` is seven while the array is ten, and this is why. A
    // stranger arriving in lilac would be a stranger dressed as a fiction.
    for (const id of ids) {
      expect(tintIndex(id)).toBeLessThan(HASHED_TINTS);
    }
  });

  it('is what the "Someone" stranger row is coloured with', () => {
    // `makePeople` answers for an id it has never seen by inventing a person,
    // and that person carries the hashed slot rather than nothing.
    expect(people.get('nobody-at-all').tintIndex).toBe(tintIndex('nobody-at-all'));
  });
});

describe('the palette and the modulus, which live in different files', () => {
  it('has at least as many tints as the hash can reach', () => {
    // The one invariant `tokens.ts` and `people.ts` have to agree on, and the
    // only reason `people.ts` can get away with importing nothing from the
    // theme. An undershoot here is `personTints[7]` on a seven-entry array:
    // `undefined`, which React Native renders as a transparent circle.
    expect(personTints.length).toBeGreaterThanOrEqual(HASHED_TINTS);
  });

  it('still opens with the seven the palette proper has always been', () => {
    // Insertions go at the end. One in the middle re-tints everybody after it
    // — silently, since an index is an index — and this is what says so.
    expect(personTints.slice(0, HASHED_TINTS)).toEqual(LEGACY_TINTS);
  });
});

describe('a directory restored from a build that wrote hexes', () => {
  /** What a payload written before the index existed looks like: no `tintIndex`. */
  const fromDisk: Person[] = [
    { id: 'maya', name: 'Maya Chen', first: 'Maya', initials: 'MC' },
    { id: 'scarecrow', name: 'The Scarecrow', first: 'Scarecrow', initials: 'SC' },
    { id: '9f8b0c1e-4d2a-4c3b-8e7f-00a1b2c3d4e5', name: 'A Real Person', first: 'A', initials: 'AR' },
  ];

  it('hands the fixture cast their designed colours back', () => {
    // Without the repair these fall through to the hash, and the first launch
    // after upgrading recolours every face in the demo — which is precisely
    // the "nothing may look different" promise, broken by a refactor.
    const people = makePeople(indexPeople(withFixtureTints(fromDisk)), SELF_DEMO_ID);
    expect(personTints[people.tintIndex('maya')]).toBe('#D5E2BD');
    expect(personTints[people.tintIndex('scarecrow')]).toBe('#E9E0C2');
  });

  it('leaves a live row alone, because a live row never carried a tint', () => {
    const id = '9f8b0c1e-4d2a-4c3b-8e7f-00a1b2c3d4e5';
    expect(withFixtureTints(fromDisk).find((p) => p.id === id)?.tintIndex).toBeUndefined();
    const people = makePeople(indexPeople(withFixtureTints(fromDisk)), SELF_DEMO_ID);
    expect(people.tintIndex(id)).toBe(tintIndex(id));
  });

  it('is repaired on the way in, not somewhere a caller has to remember', () => {
    // The wiring, not the function: `hydrate` is the single door a persisted
    // directory comes through, and the repair has to be on it.
    const state = hydrate({ people: indexPeople(fromDisk) });
    expect(state.people['maya']?.tintIndex).toBe(1);
  });
});
