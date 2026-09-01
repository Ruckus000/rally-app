/**
 * The refusal, and what it is protecting.
 *
 * `tasks_insert` carries `circle_id is null or private.is_circle_member(...)`,
 * and Postgres applies an INSERT policy's `WITH CHECK` only to rows taking the
 * insert path of an upsert. So a queued write for a goal the server already has
 * is safe; a goal staked **offline and not yet sent** is not. Leave the room it
 * is tagged to and that insert becomes a permanent 42501, which `classify`
 * calls non-retryable and the outbox retires — the stake lands in `unsaved` and
 * reaches nobody. Refusing on any unsent work is the only thing standing
 * between "leave a circle" and "lose the goal you staked in it this morning".
 *
 * The spies follow `signOut.test.ts`: `jest.spyOn` on the real modules, so the
 * signatures cannot drift away from what these tests pretend they are.
 */
import { attemptLeaveCircle, leaveUnsentLine } from '../leaveCircle';
import * as outbox from '../../../sync/outbox';
import * as transport from '../../../sync/transport';
import * as engine from '../../../sync/useSyncEngine';
import type { OutboxEntry } from '../../../sync/outbox';

const CIRCLE = 'c-basement';
const ME = 'u-me';

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

describe('attemptLeaveCircle', () => {
  let flush: jest.SpyInstance;
  let pending: jest.SpyInstance;
  let leave: jest.SpyInstance;
  let kick: jest.SpyInstance;

  beforeEach(() => {
    flush = jest.spyOn(outbox, 'flushOutbox').mockResolvedValue(undefined);
    pending = jest.spyOn(outbox, 'pending').mockReturnValue([]);
    leave = jest.spyOn(transport, 'leaveCircle').mockResolvedValue(undefined);
    kick = jest.spyOn(engine, 'kickSync').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('persists before it deletes anything', async () => {
    const order: string[] = [];
    flush.mockImplementation(async () => void order.push('flush'));
    leave.mockImplementation(async () => void order.push('leave'));

    await attemptLeaveCircle(CIRCLE, ME);

    expect(order).toEqual(['flush', 'leave']);
  });

  it('leaves when the queue has drained, naming both the circle and the member', async () => {
    await expect(attemptLeaveCircle(CIRCLE, ME)).resolves.toEqual({ ok: true });
    expect(leave).toHaveBeenCalledWith(CIRCLE, ME);
  });

  it('refuses while work is unsent, and does not touch the membership', async () => {
    // The assertion that matters is the second one. A return value saying
    // "refused" over a delete that already happened would be the goal-loss bug
    // with a reassuring message on top.
    pending.mockReturnValue([entry('task:a'), entry('task:b')]);

    await expect(attemptLeaveCircle(CIRCLE, ME)).resolves.toEqual({
      ok: false,
      reason: 'unsent',
      unsent: 2,
    });
    expect(leave).not.toHaveBeenCalled();
  });

  it('starts a send on the refusal, so "give it a moment" is honest advice', async () => {
    pending.mockReturnValue([entry('task:a')]);
    await attemptLeaveCircle(CIRCLE, ME);
    expect(kick).toHaveBeenCalled();
  });

  it('does not kick on the way out when it succeeds', async () => {
    // `kickSync` also starts a *pull*, and one begun before the delete can
    // answer after it with a `circles` list that still holds this circle —
    // resurrecting it until the next tick. The caller kicks afterwards instead.
    await attemptLeaveCircle(CIRCLE, ME);
    expect(kick).not.toHaveBeenCalled();
  });

  it('counts rows rather than attempts', async () => {
    // Three queued writes against two goals is two things outstanding. The
    // person is being told how much of their work is at risk, not how many
    // times the queue has tried.
    pending.mockReturnValue([entry('task:a'), entry('task:a'), entry('task:b')]);
    await expect(attemptLeaveCircle(CIRCLE, ME)).resolves.toMatchObject({ unsent: 2 });
  });

  it('reports a refused or failed delete rather than claiming it worked', async () => {
    leave.mockRejectedValue(new Error('nope'));
    await expect(attemptLeaveCircle(CIRCLE, ME)).resolves.toEqual({ ok: false, reason: 'failed' });
  });

  it('treats an already-gone membership as success', async () => {
    // Left on another device. The row is in the state the caller wanted, and an
    // error here would strand the circle in a list it no longer belongs to.
    leave.mockResolvedValue(undefined);
    await expect(attemptLeaveCircle(CIRCLE, ME)).resolves.toEqual({ ok: true });
  });

  it('names the loss in the refusal, in both numbers', () => {
    expect(leaveUnsentLine(1)).toContain('One thing hasn’t');
    expect(leaveUnsentLine(3)).toContain('3 things haven’t');
    // The specific thing at risk, not the generic "it'd be lost otherwise".
    expect(leaveUnsentLine(1)).toContain('anything you staked in here would be lost');
  });
});
