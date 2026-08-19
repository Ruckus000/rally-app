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
  pendingMedia,
  type MediaEntry,
  type MediaTransport,
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

/** Records what it was asked to upload and answers however the test says. */
const uploader = (answers: Awaited<ReturnType<MediaTransport['upload']>>[] = []) => {
  const seen: string[] = [];
  const transport: MediaTransport = {
    ownerId: () => OWNER,
    async upload(entry) {
      seen.push(entry.id);
      return answers.shift() ?? { ok: true };
    },
  };
  return { transport, seen };
};

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

    expect(pendingMedia()).toHaveLength(0);
    expect(attachOps()).toHaveLength(1);
    expect(attachOps()[0]!.payload).toMatchObject({
      mediaId: 'media-1',
      taskId: 'task-1',
      width: 1600,
      height: 1200,
    });
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
    const transport: MediaTransport = {
      ownerId: () => OWNER,
      upload: async () => {
        throw new Error('socket hang up');
      },
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
    const transport: MediaTransport = { ownerId: () => null, upload: async () => ({ ok: true }) };

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
    const other: MediaTransport = {
      ownerId: () => '22222222-2222-4222-8222-222222222222',
      upload: async () => ({ ok: true }),
    };
    await drainMedia(other);

    expect(pendingMedia()).toEqual([]);
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
