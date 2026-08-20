/**
 * These tests are mostly about references, not values.
 *
 * `toEqual` would pass on a reconcile that rebuilt every task on every poll,
 * and that version of the function is broken in a way the user feels: the
 * engine reference-diffs `myTasks`, so a rebuilt-but-identical task looks like
 * a local edit and gets pushed back to the server it just came from. So the
 * identity assertions below are deliberately `toBe`, at both the array and the
 * element level.
 */
import type { Task, TaskMedia } from '../../data/fixtures';
import { reconcileMedia, reconcileTasks } from '../reconcile';

const aTask = (over: Partial<Task> = {}): Task => ({
  id: 'a',
  day: 0,
  title: 'Run 3x this week',
  cat: 'Fitness',
  pts: 40,
  done: false,
  aud: 'friends',
  pair: [],
  pairKind: null,
  cmts: [],
  source: 'staked',
  ...over,
});

/** What a pull produces: `rowToTask` cannot answer for pairs or comments. */
const fromWire = (over: Partial<Task> = {}): Task =>
  aTask({ pair: [], pairKind: null, cmts: [], ...over });

const clean: ReadonlySet<string> = new Set<string>();
const dirty = (...ids: string[]): ReadonlySet<string> => new Set(ids);
/**
 * Every id these tests use, treated as already confirmed by the server.
 * Dropping a local row now requires that confirmation — the two tests at the
 * bottom of this file cover what happens without it.
 */
const allAcked: ReadonlySet<string> = new Set(['a', 'b', 'c', 'd', 'e']);

describe('reconcileTasks', () => {
  it('takes the server version of a clean row', () => {
    const local = [aTask({ id: 'a', title: 'Old', done: false })];
    const server = [fromWire({ id: 'a', title: 'New', done: true })];

    const out = reconcileTasks(local, server, clean, allAcked);

    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('New');
    expect(out[0].done).toBe(true);
  });

  it('keeps the local version of a dirty row, untouched', () => {
    const mine = aTask({ id: 'a', title: 'Mine', done: true });
    const server = [fromWire({ id: 'a', title: 'Theirs', done: false })];

    const out = reconcileTasks([mine], server, dirty('a'), allAcked);

    // Not just equal — the same object. The queued upsert is about to make the
    // server agree, so there is nothing here to merge.
    expect(out[0]).toBe(mine);
  });

  it('takes the server version when only `done` differs', () => {
    const local = [aTask({ id: 'a', done: false })];
    const server = [fromWire({ id: 'a', done: true })];

    const out = reconcileTasks(local, server, clean, allAcked);

    expect(out[0].done).toBe(true);
    expect(out[0]).not.toBe(local[0]);
  });

  it('drops a clean local row the server no longer has', () => {
    const local = [aTask({ id: 'a' }), aTask({ id: 'b', day: 1 })];
    const server = [fromWire({ id: 'a' })];

    const out = reconcileTasks(local, server, clean, allAcked);

    expect(out.map((t) => t.id)).toEqual(['a']);
  });

  it('keeps a dirty local row the server has never seen', () => {
    const fresh = aTask({ id: 'b', day: 1, title: 'Typed on a plane' });
    const local = [aTask({ id: 'a' }), fresh];

    const out = reconcileTasks(local, [fromWire({ id: 'a' })], dirty('b'), allAcked);

    expect(out.map((t) => t.id)).toEqual(['a', 'b']);
    expect(out[1]).toBe(fresh);
  });

  it('adopts a row that only exists on the server', () => {
    const arrived = fromWire({ id: 'b', day: 2, title: 'Added on the other phone' });

    const out = reconcileTasks([aTask({ id: 'a' })], [fromWire({ id: 'a' }), arrived], clean, allAcked);

    expect(out.map((t) => t.id)).toEqual(['a', 'b']);
    expect(out[1]).toBe(arrived);
  });

  it('sorts by day, with the id as the tiebreaker', () => {
    const local = [
      aTask({ id: 'z', day: 4 }),
      aTask({ id: 'm', day: 0 }),
      aTask({ id: 'c', day: 4 }),
      aTask({ id: 'a', day: 1 }),
    ];

    const out = reconcileTasks(local, local.map((t) => fromWire(t)), clean, allAcked);

    expect(out.map((t) => t.id)).toEqual(['m', 'a', 'c', 'z']);
  });

  describe('identity', () => {
    it('returns the original array when nothing changed', () => {
      const local = [aTask({ id: 'a', day: 0 }), aTask({ id: 'b', day: 1 })];
      const server = local.map((t) => fromWire(t));

      expect(reconcileTasks(local, server, clean, allAcked)).toBe(local);
    });

    it('keeps every unchanged element when one row did change', () => {
      const local = [aTask({ id: 'a', day: 0 }), aTask({ id: 'b', day: 1, title: 'Old' })];
      const server = [fromWire(local[0]), fromWire({ ...local[1], title: 'New' })];

      const out = reconcileTasks(local, server, clean, allAcked);

      expect(out).not.toBe(local);
      expect(out[0]).toBe(local[0]);
      expect(out[1]).not.toBe(local[1]);
      expect(out[1].title).toBe('New');
    });

    it('returns the original array when a dirty row differs from the server', () => {
      const local = [aTask({ id: 'a', title: 'Mine' })];
      const server = [fromWire({ id: 'a', title: 'Theirs' })];

      expect(reconcileTasks(local, server, dirty('a'), allAcked)).toBe(local);
    });

    it('returns the original array when the local list is already sorted and empty of news', () => {
      const local = [aTask({ id: 'a', day: 3 })];

      expect(reconcileTasks(local, [fromWire({ id: 'a', day: 3 })], clean, allAcked)).toBe(local);
    });
  });

  describe('empty sides', () => {
    it('does not wipe dirty local work when the server returns nothing', () => {
      const local = [aTask({ id: 'a' }), aTask({ id: 'b', day: 1 })];

      const out = reconcileTasks(local, [], dirty('a', 'b'), allAcked);

      expect(out).toBe(local);
    });

    it('drops clean local rows when the server returns nothing', () => {
      // A pull that legitimately came back empty means the other device cleared
      // the week. Only the queue can vouch for a row, and it is not vouching.
      const out = reconcileTasks([aTask({ id: 'a' })], [], clean, allAcked);

      expect(out).toEqual([]);
    });

    it('fills an empty local list from the server', () => {
      const server = [fromWire({ id: 'b', day: 1 }), fromWire({ id: 'a', day: 0 })];

      const out = reconcileTasks([], server, clean, allAcked);

      expect(out.map((t) => t.id)).toEqual(['a', 'b']);
    });

    it('returns the original empty array when both sides are empty', () => {
      const local: Task[] = [];

      expect(reconcileTasks(local, [], clean, allAcked)).toBe(local);
    });
  });

  it('does not let a task row erase pairs and comments it cannot carry', () => {
    // `rowToTask` fills these with empties by design — they are their own pulls.
    const local = [
      aTask({
        id: 'a',
        title: 'Old',
        pair: ['dre'],
        pairKind: 'joint',
        pairStatus: { dre: false },
        cmts: [{ w: 'Dre', k: 'dre', t: 'Thursday.' }],
      }),
    ];

    const out = reconcileTasks(local, [fromWire({ id: 'a', title: 'New' })], clean, allAcked);

    expect(out[0].title).toBe('New');
    expect(out[0].pair).toBe(local[0].pair);
    expect(out[0].cmts).toBe(local[0].cmts);
    expect(out[0].pairKind).toBe('joint');
    expect(out[0].pairStatus).toEqual({ dre: false });
  });

  it('does not mutate its inputs', () => {
    const local = [aTask({ id: 'z', day: 4 }), aTask({ id: 'a', day: 0 })];
    const server = [fromWire({ id: 'a', day: 0 }), fromWire({ id: 'z', day: 4 })];
    const localOrder = local.map((t) => t.id);
    const serverOrder = server.map((t) => t.id);

    reconcileTasks(local, server, clean, allAcked);

    expect(local.map((t) => t.id)).toEqual(localOrder);
    expect(server.map((t) => t.id)).toEqual(serverOrder);
  });
});

describe('a row is only deleted on evidence the server ever held it', () => {
  const neverAcked: ReadonlySet<string> = new Set();

  it('keeps a local row the server has never confirmed', () => {
    // "Absent from the server" also describes a row that never got there: an
    // upsert refused permanently and dead-lettered, or one belonging to a
    // session since replaced by a fresh anonymous id, whose pull legitimately
    // returns nothing. Deleting on that evidence turns a sync failure into
    // data loss.
    const local = [aTask({ id: 'a', title: 'Never landed' })];

    const out = reconcileTasks(local, [], clean, neverAcked);

    expect(out).toBe(local);
  });

  it('does not wipe the week when a pull comes back empty for the wrong reason', () => {
    const local = [aTask({ id: 'a' }), aTask({ id: 'b' }), aTask({ id: 'c' })];

    expect(reconcileTasks(local, [], clean, neverAcked)).toHaveLength(3);
  });

  it('still deletes a row another device really removed', () => {
    const local = [aTask({ id: 'a' }), aTask({ id: 'b' })];

    const out = reconcileTasks(local, [fromWire({ id: 'a' })], clean, allAcked);

    expect(out.map((t) => t.id)).toEqual(['a']);
  });
});

describe('a delete that has not drained yet', () => {
  it('is not undone by a pull that still sees the row', () => {
    // The reducer has already removed it locally, so the first loop never
    // sees it — and the server has not processed the delete, so the pull
    // still returns it. Folding it back in resurrects a task the user
    // explicitly removed, and the engine then re-enqueues an upsert for it.
    // kick() runs drain and pull in parallel, so this is an ordinary race.
    const local = [aTask({ id: 'a' })];
    const server = [fromWire({ id: 'a' }), fromWire({ id: 'b', title: 'Deleted a moment ago' })];

    const out = reconcileTasks(local, server, dirty('b'), allAcked);

    expect(out.map((t) => t.id)).toEqual(['a']);
  });
});

/**
 * Folding the pull's photos into your own week.
 *
 * Every failure here is silent, which is why each branch gets its own test: a
 * photo that never appears and a photo that is quietly deleted both look
 * exactly like a goal that never had one.
 */
describe('reconcileMedia', () => {
  const photo = (over: Partial<TaskMedia> = {}): TaskMedia => ({
    id: 'p1',
    path: 'owner/a/p1.jpg',
    w: 1600,
    h: 1200,
    ...over,
  });

  const from = (entries: [string, TaskMedia][]) => new Map(entries);

  it('says nothing about photos when the pull could not', () => {
    // Null is silence — a week-less pull, or a server too old to know the key.
    // Empty would be an answer, and the answer would be "delete them all".
    const local = [aTask({ media: photo() })];
    expect(reconcileMedia(local, null, clean)).toBe(local);
  });

  it('adds a photo the pull knows about and this device does not', () => {
    // A reinstall, or a goal staked and photographed on the other phone.
    const local = [aTask()];
    const next = reconcileMedia(local, from([['a', photo({ url: 'https://x/1' })]]), clean);

    expect(next[0]!.media).toEqual(photo({ url: 'https://x/1' }));
  });

  it('keeps this device’s object and takes only the url', () => {
    // `localUri` is the half the server has never heard of, and the half that
    // renders instantly. The url is the half only the pull can answer for.
    const mine = photo({ localUri: 'file:///tmp/a.jpg' });
    const local = [aTask({ media: mine })];

    const next = reconcileMedia(local, from([['a', photo({ url: 'https://x/1' })]]), clean);

    expect(next[0]!.media).toEqual({ ...mine, url: 'https://x/1' });
  });

  it('takes a replacement photo', () => {
    const local = [aTask({ media: photo({ id: 'old' }) })];
    const next = reconcileMedia(local, from([['a', photo({ id: 'new' })]]), clean);
    expect(next[0]!.media!.id).toBe('new');
  });

  it('removes a photo the server no longer has', () => {
    // How a removal on another device arrives. There is no other signal.
    const local = [aTask({ media: photo() })];
    const next = reconcileMedia(local, from([]), clean);
    expect(next[0]!.media).toBeUndefined();
  });

  it('removes it even though this device still holds the file', () => {
    // The trap. `localUri` survives a successful upload — `media.ts` keeps the
    // file precisely because it is what the owner's own card draws — so gating
    // the removal on it would mean a removal elsewhere never arrives here. Not
    // a window: for ever.
    const local = [aTask({ media: photo({ localUri: 'file:///tmp/a.jpg' }) })];
    const next = reconcileMedia(local, from([]), clean);
    expect(next[0]!.media).toBeUndefined();
  });

  it('leaves a goal alone while this device is mid-change', () => {
    // An upload part-way up, an attach the server has not seen, a detach it has
    // not processed. The pull is answering for a state we are leaving.
    const local = [aTask({ media: photo({ localUri: 'file:///tmp/a.jpg' }) })];
    expect(reconcileMedia(local, from([]), dirty('a'))).toBe(local);
  });

  it('does not resurrect a photo removed here but not yet on the server', () => {
    const local = [aTask()];
    const next = reconcileMedia(local, from([['a', photo()]]), dirty('a'));
    expect(next[0]!.media).toBeUndefined();
  });

  it('is identity when nothing moved, so no task is re-sent', () => {
    // The reference contract this whole file exists for: a rebuilt-but-equal
    // task reads as a local edit and is pushed back at the server that sent it.
    const local = [aTask({ media: photo({ url: 'https://x/1' }) }), aTask({ id: 'b' })];
    const same = reconcileMedia(local, from([['a', photo({ url: 'https://x/1' })]]), clean);

    expect(same).toBe(local);
    expect(same[0]).toBe(local[0]);
  });

  it('leaves untouched goals identical when one photo changes', () => {
    const local = [aTask({ media: photo() }), aTask({ id: 'b' })];
    const next = reconcileMedia(local, from([['a', photo({ url: 'https://x/1' })]]), clean);

    expect(next).not.toBe(local);
    expect(next[1]).toBe(local[1]);
  });
});
