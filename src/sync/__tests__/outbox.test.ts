/**
 * The outbox is the part of the sync layer where the interesting bugs live, so
 * these tests are mostly about the server saying no: transiently, permanently,
 * and in the one case (a duplicate key) where no actually means yes.
 *
 * No fake timers anywhere in this file. `drain()` is called explicitly and
 * takes its own `now`, which is the whole reason the scheduling lives in a
 * different module.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __resetOutboxForTests,
  deadLetters,
  drain,
  enqueue,
  flushOutbox,
  hydrateOutbox,
  OutboxEntry,
  OutboxOp,
  pending,
  QueueTransport,
  type SendOutcome,
} from '../outbox';

const OWNER = '11111111-1111-4111-8111-111111111111';
const MINUTE = 60_000;

type Call = { op: OutboxOp; payload: Record<string, unknown> };

/**
 * Reports whatever `answer` hands back. Note what these tests no longer say:
 * nothing here mentions a SQLSTATE. Deciding that 42501 is permanent and 23505
 * is really a success belongs to the transport, which is where the wire is —
 * and it is tested there. What the queue owes is the behaviour that follows
 * from a verdict, so a verdict is what it is handed.
 */
function makeTransport(
  answer: (call: Call, n: number) => SendOutcome | null = () => null,
) {
  const calls: Call[] = [];
  let owner: string | null = OWNER;

  const transport: QueueTransport = {
    ownerId: () => owner,
    async send(op, payload) {
      const call = { op, payload };
      calls.push(call);
      return answer(call, calls.length) ?? { ok: true };
    },
  };

  return {
    transport,
    calls,
    titles: () => calls.map((c) => c.payload.title),
    setOwner(v: string | null) {
      owner = v;
    },
  };
}

/** A dead network: worth another go. */
const offline = (): SendOutcome => ({
  ok: false,
  permanent: false,
  error: 'Network request failed',
});
/** A refusal no future attempt can change. */
const refused = (error: string): SendOutcome => ({ ok: false, permanent: true, error });

const task = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  week_start: '2026-08-10',
  day: 2,
  title: id,
  category: 'move',
  points: 3,
  ...over,
});

const stake = (id: string, over: Record<string, unknown> = {}) =>
  enqueue('task.upsert', `task:${id}`, task(id, over));

const seqs = () => pending().map((e) => e.seq);
const keys = () => pending().map((e) => e.key);

beforeEach(async () => {
  __resetOutboxForTests();
  await AsyncStorage.clear();
});

afterEach(() => {
  __resetOutboxForTests();
});

describe('offline is the normal case, not an error', () => {
  it('queues without sending when there is no session yet', async () => {
    const t = makeTransport();
    t.setOwner(null);

    stake('a');
    stake('b');

    // Ten tasks staked on a plane by an install that has never signed in.
    expect(await drain(t.transport)).toEqual({ sent: 0, failed: 0, dead: 0 });
    expect(t.calls).toHaveLength(0);
    expect(pending()).toHaveLength(2);
  });

  it('keeps everything when the network is gone, then replays it in order', async () => {
    const down = makeTransport(() => offline());
    stake('a');
    stake('b');
    stake('c');

    expect(await drain(down.transport)).toEqual({ sent: 0, failed: 1, dead: 0 });
    // Head-of-line: one attempt, not three against a network that is not there.
    expect(down.calls).toHaveLength(1);
    expect(keys()).toEqual(['task:a', 'task:b', 'task:c']);

    const up = makeTransport();
    expect(await drain(up.transport, Date.now() + MINUTE)).toEqual({
      sent: 3,
      failed: 0,
      dead: 0,
    });
    expect(up.titles()).toEqual(['a', 'b', 'c']);
    expect(pending()).toEqual([]);
  });

  it('never touches the transport for an empty queue', async () => {
    const t = makeTransport();
    expect(await drain(t.transport)).toEqual({ sent: 0, failed: 0, dead: 0 });
    // Not even to ask who we are — the scheduler calls this every few seconds.
    expect(t.calls).toHaveLength(0);
  });
});

describe('ordering', () => {
  it('sends a create before the update that depends on it', async () => {
    const t = makeTransport();
    stake('a');
    enqueue('task.upsert', 'task:b', task('b', { title: 'b', pair_of: 'a' }));
    enqueue('task.upsert', 'task:a', task('a', { title: 'a done', done_at: 'now' }));

    await drain(t.transport);

    // The third enqueue coalesced into the first, which kept its seq — so the
    // row still lands before anything that was staked after it.
    expect(t.titles()).toEqual(['a done', 'b']);
  });

  it('leaves a transiently failed entry at the head, with the rest behind it', async () => {
    const t = makeTransport((call) => (call.payload.title === 'b' ? offline() : null));
    stake('a');
    stake('b');
    stake('c');

    expect(await drain(t.transport)).toEqual({ sent: 1, failed: 1, dead: 0 });
    expect(t.titles()).toEqual(['a', 'b']);

    const [head, next] = pending();
    expect(head.key).toBe('task:b');
    expect(head.tries).toBe(1);
    expect(head.lastError).toBe('Network request failed');
    expect(next.key).toBe('task:c');
    expect(head.seq).toBeLessThan(next.seq);
  });

  it('holds a failed entry back until its backoff has elapsed', async () => {
    const t = makeTransport((_c, n) => (n === 1 ? offline() : null));
    stake('a');

    const now = Date.now();
    await drain(t.transport, now);
    expect(t.calls).toHaveLength(1);

    // 1s ±20%, so 900ms is inside the window on any RNG draw.
    await drain(t.transport, now + 900);
    expect(t.calls).toHaveLength(1);

    await drain(t.transport, now + MINUTE);
    expect(t.calls).toHaveLength(2);
    expect(pending()).toEqual([]);
  });

  it('leaves the remainder queued when a drain stops part-way', async () => {
    const t = makeTransport((_c, n) => (n === 2 ? offline() : null));
    stake('a');
    stake('b');
    stake('c');

    expect(await drain(t.transport)).toEqual({ sent: 1, failed: 1, dead: 0 });
    expect(keys()).toEqual(['task:b', 'task:c']);
  });
});

describe('what the server refuses', () => {
  it('drops an entry the server will never accept, and records it dead', async () => {
    const t = makeTransport((call) => (call.payload.title === 'b' ? refused('RLS') : null));
    stake('a');
    stake('b');
    stake('c');

    expect(await drain(t.transport)).toEqual({ sent: 2, failed: 0, dead: 1 });
    // Unblocked the head rather than retrying a policy that will refuse forever.
    expect(t.titles()).toEqual(['a', 'b', 'c']);
    expect(pending()).toEqual([]);

    const [gone] = deadLetters();
    expect(gone.key).toBe('task:b');
    expect(gone.lastError).toBe('RLS');
  });

  it('never rolls the reducer back — a dead entry is silent divergence, not a delete', async () => {
    const t = makeTransport(() => refused('tasks_day_check'));
    stake('a');

    await drain(t.transport);

    // Nothing here reaches back into state. The only trace is the dead list.
    expect(deadLetters().map((e) => e.key)).toEqual(['task:a']);
    expect(pending()).toEqual([]);
  });

  it('treats a duplicate key as success, because every op here is idempotent', async () => {
    const t = makeTransport(() => ({ ok: true }));
    stake('a');

    // A cheer sent twice is a cheer that landed. Retrying would be a loop
    // against a server that already agrees with us.
    expect(await drain(t.transport)).toEqual({ sent: 1, failed: 0, dead: 0 });
    expect(pending()).toEqual([]);
    expect(deadLetters()).toEqual([]);
  });

  // Which SQLSTATEs and HTTP statuses are permanent is the transport's
  // judgement and is tested there — see transport.test.ts, "gives up on an RLS
  // refusal", "retries a 401 once", and the rest. Asserting it again here
  // would be a second copy of a decision that must only have one.
});

describe('single flight', () => {
  it('does not send twice when drained twice concurrently', async () => {
    const t = makeTransport();
    stake('a');

    const [first, second] = await Promise.all([drain(t.transport), drain(t.transport)]);

    expect(t.calls).toHaveLength(1);
    expect(first).toEqual({ sent: 1, failed: 0, dead: 0 });
    expect(second).toBe(first);
  });

  it('does not send twice when drained twice in a row', async () => {
    const t = makeTransport();
    stake('a');

    await drain(t.transport);
    expect(await drain(t.transport)).toEqual({ sent: 0, failed: 0, dead: 0 });
    expect(t.calls).toHaveLength(1);
  });
});

describe('coalescing', () => {
  it('collapses two toggles of the same task into one call', async () => {
    const t = makeTransport();
    stake('a', { done_at: null });
    stake('a', { done_at: '2026-08-11T09:00:00.000Z' });
    stake('a', { done_at: null });

    expect(pending()).toHaveLength(1);
    await drain(t.transport);

    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].payload.done_at).toBeNull();
  });

  it('keeps the original seq, and refreshes the last-write-wins stamp', async () => {
    stake('a');
    stake('b');
    const [firstSeq] = seqs();
    const before = pending()[0].at;

    await new Promise((r) => setTimeout(r, 2));
    stake('a', { title: 'edited' });

    const [head] = pending();
    expect(seqs()).toEqual([firstSeq, firstSeq + 1]);
    expect(head.payload.title).toBe('edited');
    expect(head.at).toBeGreaterThan(before);
  });

  it('does not coalesce into an entry that is already on the wire', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const calls: Call[] = [];
    const transport: QueueTransport = {
      ownerId: () => OWNER,
      async send(op, payload) {
        calls.push({ op, payload });
        if (calls.length === 1) await gate;
        return { ok: true };
      },
    };

    stake('a', { title: 'first' });
    const run = drain(transport);
    await Promise.resolve();

    // The server may already have this one; a silent overwrite here would be a
    // mutation the user made that nobody ever sends.
    stake('a', { title: 'second' });
    release();
    await run;
    await drain(transport, Date.now() + MINUTE);

    // Two entries, both sent. Had the second folded into the first it would
    // have overwritten a payload that was already on the wire, and the edit
    // would never have been sent at all.
    expect(calls.map((c) => c.payload.title)).toEqual(['first', 'second']);
    expect(pending()).toEqual([]);
  });

  it('drops a delete and its upsert when the row never left the device', async () => {
    const t = makeTransport();
    stake('a');
    enqueue('task.delete', 'task:a', { id: 'a' });

    // Staked and unstaked before any network: there is nothing to tell anyone.
    expect(pending()).toEqual([]);
    await drain(t.transport);
    expect(t.calls).toHaveLength(0);
  });

  it('still sends the delete once the row has been acked', async () => {
    const t = makeTransport();
    stake('a');
    await drain(t.transport);

    stake('a', { title: 'edited' });
    enqueue('task.delete', 'task:a', { id: 'a' });

    // The pending edit is pointless, but the server holds the row and has to
    // be told it is gone.
    expect(pending().map((e) => e.op)).toEqual(['task.delete']);
    await drain(t.transport, Date.now() + MINUTE);
    expect(t.calls.map((c) => c.op)).toEqual(['task.upsert', 'task.delete']);
  });

  it('sends a delete for a row whose upsert is in flight', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const calls: Call[] = [];
    const transport: QueueTransport = {
      ownerId: () => OWNER,
      async send(op, payload) {
        calls.push({ op, payload });
        if (calls.length === 1) await gate;
        return { ok: true };
      },
    };

    stake('a');
    const run = drain(transport);
    await Promise.resolve();
    enqueue('task.delete', 'task:a', { id: 'a' });
    release();
    await run;

    await drain(transport, Date.now() + MINUTE);

    // The server was learning about this row at the moment it was deleted, so
    // the delete has to follow it rather than be optimised away.
    expect(calls.map((c) => c.op)).toEqual(['task.upsert', 'task.delete']);
    expect(pending()).toEqual([]);
  });
});

describe('identity', () => {
  it('holds no owner_id until send time', async () => {
    const t = makeTransport();
    stake('a');

    expect(pending()[0].payload).not.toHaveProperty('owner_id');

    await drain(t.transport);
    expect(t.calls[0].payload.owner_id).toBe(OWNER);
  });

  it('stamps whichever session is live when the entry finally goes', async () => {
    const t = makeTransport();
    t.setOwner(null);
    stake('a');
    await drain(t.transport);

    t.setOwner('22222222-2222-4222-8222-222222222222');
    await drain(t.transport);

    expect(t.calls[0].payload.owner_id).toBe('22222222-2222-4222-8222-222222222222');
  });
});

describe('on disk', () => {
  it('lives under its own key, not inside the state payload', async () => {
    stake('a');
    await flushOutbox();

    expect(await AsyncStorage.getItem('rally:state:v1')).toBeNull();
    const raw = await AsyncStorage.getItem('rally:outbox:v1');
    expect(JSON.parse(raw as string)).toMatchObject({ version: 1 });
  });

  it('comes back after a relaunch, in order', async () => {
    stake('a');
    stake('b');
    await flushOutbox();

    __resetOutboxForTests();
    expect(pending()).toEqual([]);

    await hydrateOutbox();
    expect(keys()).toEqual(['task:a', 'task:b']);

    const t = makeTransport();
    await drain(t.transport);
    expect(t.titles()).toEqual(['a', 'b']);
  });

  it('puts restored work in front of anything staked during the read', async () => {
    stake('a');
    await flushOutbox();
    __resetOutboxForTests();

    stake('b'); // typed before hydration resolved
    await hydrateOutbox();

    expect(keys()).toEqual(['task:a', 'task:b']);
    const [restored, live] = pending();
    expect(restored.seq).toBeLessThan(live.seq);
  });

  it('discards a corrupt entry without eating the good ones', async () => {
    stake('a');
    stake('b');
    await flushOutbox();

    const raw = JSON.parse((await AsyncStorage.getItem('rally:outbox:v1')) as string);
    raw.entries[0] = { id: 'broken' };
    await AsyncStorage.setItem('rally:outbox:v1', JSON.stringify(raw));

    __resetOutboxForTests();
    await hydrateOutbox();

    // The state payload discards wholesale; five saved mutations are not worth
    // losing over one bad row.
    expect(keys()).toEqual(['task:b']);
  });

  it('starts clean on garbage rather than throwing on launch', async () => {
    await AsyncStorage.setItem('rally:outbox:v1', '{ not json');
    await hydrateOutbox();
    expect(pending()).toEqual([]);
  });

  it('persists what a drain changed', async () => {
    const t = makeTransport((_c, n) => (n === 1 ? offline() : null));
    stake('a');
    await drain(t.transport);
    await flushOutbox();

    __resetOutboxForTests();
    await hydrateOutbox();

    const [head] = pending() as OutboxEntry[];
    expect(head.tries).toBe(1);
    expect(head.lastError).toBe('Network request failed');
  });
});
