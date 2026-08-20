/**
 * What happens on this device when the screener says no.
 *
 * By the time the lane hears `refused`, the server has already deleted the
 * object and the row — see `screen-task-media`. Everything left is local, and
 * all three parts of it matter:
 *
 *   - the card must stop showing a picture that now exists nowhere else,
 *   - the file must leave the sandbox rather than sitting there forever,
 *   - and the person must be told, or a photo they watched attach simply
 *     vanishes and they are left wondering whether they imagined it.
 *
 * Pinned at the engine seam because that is where the three are wired
 * together. `media.test.ts` already proves the lane *reports* a refusal; this
 * proves somebody acts on it, and that nothing acts on anything else.
 */
import { createEngine } from '../engine';
import {
  __resetMediaForTests,
  drainMedia,
  enqueueMedia,
  type MediaTransport,
  type ScreenOutcome,
} from '../media';
import { __resetOutboxForTests } from '../outbox';
import type { Action } from '../../state/store';
import { IMAGE_BLOCKED_COPY } from '../../../supabase/functions/_shared/imageVerdict.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const TASK = '22222222-2222-4222-8222-222222222222';
const MEDIA = '33333333-3333-4333-8333-333333333333';
const LOCAL = 'file:///tmp/photo.jpg';

const realEnv = { ...process.env };

beforeEach(() => {
  __resetMediaForTests();
  __resetOutboxForTests();
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

afterEach(() => {
  process.env = { ...realEnv };
});

/**
 * The engine is built but never started: the subscription is made in
 * `createEngine`, and starting it would open timers and a socket this file has
 * no use for. The lane is a module, so a drain driven from here reaches the
 * same listener the real one would.
 */
const engineWatching = (forgotten: string[], dispatched: Action[]) =>
  createEngine((a: Action) => dispatched.push(a), {
    transport: {} as never,
    forgetPhoto: (uri) => forgotten.push(uri),
  });

const laneAnswering = (verdict: ScreenOutcome): MediaTransport => ({
  ownerId: () => OWNER,
  upload: async () => ({ ok: true }),
  screen: async () => verdict,
});

const attachOne = () =>
  enqueueMedia({
    id: MEDIA,
    taskId: TASK,
    localUri: LOCAL,
    path: `${OWNER}/${TASK}/${MEDIA}.jpg`,
    width: 1600,
    height: 1200,
  });

it('takes the photo off the task, off the disk, and says so', async () => {
  const forgotten: string[] = [];
  const dispatched: Action[] = [];
  const engine = engineWatching(forgotten, dispatched);

  const lane = laneAnswering({ state: 'refused' });
  attachOne();
  await drainMedia(lane);
  await drainMedia(lane, Date.now() + 10_000);

  // Keyed by the task, because that is what the card is keyed by — a media id
  // would find nothing in `myTasks`.
  expect(dispatched).toContainEqual({ type: 'REMOVE_MEDIA', id: TASK });
  expect(forgotten).toEqual([LOCAL]);

  // The line that does not name what the model objected to, for the reason
  // argued where it is defined.
  expect(dispatched).toContainEqual({ type: 'TOAST', message: IMAGE_BLOCKED_COPY });

  engine.stop();
});

it('does none of that for a photo that passed', async () => {
  const forgotten: string[] = [];
  const dispatched: Action[] = [];
  const engine = engineWatching(forgotten, dispatched);

  const lane = laneAnswering({ state: 'ready' });
  attachOne();
  await drainMedia(lane);
  await drainMedia(lane, Date.now() + 10_000);

  // The local file is what the owner's own card draws from, so a `ready`
  // verdict must leave it exactly where it is.
  expect(forgotten).toEqual([]);
  expect(dispatched).toEqual([]);

  engine.stop();
});

it('stops listening once the engine does', async () => {
  // The lane is a module and the engine is not. A subscription outliving its
  // engine would dispatch into a store it no longer speaks for — and after a
  // sign-out, into one belonging to somebody else.
  const forgotten: string[] = [];
  const dispatched: Action[] = [];
  const engine = engineWatching(forgotten, dispatched);
  engine.stop();

  const lane = laneAnswering({ state: 'refused' });
  attachOne();
  await drainMedia(lane);
  await drainMedia(lane, Date.now() + 10_000);

  expect(dispatched).toEqual([]);
  expect(forgotten).toEqual([]);
});
