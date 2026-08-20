/**
 * The photo lane, and the one ordering it exists to guarantee.
 *
 * Two claims are worth more than everything else here. A `task_media` row is
 * a promise that an object exists at that path, read by everyone who can see
 * the task — so **nothing is recorded until the upload has landed**, or a
 * friend gets a broken image. And the lane must **block nothing**: it exists
 * precisely because the outbox is strictly ordered, and a 300 KB upload at the
 * head of that queue would hold up every cheer behind it.
 */
import {
  __resetMediaForTests,
  clearMedia,
  deadMedia,
  drainMedia,
  dropMediaFor,
  enqueueMedia,
  onMediaBlocked,
  pendingMedia,
  type MediaEntry,
  type MediaTransport,
  type ScreenOutcome,
} from '../media';
import { __resetOutboxForTests, pending } from '../outbox';
import { supabaseTransport } from '../transport';
import { fakeSupabase } from '../../__mocks__/@supabase/supabase-js';

const OWNER = '11111111-1111-4111-8111-111111111111';

const photo = (over: Partial<MediaEntry> = {}) => ({
  id: over.id ?? 'media-1',
  taskId: over.taskId ?? 'task-1',
  localUri: 'file:///tmp/photo.jpg',
  path: `${OWNER}/${over.taskId ?? 'task-1'}/${over.id ?? 'media-1'}.jpg`,
  width: 1600,
  height: 1200,
  ...over,
});

/**
 * Records what it was asked to do and answers however the test says.
 *
 * Both halves default to success, so a test that only cares about uploading
 * says nothing about screening and vice versa.
 */
const uploader = (
  answers: Awaited<ReturnType<MediaTransport['upload']>>[] = [],
  verdicts: ScreenOutcome[] = [],
) => {
  const seen: string[] = [];
  const screened: string[] = [];
  const transport: MediaTransport = {
    ownerId: () => OWNER,
    async upload(entry) {
      seen.push(entry.id);
      return answers.shift() ?? { ok: true };
    },
    async screen(entry) {
      screened.push(entry.id);
      return verdicts.shift() ?? { state: 'ready' };
    },
  };
  return { transport, seen, screened };
};

/**
 * Far enough ahead that an entry which has just landed its bytes is due for
 * its verdict. `SCREEN_AFTER_MS` is 2.5s; this clears it without pretending to
 * know the exact number.
 */
const afterScreenDelay = (from: number = Date.now()) => from + 10_000;

const realEnv = { ...process.env };

beforeEach(() => {
  __resetMediaForTests();
  __resetOutboxForTests();
  // Jest never loads .env, and `getSupabase()` refuses to build a client
  // without these — the transport half of this file would fail on config
  // rather than on anything it is trying to assert.
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

afterEach(() => {
  process.env = { ...realEnv };
});

const attachOps = () => pending().filter((e) => e.op === 'media.attach');

describe('upload first, record second', () => {
  it('writes no row until the file is in the bucket', async () => {
    enqueueMedia(photo());
    // Queued, and the outbox knows nothing about it yet.
    expect(pendingMedia()).toHaveLength(1);
    expect(attachOps()).toHaveLength(0);

    const { transport } = uploader();
    await drainMedia(transport);

    expect(attachOps()).toHaveLength(1);
    expect(attachOps()[0]!.payload).toMatchObject({
      mediaId: 'media-1',
      taskId: 'task-1',
      width: 1600,
      height: 1200,
    });
    // Still in the lane, on the other half of the journey: the bytes are in
    // the bucket and no one but the owner may read them until a model has
    // looked.
    expect(pendingMedia().map((e) => e.phase)).toEqual(['screen']);
  });

  it('records nothing when the upload fails, and keeps the photo', async () => {
    enqueueMedia(photo());
    const { transport } = uploader([{ ok: false, permanent: false, error: 'offline' }]);

    await drainMedia(transport);

    // Still ours to send. A row now would point at nothing.
    expect(pendingMedia()).toHaveLength(1);
    expect(attachOps()).toHaveLength(0);
  });

  it('retires a photo the server will never take, and says so', async () => {
    enqueueMedia(photo());
    const { transport } = uploader([{ ok: false, permanent: true, error: '413 too large' }]);

    await drainMedia(transport);

    expect(pendingMedia()).toHaveLength(0);
    expect(attachOps()).toHaveLength(0);
    expect(deadMedia()).toHaveLength(1);
    expect(deadMedia()[0]!.lastError).toContain('413');
  });

  it('treats a thrown uploader as retryable rather than losing the photo', async () => {
    enqueueMedia(photo());
    const { transport } = uploader();
    transport.upload = async () => {
      throw new Error('socket hang up');
    };

    await drainMedia(transport);

    expect(pendingMedia()).toHaveLength(1);
    expect(deadMedia()).toHaveLength(0);
  });
});

describe('the lane holds nothing up', () => {
  it('moves a failed photo behind the others instead of stranding them', async () => {
    // The outbox blocks on purpose — order is its point. This must not.
    enqueueMedia(photo({ id: 'media-1', taskId: 'task-1' }));
    enqueueMedia(photo({ id: 'media-2', taskId: 'task-2' }));

    const { transport, seen } = uploader([{ ok: false, permanent: false, error: 'offline' }]);
    await drainMedia(transport);
    expect(seen).toEqual(['media-1']);

    // Next pass reaches the second photo rather than retrying the first
    // forever behind a backoff it has not earned.
    const later = Date.now() + 60_000;
    await drainMedia(transport, later);
    expect(seen).toEqual(['media-1', 'media-2', 'media-1']);
  });

  it('does not send anything before there is somebody to send it as', async () => {
    enqueueMedia(photo());
    const { transport } = uploader();
    transport.ownerId = () => null;

    await drainMedia(transport);

    // The plane case: the photo waits for a session rather than being lost.
    expect(pendingMedia()).toHaveLength(1);
  });
});

describe('one photo per task', () => {
  it('replaces a photo that has not left the device', async () => {
    enqueueMedia(photo({ id: 'media-1' }));
    enqueueMedia(photo({ id: 'media-2' }));

    // `unique (task_id)` means the second row could never land beside the
    // first — so the second *photo* replaces it here rather than uploading a
    // file whose row is refused forever.
    expect(pendingMedia().map((e) => e.id)).toEqual(['media-2']);
  });

  it('keeps a photo for a different task', () => {
    enqueueMedia(photo({ id: 'media-1', taskId: 'task-1' }));
    enqueueMedia(photo({ id: 'media-2', taskId: 'task-2' }));
    expect(pendingMedia()).toHaveLength(2);
  });
});

describe('when the task goes', () => {
  it('drops a photo nothing will ever point at', () => {
    enqueueMedia(photo({ taskId: 'task-1' }));
    enqueueMedia(photo({ id: 'media-2', taskId: 'task-2' }));

    dropMediaFor('task-1');

    expect(pendingMedia().map((e) => e.taskId)).toEqual(['task-2']);
  });
});

describe('when the account does', () => {
  it('forgets every photo, so none is uploaded as somebody else', async () => {
    enqueueMedia(photo());
    await clearMedia();
    expect(pendingMedia()).toEqual([]);
  });

  it('throws the queue away rather than uploading it under a new owner', async () => {
    enqueueMedia(photo());
    // First drain claims the queue for OWNER.
    await drainMedia(uploader().transport);

    enqueueMedia(photo({ id: 'media-9', taskId: 'task-9' }));
    const { transport: other } = uploader();
    other.ownerId = () => '22222222-2222-4222-8222-222222222222';
    await drainMedia(other);

    expect(pendingMedia()).toEqual([]);
  });
});

/**
 * The gate, from this side of it.
 *
 * The server's half — that an unscreened photo is unreadable to everybody but
 * its owner — is a policy, and belongs in `integration/rls/`. What is provable
 * here is the client's half, and the claim worth defending is narrow: **only
 * the word `refused` destroys anything.** Everything else the screener can
 * say, including nothing at all, has to leave the photo alone.
 */
describe('the screening gate', () => {
  it('asks for a verdict once the bytes have landed', async () => {
    enqueueMedia(photo());
    const { transport, screened } = uploader();

    await drainMedia(transport);
    // Not in the same pass: the row is written by the outbox, which drains on
    // its own schedule, so asking immediately would reach the server first.
    expect(screened).toEqual([]);

    await drainMedia(transport, afterScreenDelay());
    expect(screened).toEqual(['media-1']);
    // Cleared the gate, and the lane is done with it.
    expect(pendingMedia()).toHaveLength(0);
  });

  it('takes a refused photo off this device and says which one', async () => {
    const blocked: MediaEntry[] = [];
    onMediaBlocked((e) => blocked.push(e));

    enqueueMedia(photo());
    const { transport } = uploader([], [{ state: 'refused' }]);

    await drainMedia(transport);
    await drainMedia(transport, afterScreenDelay());

    expect(pendingMedia()).toHaveLength(0);
    // The task id, because that is what the card is keyed by, and the local
    // uri, because somebody has to delete the file.
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ taskId: 'task-1', localUri: 'file:///tmp/photo.jpg' });
  });

  it('keeps the photo when the screener has not answered yet', async () => {
    const blocked: MediaEntry[] = [];
    onMediaBlocked((e) => blocked.push(e));

    enqueueMedia(photo());
    // `waiting` on the wire: the row is not there yet, which is ordinary.
    const { transport } = uploader([], [{ state: 'retry', error: 'waiting' }]);

    await drainMedia(transport);
    await drainMedia(transport, afterScreenDelay());

    // Nothing destroyed, and it will be asked again.
    expect(blocked).toEqual([]);
    expect(pendingMedia().map((e) => e.phase)).toEqual(['screen']);
  });

  it('treats a thrown screener as a retry rather than a refusal', async () => {
    const blocked: MediaEntry[] = [];
    onMediaBlocked((e) => blocked.push(e));

    enqueueMedia(photo());
    const { transport } = uploader();
    transport.screen = async () => {
      throw new Error('socket hang up');
    };

    await drainMedia(transport);
    await drainMedia(transport, afterScreenDelay());

    expect(blocked).toEqual([]);
    expect(pendingMedia()).toHaveLength(1);
  });

  it('starts the screening backoff fresh after a hard-won upload', async () => {
    enqueueMedia(photo());
    // Three failures, then it lands. Were `tries` carried over, the first
    // screening attempt would sit behind an eight-second backoff it did
    // nothing to earn.
    const { transport } = uploader([
      { ok: false, permanent: false, error: 'offline' },
      { ok: false, permanent: false, error: 'offline' },
      { ok: false, permanent: false, error: 'offline' },
    ]);

    const t0 = Date.now();
    await drainMedia(transport, t0);
    await drainMedia(transport, t0 + 60_000);
    await drainMedia(transport, t0 + 120_000);
    await drainMedia(transport, t0 + 180_000);

    const [entry] = pendingMedia();
    expect(entry!.phase).toBe('screen');
    expect(entry!.tries).toBe(0);
  });

  it('stops asking a question that will never have a different answer', async () => {
    // `waiting` forever is what a dead-lettered `media.attach` looks like from
    // here: the row is never written, so the screener has nothing to judge.
    // Left unbounded this is one edge-function call a minute, for good.
    const blocked: MediaEntry[] = [];
    onMediaBlocked((e) => blocked.push(e));

    enqueueMedia(photo());
    const { transport } = uploader();
    transport.screen = async () => ({ state: 'retry', error: 'waiting' });

    let t = Date.now();
    for (let i = 0; i < 40; i += 1) {
      t += 120_000;
      await drainMedia(transport, t);
    }

    expect(pendingMedia()).toHaveLength(0);
    expect(deadMedia()).toHaveLength(1);
    // Given up on, not judged — nothing gets deleted off the device for a
    // question the server never answered.
    expect(blocked).toEqual([]);
  });

  it('screens one photo while another is still uploading', async () => {
    // The lane's whole point, restated for the second phase: a photo waiting
    // on a model must not hold up a photo waiting on a radio.
    enqueueMedia(photo({ id: 'media-1', taskId: 'task-1' }));
    const { transport, seen, screened } = uploader();

    await drainMedia(transport);
    enqueueMedia(photo({ id: 'media-2', taskId: 'task-2' }));

    await drainMedia(transport, afterScreenDelay());

    expect(seen).toEqual(['media-1', 'media-2']);
    expect(screened).toContain('media-1');
  });
});

describe('the row the upload earns', () => {
  const TASK = '33333333-3333-4333-8333-333333333333';
  const MEDIA = '44444444-4444-4444-8444-444444444444';

  it('reaches task_media through the ordinary outbox', async () => {
    // The lane hands off to the queue that already knows about ordering,
    // identity stamping and retries. This proves the handoff lands as a row
    // rather than stopping at a well-formed payload.
    fakeSupabase.reset();
    fakeSupabase.seed({
      profiles: [{ id: OWNER, handle: 'you', name: 'You' }],
      tasks: [
        {
          id: TASK,
          owner_id: OWNER,
          week_start: '2026-08-17',
          day: 0,
          title: 'Run 5k',
          category: 'Fitness',
          points: 40,
        },
      ],
    });

    enqueueMedia(photo({ id: MEDIA, taskId: TASK }));
    await drainMedia(uploader().transport);

    const [op] = attachOps();
    expect(op).toBeDefined();

    const wire = supabaseTransport();
    const result = await wire.push(
      {
        id: op!.id,
        at: op!.at,
        op: 'media.attach',
        mediaId: String(op!.payload.mediaId),
        taskId: String(op!.payload.taskId),
        path: String(op!.payload.path),
        width: Number(op!.payload.width),
        height: Number(op!.payload.height),
      },
      OWNER,
    );

    expect(result.ok).toBe(true);
    const rows = fakeSupabase.rows('task_media');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ task_id: TASK, owner_id: OWNER, width: 1600, height: 1200 });
  });

  it('absorbs a replay rather than attaching the same photo twice', async () => {
    // The pk is client-minted precisely so a second delivery collides with
    // itself. `unique (task_id)` would refuse it anyway — this asserts the
    // client does not have to find that out the hard way.
    fakeSupabase.reset();
    fakeSupabase.seed({
      profiles: [{ id: OWNER, handle: 'you', name: 'You' }],
      tasks: [
        { id: TASK, owner_id: OWNER, week_start: '2026-08-17', day: 0, title: 'Run 5k', category: 'Fitness', points: 40 },
      ],
    });

    const wire = supabaseTransport();
    const entry = {
      id: 'outbox-1',
      at: Date.now(),
      op: 'media.attach' as const,
      mediaId: MEDIA,
      taskId: TASK,
      path: `${OWNER}/${TASK}/${MEDIA}.jpg`,
      width: 1600,
      height: 1200,
    };

    expect((await wire.push(entry, OWNER)).ok).toBe(true);
    expect((await wire.push(entry, OWNER)).ok).toBe(true);
    expect(fakeSupabase.rows('task_media')).toHaveLength(1);
  });
});
