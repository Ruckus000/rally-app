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
import type { Task } from '../../data/fixtures';
import { reconcileTasks } from '../reconcile';

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

describe('reconcileTasks', () => {
  it('takes the server version of a clean row', () => {
    const local = [aTask({ id: 'a', title: 'Old', done: false })];
    const server = [fromWire({ id: 'a', title: 'New', done: true })];

    const out = reconcileTasks(local, server, clean);

    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('New');
    expect(out[0].done).toBe(true);
  });

  it('keeps the local version of a dirty row, untouched', () => {
    const mine = aTask({ id: 'a', title: 'Mine', done: true });
    const server = [fromWire({ id: 'a', title: 'Theirs', done: false })];

    const out = reconcileTasks([mine], server, dirty('a'));

    // Not just equal — the same object. The queued upsert is about to make the
    // server agree, so there is nothing here to merge.
    expect(out[0]).toBe(mine);
  });

  it('takes the server version when only `done` differs', () => {
    const local = [aTask({ id: 'a', done: false })];
    const server = [fromWire({ id: 'a', done: true })];

    const out = reconcileTasks(local, server, clean);

    expect(out[0].done).toBe(true);
    expect(out[0]).not.toBe(local[0]);
  });

  it('drops a clean local row the server no longer has', () => {
    const local = [aTask({ id: 'a' }), aTask({ id: 'b', day: 1 })];
    const server = [fromWire({ id: 'a' })];

    const out = reconcileTasks(local, server, clean);

    expect(out.map((t) => t.id)).toEqual(['a']);
  });

  it('keeps a dirty local row the server has never seen', () => {
    const fresh = aTask({ id: 'b', day: 1, title: 'Typed on a plane' });
    const local = [aTask({ id: 'a' }), fresh];

    const out = reconcileTasks(local, [fromWire({ id: 'a' })], dirty('b'));

    expect(out.map((t) => t.id)).toEqual(['a', 'b']);
    expect(out[1]).toBe(fresh);
  });

  it('adopts a row that only exists on the server', () => {
    const arrived = fromWire({ id: 'b', day: 2, title: 'Added on the other phone' });

    const out = reconcileTasks([aTask({ id: 'a' })], [fromWire({ id: 'a' }), arrived], clean);

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

    const out = reconcileTasks(local, local.map((t) => fromWire(t)), clean);

    expect(out.map((t) => t.id)).toEqual(['m', 'a', 'c', 'z']);
  });

  describe('identity', () => {
    it('returns the original array when nothing changed', () => {
      const local = [aTask({ id: 'a', day: 0 }), aTask({ id: 'b', day: 1 })];
      const server = local.map((t) => fromWire(t));

      expect(reconcileTasks(local, server, clean)).toBe(local);
    });

    it('keeps every unchanged element when one row did change', () => {
      const local = [aTask({ id: 'a', day: 0 }), aTask({ id: 'b', day: 1, title: 'Old' })];
      const server = [fromWire(local[0]), fromWire({ ...local[1], title: 'New' })];

      const out = reconcileTasks(local, server, clean);

      expect(out).not.toBe(local);
      expect(out[0]).toBe(local[0]);
      expect(out[1]).not.toBe(local[1]);
      expect(out[1].title).toBe('New');
    });

    it('returns the original array when a dirty row differs from the server', () => {
      const local = [aTask({ id: 'a', title: 'Mine' })];
      const server = [fromWire({ id: 'a', title: 'Theirs' })];

      expect(reconcileTasks(local, server, dirty('a'))).toBe(local);
    });

    it('returns the original array when the local list is already sorted and empty of news', () => {
      const local = [aTask({ id: 'a', day: 3 })];

      expect(reconcileTasks(local, [fromWire({ id: 'a', day: 3 })], clean)).toBe(local);
    });
  });

  describe('empty sides', () => {
    it('does not wipe dirty local work when the server returns nothing', () => {
      const local = [aTask({ id: 'a' }), aTask({ id: 'b', day: 1 })];

      const out = reconcileTasks(local, [], dirty('a', 'b'));

      expect(out).toBe(local);
    });

    it('drops clean local rows when the server returns nothing', () => {
      // A pull that legitimately came back empty means the other device cleared
      // the week. Only the queue can vouch for a row, and it is not vouching.
      const out = reconcileTasks([aTask({ id: 'a' })], [], clean);

      expect(out).toEqual([]);
    });

    it('fills an empty local list from the server', () => {
      const server = [fromWire({ id: 'b', day: 1 }), fromWire({ id: 'a', day: 0 })];

      const out = reconcileTasks([], server, clean);

      expect(out.map((t) => t.id)).toEqual(['a', 'b']);
    });

    it('returns the original empty array when both sides are empty', () => {
      const local: Task[] = [];

      expect(reconcileTasks(local, [], clean)).toBe(local);
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

    const out = reconcileTasks(local, [fromWire({ id: 'a', title: 'New' })], clean);

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

    reconcileTasks(local, server, clean);

    expect(local.map((t) => t.id)).toEqual(localOrder);
    expect(server.map((t) => t.id)).toEqual(serverOrder);
  });
});
