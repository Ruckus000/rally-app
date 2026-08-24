/**
 * The order, and what survives it.
 *
 * Sibling of `signOut.test.ts`, and it exists for the mirror-image reason. That
 * sequence refuses when work is unsent, because sign-out leaves the data on the
 * server and losing the last thing you wrote would be a silent theft. This one
 * must *not* refuse — being asked to wait for a write in order to destroy it is
 * absurd — so the property that needs pinning is a different one: nothing local
 * moves until the server has said yes.
 *
 * Get that backwards and the failure is quiet and complete. A schedule that
 * never landed, followed by the wipe, drops somebody at the Welcome screen
 * believing their account is being deleted while it goes on existing, with
 * their week gone from the phone and no way to tell.
 *
 * The other property is an omission: `auth.signOut` is never called. That is
 * the whole of the way back for every anonymous account, which is every Android
 * install — see `endSessionLocally`. It is asserted directly rather than
 * inferred, because nothing about the code makes the omission visible.
 *
 * `jest.spyOn` on the real modules rather than `jest.mock` factories, for the
 * reason `signOut.test.ts` gives: a factory lets the real signatures drift away
 * from what the test pretends they are, and this is a sequence that destroys
 * somebody's history.
 */
import { attemptCancelDeletion, attemptScheduleDeletion, deletionDateLine } from '../deleteAccount';
import * as outbox from '../../../sync/outbox';
import * as media from '../../../sync/media';
import * as session from '../../../sync/session';
import * as transport from '../../../sync/transport';

const AT = '2026-08-24T09:00:00.000Z';

describe('attemptScheduleDeletion', () => {
  let schedule: jest.SpyInstance;
  let clearOutbox: jest.SpyInstance;
  let clearMedia: jest.SpyInstance;
  let endLocally: jest.SpyInstance;
  let signOut: jest.SpyInstance;

  beforeEach(() => {
    schedule = jest.spyOn(transport, 'scheduleAccountDeletion').mockResolvedValue(AT);
    clearOutbox = jest.spyOn(outbox, 'clearOutbox').mockResolvedValue(undefined);
    clearMedia = jest.spyOn(media, 'clearMedia').mockResolvedValue(undefined);
    endLocally = jest.spyOn(session, 'endSessionLocally').mockResolvedValue(undefined);
    signOut = jest.spyOn(session, 'signOutEverywhere').mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('hands back the timestamp the server chose', async () => {
    // Not a local clock. The server owns the fortnight, and the date the way
    // back shows has to be the one the purge will actually act on.
    await expect(attemptScheduleDeletion()).resolves.toEqual({ ok: true, at: AT });
  });

  it('asks the server before it touches anything on the device', async () => {
    const order: string[] = [];
    schedule.mockImplementation(async () => {
      order.push('rpc');
      return AT;
    });
    clearOutbox.mockImplementation(async () => void order.push('outbox'));
    clearMedia.mockImplementation(async () => void order.push('media'));
    endLocally.mockImplementation(async () => void order.push('session'));

    await attemptScheduleDeletion();

    expect(order).toEqual(['rpc', 'outbox', 'media', 'session']);
  });

  it('leaves the phone exactly as it was when the server never answered', async () => {
    // The whole reason the order above is the order. A wipe on a failed
    // schedule is a person told their account is going when it is not.
    schedule.mockRejectedValue(new Error('offline'));

    await expect(attemptScheduleDeletion()).resolves.toEqual({ ok: false });

    expect(clearOutbox).not.toHaveBeenCalled();
    expect(clearMedia).not.toHaveBeenCalled();
    expect(endLocally).not.toHaveBeenCalled();
  });

  it('clears both queues, so nothing drains at an account being deleted', async () => {
    // `clearMedia` has had no caller outside `media.ts` until now. A photo
    // upload that outlived the wipe would be bytes pushed at a dying account.
    await attemptScheduleDeletion();

    expect(clearOutbox).toHaveBeenCalled();
    expect(clearMedia).toHaveBeenCalled();
  });

  it('never revokes the session, which is the entire way back', async () => {
    // Every Android account and every unsecured iPhone account is anonymous:
    // nothing but the stored session holds its uuid. Revoke it and a fortnight
    // of grace is a fortnight nobody can use. This assertion is the only thing
    // standing between that and a one-word change in `deleteAccount.ts`.
    await attemptScheduleDeletion();

    expect(endLocally).toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('does not refuse over unsent work, unlike signing out', async () => {
    // No `pending()` check anywhere in the module. Asserted through the outcome
    // rather than by grep: a queue full of writes still schedules.
    jest.spyOn(outbox, 'pending').mockReturnValue([
      {
        id: 'id-a',
        seq: 1,
        op: 'task.upsert',
        key: 'task:a',
        payload: {},
        at: 0,
        tries: 0,
        nextAt: 0,
      },
    ]);

    await expect(attemptScheduleDeletion()).resolves.toEqual({ ok: true, at: AT });
  });
});

describe('attemptCancelDeletion', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reports success', async () => {
    jest.spyOn(transport, 'cancelAccountDeletion').mockResolvedValue(undefined);
    await expect(attemptCancelDeletion()).resolves.toBe(true);
  });

  it('reports failure rather than throwing, because one caller draws one line', async () => {
    jest.spyOn(transport, 'cancelAccountDeletion').mockRejectedValue(new Error('offline'));
    await expect(attemptCancelDeletion()).resolves.toBe(false);
  });
});

describe('deletionDateLine', () => {
  it('is a fortnight after the server timestamp', () => {
    // Asserted against a date built the same way rather than a literal string,
    // because the format follows the device locale and a hardcoded "7 September"
    // would pass in one CI region and fail in another.
    const expected = new Date(
      new Date(AT).getTime() + 14 * 24 * 60 * 60 * 1000,
    ).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

    expect(deletionDateLine(AT)).toBe(expected);
  });
});
