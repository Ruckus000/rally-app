/**
 * The keys below are not invented. Every non-syncable one is copied from a live
 * `dispatch({ type: 'ACT', ... })` site, because the whole value of this gate is
 * that it holds against the keys the app actually writes — a gate tested only
 * against tidy examples passes while the real feed queues five doomed inserts.
 *
 *   WeekScreen ~246   `${m.id}:cheer`      → `f1:cheer`   moment id (fixture)
 *   WeekScreen ~331   `${g.id}:cheer`      → `g1:cheer`   global post, no table
 *   WeekScreen ~171   `mywin:share`                       a literal, not a row
 *   DetailSheet ~393  `${who}${i}:a`       → `maya0:a`    synthetic index
 */
import { diffActed, parseActedKey, reactionKey, REACTION_KINDS } from '../reactions';

const TASK = '4d1f0f3a-6c2b-4a0e-9f77-1b2c3d4e5f60';
const OTHER = 'a0000000-0000-4000-8000-000000000001';

describe('parseActedKey', () => {
  it('accepts a real task id with every kind in the enum', () => {
    for (const kind of REACTION_KINDS) {
      expect(parseActedKey(`${TASK}:${kind}`)).toEqual({ targetId: TASK, kind });
    }
  });

  it('rejects a moment id from the personal feed', () => {
    expect(parseActedKey('f1:cheer')).toBeNull();
    expect(parseActedKey('f2:in')).toBeNull();
    expect(parseActedKey('f5:cosign')).toBeNull();
    expect(parseActedKey('f1:nod')).toBeNull();
  });

  it('rejects a global post id — target_type=post has no backing table', () => {
    expect(parseActedKey('g1:cheer')).toBeNull();
  });

  it('rejects the mywin literal — a self-share is not a reaction on a row', () => {
    expect(parseActedKey('mywin:share')).toBeNull();
  });

  it('rejects the detail sheet’s synthetic index', () => {
    expect(parseActedKey('maya0:a')).toBeNull();
    // Even with a kind that is in the enum, the target is still not a row id.
    expect(parseActedKey('maya0:cheer')).toBeNull();
  });

  it('rejects a kind outside the enum on an otherwise real target', () => {
    expect(parseActedKey(`${TASK}:a`)).toBeNull();
    expect(parseActedKey(`${TASK}:Cheer`)).toBeNull();
    expect(parseActedKey(`${TASK}:cheered`)).toBeNull();
  });

  it('splits on the last colon', () => {
    // A first-colon split would read this as target `task`, kind `<uuid>:cheer`.
    // Splitting last makes the target `task:<uuid>`, which is not a uuid.
    expect(parseActedKey(`task:${TASK}:cheer`)).toBeNull();
    expect(parseActedKey(`${TASK}:cheer`)).toEqual({ targetId: TASK, kind: 'cheer' });
  });

  it('rejects keys with no usable halves', () => {
    expect(parseActedKey('')).toBeNull();
    expect(parseActedKey('mywin')).toBeNull();
    expect(parseActedKey(`${TASK}:`)).toBeNull();
    expect(parseActedKey(':cheer')).toBeNull();
  });

  it('normalises a mixed-case uuid, which Postgres would render lowercase', () => {
    expect(parseActedKey(`${TASK.toUpperCase()}:cheer`)).toEqual({ targetId: TASK, kind: 'cheer' });
  });
});

describe('diffActed', () => {
  it('reports a cheer as an insert', () => {
    expect(diffActed({}, { [`${TASK}:cheer`]: true })).toEqual({
      added: [{ targetId: TASK, kind: 'cheer' }],
      removed: [],
    });
  });

  it('reports a cheer taken back as a delete', () => {
    expect(diffActed({ [`${TASK}:cheer`]: true }, {})).toEqual({
      added: [],
      removed: [{ targetId: TASK, kind: 'cheer' }],
    });
  });

  it('reports nothing when nothing moved', () => {
    const acted = { [`${TASK}:cheer`]: true, [`${OTHER}:in`]: true };
    expect(diffActed(acted, acted)).toEqual({ added: [], removed: [] });
  });

  it('reports both halves of a swap', () => {
    const { added, removed } = diffActed(
      { [`${TASK}:cheer`]: true },
      { [`${OTHER}:cosign`]: true },
    );
    expect(added).toEqual([{ targetId: OTHER, kind: 'cosign' }]);
    expect(removed).toEqual([{ targetId: TASK, kind: 'cheer' }]);
  });

  it('ignores every non-syncable key on both sides', () => {
    const prev = { 'f1:cheer': true, 'mywin:share': true, 'maya0:a': true } as const;
    const next = { 'g1:cheer': true, 'f2:in': true } as const;
    expect(diffActed(prev, next)).toEqual({ added: [], removed: [] });
  });

  it('picks the one real reaction out of a feed full of fixtures', () => {
    const prev = { 'f1:cheer': true, 'mywin:share': true };
    const next = { ...prev, 'g1:cheer': true, [`${TASK}:cheer`]: true };
    expect(diffActed(prev, next)).toEqual({
      added: [{ targetId: TASK, kind: 'cheer' }],
      removed: [],
    });
  });

  it('treats a falsy value as absent rather than as a reaction', () => {
    expect(diffActed({}, { [`${TASK}:cheer`]: false })).toEqual({ added: [], removed: [] });
    expect(diffActed({ [`${TASK}:cheer`]: false }, {})).toEqual({ added: [], removed: [] });
  });
});

describe('reactionKey', () => {
  it('is the unique tuple, so an insert and its undo coalesce', () => {
    expect(reactionKey({ targetId: TASK, kind: 'cheer' })).toBe(`reaction:${TASK}:cheer`);
  });

  it('separates kinds on the same target', () => {
    expect(reactionKey({ targetId: TASK, kind: 'cheer' })).not.toBe(
      reactionKey({ targetId: TASK, kind: 'cosign' }),
    );
  });
});
