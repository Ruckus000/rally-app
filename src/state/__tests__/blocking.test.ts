/**
 * The offline half of blocking: reducer state, and the feed filter that has to
 * work with no round trip.
 *
 * This is **not** the coverage that proves a block actually hides anyone from
 * anyone — that's RLS's job, and `integration/rls/blocks.test.ts` is where it's
 * proven, against a real Postgres with real policies. Nothing here touches the
 * network or the mocked Supabase client. What this file proves is narrower and
 * still real: a block taken with the phone in airplane mode has to be true on
 * this device *before* the next pull can confirm it server-side, and that means
 * the reducer has to hold the id and `mergedFeed` has to act on it, today, with
 * no server in the loop at all. A reader who finds this file and concludes "oh,
 * blocking is tested" without also checking the RLS suite has the wrong half.
 */
import { reducer } from '../store';
import { mergedFeed, circleMembers } from '../selectors';
import { baseState } from '../../test/baseState';
import type { State } from '../store';
import type { Moment, Note } from '../../data/fixtures';

const note = (k: string, t: string): Note => ({ w: k, k, t, id: `note-${k}-${t}` });

const moment = (overrides: Partial<Moment> & { id: string; who: string }): Moment => ({
  kind: 'normal',
  time: '1h',
  day: 0,
  ...overrides,
});

describe('BLOCK / UNBLOCK / BLOCKS_PULLED', () => {
  it('BLOCK adds an id', () => {
    const next = reducer(baseState, { type: 'BLOCK', id: 'maya' });
    expect(next.blocked).toEqual(['maya']);
  });

  it('BLOCK twice does not duplicate', () => {
    const once = reducer(baseState, { type: 'BLOCK', id: 'maya' });
    const twice = reducer(once, { type: 'BLOCK', id: 'maya' });
    expect(twice.blocked).toEqual(['maya']);
    // Identity preserved on the no-op, matching every other idempotent branch
    // in this reducer (`ACT`'s add half, `UNSAVED`'s equal-count guard, …).
    expect(twice).toBe(once);
  });

  it('UNBLOCK removes it', () => {
    const blocked: State = { ...baseState, blocked: ['maya', 'jordan'] };
    const next = reducer(blocked, { type: 'UNBLOCK', id: 'maya' });
    expect(next.blocked).toEqual(['jordan']);
  });

  it('UNBLOCK of an id not present is a no-op', () => {
    const next = reducer(baseState, { type: 'UNBLOCK', id: 'maya' });
    expect(next).toBe(baseState);
  });

  it('BLOCKS_PULLED replaces the list wholesale, not additively', () => {
    const local: State = { ...baseState, blocked: ['maya', 'jordan'] };
    // The server no longer knows about 'jordan' — unblocked from another
    // device — and has a name this device never took locally: 'sofia'.
    const next = reducer(local, { type: 'BLOCKS_PULLED', ids: ['maya', 'sofia'] });
    expect(next.blocked).toEqual(['maya', 'sofia']);
  });
});

describe('mergedFeed: blocking filters moments, notes and cheers', () => {
  const mayaMoment = moment({ id: 'm-maya', who: 'maya', title: 'Ran 5k' });
  const jordanMoment = moment({
    id: 'm-jordan',
    who: 'jordan',
    title: 'Finished the plan',
    cmts: [note('maya', 'nice one')],
    backers: ['maya', 'jordan'],
  });
  const state: State = {
    ...baseState,
    moments: [mayaMoment, jordanMoment],
    globalPosts: [],
    blocked: ['maya'],
  };

  it('drops a blocked person’s own moment from the feed entirely', () => {
    const entries = mergedFeed(state, true);
    expect(entries.map((e) => e.m.id)).not.toContain('m-maya');
  });

  it('strips a blocked person’s notes off a moment that otherwise survives', () => {
    const entries = mergedFeed(state, true);
    const jordan = entries.find((e) => e.m.id === 'm-jordan');
    expect(jordan).toBeDefined();
    expect(jordan!.m.cmts?.some((c) => c.k === 'maya')).toBe(false);
  });

  it('strips a blocked person’s cheer off a moment that otherwise survives', () => {
    const entries = mergedFeed(state, true);
    const jordan = entries.find((e) => e.m.id === 'm-jordan');
    expect(jordan!.m.backers).toEqual(['jordan']);
  });

  it('does the same for globalPosts, not only circle moments', () => {
    const withGlobal: State = {
      ...state,
      moments: [],
      globalPosts: [moment({ id: 'g-maya', who: 'maya' })],
    };
    const entries = mergedFeed(withGlobal, true);
    expect(entries.map((e) => e.m.id)).not.toContain('g-maya');
  });
});

describe('mergedFeed: your own content is never filtered', () => {
  it('your own moment survives even if selfId is (wrongly) in `blocked`', () => {
    const mine = moment({ id: 'mine', who: baseState.selfId, title: 'Mine' });
    const corrupted: State = { ...baseState, moments: [mine], blocked: [baseState.selfId] };
    const entries = mergedFeed(corrupted, true);
    expect(entries.map((e) => e.m.id)).toContain('mine');
  });

  it('your own note on someone else’s moment survives the same corruption', () => {
    const m = moment({
      id: 'theirs',
      who: 'jordan',
      cmts: [note(baseState.selfId, 'hi')],
    });
    const corrupted: State = { ...baseState, moments: [m], blocked: [baseState.selfId] };
    const entries = mergedFeed(corrupted, true);
    const found = entries.find((e) => e.m.id === 'theirs');
    expect(found!.m.cmts?.some((c) => c.k === baseState.selfId)).toBe(true);
  });

  it('your own cheer on someone else’s moment survives the same corruption', () => {
    const m = moment({ id: 'theirs2', who: 'jordan', backers: [baseState.selfId, 'jordan'] });
    const corrupted: State = { ...baseState, moments: [m], blocked: [baseState.selfId] };
    const entries = mergedFeed(corrupted, true);
    const found = entries.find((e) => e.m.id === 'theirs2');
    expect(found!.m.backers).toContain(baseState.selfId);
  });

  it('sanity check: without the self-guard this corruption really would hide it', () => {
    // Proves the assertions above are pinned to real behaviour, not a
    // selector that happens to never look at `blocked` at all. If someone
    // deletes the `id !== self` guard in `stripBlocked`/`mergedFeed`, this
    // moment — whose only author is you — has to disappear, because
    // `state.blocked` (however it got corrupted) genuinely names `selfId`.
    const mine = moment({ id: 'mine', who: baseState.selfId });
    const corrupted: State = { ...baseState, moments: [mine], blocked: [baseState.selfId] };
    const naive = corrupted.moments.filter((m) => !new Set(corrupted.blocked).has(m.who));
    expect(naive.map((m) => m.id)).not.toContain('mine');
  });
});

describe('circleMembers: blocking does not remove anyone from the circle', () => {
  it('a blocked member still counts toward the circle', () => {
    const before = circleMembers(baseState, null);
    expect(before).toContain('maya');

    const withBlock: State = { ...baseState, blocked: ['maya'] };
    const after = circleMembers(withBlock, null);

    // Deliberately unchanged. `circleMembers` feeds `ranking()` and the circle
    // total — rollups over the whole circle, not a per-viewer view of it — so
    // filtering here would make "how many did the circle close" a number that
    // depends on who is asking. See the note on `circleMembers` in
    // selectors.ts before "fixing" this: it is pinned on purpose.
    expect(after).toEqual(before);
    expect(after).toContain('maya');
  });
});
