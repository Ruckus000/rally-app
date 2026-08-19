/**
 * The order, and the refusal.
 *
 * `src/sync/outbox.ts` holds writes that have not reached the server, and
 * `signOutEverywhere` deliberately completes locally when it cannot reach the
 * network. Put those two together with a wipe and you get a silent
 * permanent-loss window: sign out in a tunnel with work still queued, and the
 * wipe takes it off the device having never sent it, so signing back in
 * restores everything except the thing you did last. That is exactly the class
 * of bug this whole settings page was opened to remove, so the sequence refuses
 * instead — and the refusal is what these tests are for.
 *
 * The spies are `jest.spyOn` on the real modules rather than `jest.mock`
 * factories, which works because babel's CJS interop here defines exports as
 * writable properties. That matters: a factory would let the module's real
 * signatures drift away from what these tests pretend they are, and this is the
 * one place where the wrong call order loses somebody's data.
 */
import { attemptSignOut, unsentLine } from '../signOut';
import * as outbox from '../../../sync/outbox';
import * as session from '../../../sync/session';
import * as engine from '../../../sync/useSyncEngine';
import type { OutboxEntry } from '../../../sync/outbox';

/** The real shape, not a widened cast — see `OutboxEntry` in `sync/outbox.ts`. */
const entry = (key: string): OutboxEntry => ({
  id: `id-${key}`,
  seq: 1,
  op: 'task.upsert',
  key,
  payload: {},
  at: 0,
  tries: 0,
  nextAt: 0,
});

describe('attemptSignOut', () => {
  let flush: jest.SpyInstance;
  let pending: jest.SpyInstance;
  let out: jest.SpyInstance;
  let kick: jest.SpyInstance;

  beforeEach(() => {
    flush = jest.spyOn(outbox, 'flushOutbox').mockResolvedValue(undefined);
    pending = jest.spyOn(outbox, 'pending').mockReturnValue([]);
    out = jest.spyOn(session, 'signOutEverywhere').mockResolvedValue(undefined);
    kick = jest.spyOn(engine, 'kickSync').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  // Not "last chance to send" — `flushOutbox` writes to AsyncStorage, it does
  // not send. The order matters because `signOutEverywhere` and the wipe that
  // follows it must not run over the top of a queue still sitting in the
  // debounce, where a force-quit would take it with nothing on disk.
  it('persists before it signs out, so the queue is on disk before the wipe', async () => {
    const order: string[] = [];
    flush.mockImplementation(async () => void order.push('flush'));
    out.mockImplementation(async () => void order.push('signOut'));

    await attemptSignOut();

    expect(order).toEqual(['flush', 'signOut']);
  });

  it('starts a send rather than only persisting, so the retry can succeed', async () => {
    // `flushOutbox` writes the queue to AsyncStorage; it does not send. Without
    // the kick, a refusal would leave nothing in motion and the user would be
    // retrying against a queue only the 5-second scheduler was going to move.
    await attemptSignOut();
    expect(kick).toHaveBeenCalled();
  });

  it('signs out when the queue drained', async () => {
    await expect(attemptSignOut()).resolves.toEqual({ ok: true });
    expect(out).toHaveBeenCalled();
  });

  it('refuses, and does not sign out, when work is still unsent', async () => {
    pending.mockReturnValue([entry('task:a'), entry('task:b')]);

    await expect(attemptSignOut()).resolves.toEqual({ ok: false, unsent: 2 });
    expect(out).not.toHaveBeenCalled();
  });

  it('counts things, not attempts', async () => {
    // One task written and then deleted is two ops about one row. Telling
    // someone two things are unsent when one is would be its own small lie —
    // the same reasoning `unsavedCount` documents.
    pending.mockReturnValue([entry('task:a'), entry('task:a')]);

    await expect(attemptSignOut()).resolves.toEqual({ ok: false, unsent: 1 });
  });
});

describe('unsentLine', () => {
  it('speaks singular without a bare number', () => {
    expect(unsentLine(1)).toContain('One thing');
  });

  it('names the count in the plural', () => {
    expect(unsentLine(3)).toContain('3 things');
  });
});
