/**
 * A friend's photo, from `pull_world` to the feed.
 *
 * Every failure on this path is silent. A photo that never appears looks
 * exactly like a goal nobody photographed, and the guards that swallow one are
 * the same guards that stop the feed re-rendering on a timer — so each is
 * asserted here rather than trusted.
 *
 * The one worth reading twice is "on a goal that has not otherwise moved". That
 * is not an edge case, it is *every* photo: the row syncs when the goal is
 * staked, and the picture arrives minutes later when the screener says so. Any
 * change-detection that omits media is therefore wrong in the common case and
 * right in every case a test would think to construct.
 *
 * What is deliberately not here: whether a `pending` photo, a blocked person's
 * photo, or a `private` goal's photo is visible at all. That is
 * `task_media_select`'s answer, this file's Supabase double has no RLS, and
 * asserting it here would pass for the wrong reason. It lives in
 * `integration/rls/task_media.test.ts`.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fakeSupabase } from '../../__mocks__/@supabase/supabase-js';
import { liveWeek } from '../../data/week';
import { StoreProvider, useStore } from '../../state/store';
import { mondayOf } from '../mappers';
import { __resetOutboxForTests, pending } from '../outbox';
import { __resetMediaForTests } from '../media';
import { __resetSessionForTests, currentUserId } from '../session';
import { __resetSupabaseForTests, getSupabase } from '../../lib/supabase';
import { resetMediaUrls } from '../../lib/mediaUrl';
import type { Action, State } from '../../state/store';

const OTHER = '22222222-2222-4222-8222-222222222222';
const CIRCLE = '33333333-3333-4333-8333-333333333333';
const THEIR_TASK = '44444444-4444-4444-8444-444444444444';
const MEDIA = '55555555-5555-4555-8555-555555555555';

let seen: State;
let dispatch: React.Dispatch<Action>;
function Probe() {
  const store = useStore();
  // Both captured in the effect: assigning a module variable during render is
  // what the compiler rules forbid, and an effect is the sanctioned seam.
  React.useEffect(() => {
    seen = store.state;
    dispatch = store.dispatch;
  });
  return null;
}

/** What replying on a moment's sheet actually does, in three dispatches. */
const dispatchTo = (taskId: string, body: string) => {
  dispatch({ type: 'OPEN_SHEET', sheet: { type: 'task', id: taskId } });
  dispatch({ type: 'SET_NOTE', value: body });
  dispatch({ type: 'SEND_NOTE' });
  dispatch({ type: 'CLOSE_SHEET' });
};

const mount = () =>
  render(
    <StoreProvider persist sync restored={{ account: 'live' }}>
      <Probe />
    </StoreProvider>,
  );

const settle = async (ms = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

const weekOnScreen = () => mondayOf(liveWeek());

const theirPhoto = () => seen.moments.find((m) => m.id === THEIR_TASK)?.media;

/** A circle-mate with one goal this week. No photo on it yet. */
const aFriendStakes = (me: string) =>
  fakeSupabase.seed({
    profiles: [{ id: OTHER, handle: 'maya', name: 'Maya' }],
    circles: [
      { id: CIRCLE, name: 'The Basement', invite_code: 'basement-0123456789abcdef', created_by: me },
    ],
    circle_members: [
      { circle_id: CIRCLE, profile_id: me },
      { circle_id: CIRCLE, profile_id: OTHER },
    ],
    tasks: [
      {
        id: THEIR_TASK,
        owner_id: OTHER,
        week_start: weekOnScreen(),
        day: 1,
        title: 'Ran the loop',
        category: 'Fitness',
        points: 20,
        aud: 'friends',
        source: 'staked',
        done_at: new Date().toISOString(),
      },
    ],
  });

const theyAttachAPhoto = () =>
  fakeSupabase.seed({
    task_media: [
      {
        id: MEDIA,
        task_id: THEIR_TASK,
        owner_id: OTHER,
        path: `${OTHER}/${THEIR_TASK}/${MEDIA}.jpg`,
        width: 1600,
        height: 1200,
        state: 'ready',
      },
    ],
  });

const upsertCount = () =>
  fakeSupabase.calls.filter((c) => c.table === 'tasks' && c.method === 'upsert').length;

const attachToMyGoal = (me: string, taskId: string, mediaId: string) =>
  fakeSupabase.seed({
    task_media: [
      {
        id: mediaId,
        task_id: taskId,
        owner_id: me,
        path: `${me}/${taskId}/${mediaId}.jpg`,
        width: 1200,
        height: 1600,
        state: 'ready',
      },
    ],
  });

const realEnv = { ...process.env };

beforeEach(async () => {
  jest.useFakeTimers();
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  await AsyncStorage.clear();
  fakeSupabase.reset();
  __resetSupabaseForTests();
  __resetSessionForTests();
  __resetOutboxForTests();
  __resetMediaForTests();
  resetMediaUrls();
});

afterEach(() => {
  jest.useRealTimers();
  process.env = { ...realEnv };
});

it('puts a friend’s photo on the feed, with a signed url', async () => {
  mount();
  await settle();
  const me = currentUserId()!;
  aFriendStakes(me);
  theyAttachAPhoto();

  await settle(61_000);

  const media = theirPhoto();
  expect(media?.id).toBe(MEDIA);
  // A private bucket, so the row's `path` is not something an `<Image>` can
  // load. Without the url the card renders nothing at all.
  expect(media?.url).toEqual(expect.stringContaining('http'));
  // And never the other device's file, which does not exist on this one.
  expect(media?.localUri).toBeUndefined();
});

it('delivers a photo attached to a goal that has not otherwise moved', async () => {
  // The whole feature, and the case every "did anything change?" test gets
  // wrong: the goal synced when it was staked, and the photo turns up later.
  mount();
  await settle();
  aFriendStakes(currentUserId()!);

  await settle(61_000);
  expect(theirPhoto()).toBeUndefined();

  theyAttachAPhoto();
  await settle(61_000);

  expect(theirPhoto()?.id).toBe(MEDIA);
});

it('takes the photo away again when they remove it', async () => {
  mount();
  await settle();
  aFriendStakes(currentUserId()!);
  theyAttachAPhoto();
  await settle(61_000);
  expect(theirPhoto()).toBeDefined();

  // `media.detach` deletes the row; the pull stops mentioning it. There is no
  // other signal, which is why an empty answer has to be authoritative.
  await act(async () => {
    await getSupabase().from('task_media').delete().eq('id', MEDIA);
  });
  await settle(61_000);

  expect(theirPhoto()).toBeUndefined();
});

it('delivers a photo onto a moment this device has already replied to', async () => {
  // `carryThreads` returns the *previous* objects when it decides nothing
  // moved, so anything its comparison omits is thrown away. A moment with no
  // local reply survives that by accident — every pull mints a fresh `cmts: []`
  // and the reference differs — so the case that actually tests the comparison
  // is a moment carrying a note this device wrote.
  mount();
  await settle();
  aFriendStakes(currentUserId()!);
  await settle(61_000);

  act(() => {
    dispatchTo(THEIR_TASK, 'Nice one');
  });
  await settle();
  expect(seen.moments.find((m) => m.id === THEIR_TASK)?.cmts?.length).toBe(1);

  theyAttachAPhoto();
  await settle(61_000);

  expect(theirPhoto()?.id).toBe(MEDIA);
  // And the reply is still there — the photo must not cost the thread.
  expect(seen.moments.find((m) => m.id === THEIR_TASK)?.cmts?.length).toBe(1);
});

it('does not answer a photo with a task upsert', async () => {
  // The loop this would otherwise be. A photo merged into a task mints a new
  // task object, `observe` reference-diffs and reads that as a local edit, and
  // the upsert bumps `updated_at` — a realtime event, which makes the other
  // device pull, merge and upsert back. Two phones and one photo at the
  // realtime debounce, for ever.
  mount();
  await settle();
  const me = currentUserId()!;
  aFriendStakes(me);

  // A goal of my own, with a photo the server already knows about.
  const MY_TASK = '66666666-6666-4666-8666-666666666666';
  const MY_MEDIA = '77777777-7777-4777-8777-777777777777';
  fakeSupabase.seed({
    tasks: [
      {
        id: MY_TASK,
        owner_id: me,
        week_start: weekOnScreen(),
        day: 2,
        title: 'Swam',
        category: 'Fitness',
        points: 20,
        aud: 'friends',
        source: 'staked',
      },
    ],
  });

  await settle(61_000);
  // The goal is local now, and has no photo. That matters: from here on
  // `merge.tasks` is not what carries its id, so nothing but the media path
  // can put it in the suppression set.
  expect(seen.myTasks.find((t) => t.id === MY_TASK)).toBeDefined();
  expect(seen.myTasks.find((t) => t.id === MY_TASK)?.media).toBeUndefined();

  const before = upsertCount();
  attachToMyGoal(me, MY_TASK, MY_MEDIA);
  await settle(61_000);

  // The photo arrived — a reinstall, or my other phone.
  expect(seen.myTasks.find((t) => t.id === MY_TASK)?.media?.id).toBe(MY_MEDIA);
  // And nothing was sent back about it. `taskToRow` carries no media, so the
  // upsert would write nothing at all — except `updated_at`, which is a
  // realtime event, which is the whole loop.
  expect(upsertCount()).toBe(before);
  expect(pending().filter((e) => e.op === 'task.upsert')).toHaveLength(0);
});
