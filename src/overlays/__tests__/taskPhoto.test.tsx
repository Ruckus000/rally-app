/**
 * The chip that puts a photo on a goal, pinned at the thing that was wrong.
 *
 * `remove` told the screen and the upload queue and stopped there. The server
 * kept the row and the object for good — invisible on the device that removed
 * it, and, once anything reads other people's photos, visible to everyone
 * else. Nothing on screen looked wrong, which is why it is asserted here.
 *
 * The second failure fell out of the first. There is no "replace" affordance:
 * the chip offers "add" only when the goal has no photo, so replacing one is
 * remove-then-add. With the removal never reaching the server, the new row met
 * the old one on `unique (task_id)` and was refused for as long as the old one
 * lived — a photo the owner could see on their own phone and nowhere else.
 * The ordering assertion below is what keeps that fixed.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { StoreProvider } from '../../state/store';
import { DetailSheet } from '../DetailSheet';
import { __resetOutboxForTests, pending } from '../../sync/outbox';
import { __resetMediaForTests, pendingMedia } from '../../sync/media';
import type { Task } from '../../data/fixtures';

const ME = '11111111-1111-4111-8111-111111111111';
const TASK = '33333333-3333-4333-8333-333333333333';
const OLD_MEDIA = '44444444-4444-4444-8444-444444444444';
const NEW_MEDIA = '55555555-5555-4555-8555-555555555555';

const mockPick = jest.fn();
const mockForget = jest.fn();
jest.mock('../../lib/photos', () => ({
  pickTaskPhoto: (owner: string, taskId: string) => mockPick(owner, taskId),
  forgetLocalPhoto: (media: unknown) => mockForget(media),
}));

const task = (media?: Task['media']): Task => ({
  id: TASK,
  day: 0,
  title: 'Run 5k',
  cat: 'Fitness',
  pts: 40,
  done: true,
  aud: 'friends',
  pair: [],
  pairKind: null,
  cmts: [],
  source: 'staked',
  media,
});

const mount = async (media?: Task['media']) => {
  render(
    <StoreProvider
      persist={false}
      sync={false}
      restored={{
        account: 'live',
        selfId: ME,
        sheet: { type: 'task', id: TASK },
        myTasks: [task(media)],
      }}
    >
      <DetailSheet bottomInset={0} />
    </StoreProvider>,
  );
  await act(async () => {});
};

const press = async (label: string | RegExp) => {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(label));
  });
};

const ops = () => pending().map((e) => `${e.op}:${String(e.payload.mediaId ?? '')}`);

beforeEach(() => {
  __resetOutboxForTests();
  __resetMediaForTests();
  mockPick.mockReset();
  mockForget.mockReset();
  mockPick.mockResolvedValue({
    ok: true,
    media: {
      id: NEW_MEDIA,
      localUri: 'file:///tmp/new.jpg',
      path: `${ME}/${TASK}/${NEW_MEDIA}.jpg`,
      w: 1600,
      h: 1200,
    },
  });
});

describe('removing a photo', () => {
  it('tells the server, not just the screen', async () => {
    await mount({ id: OLD_MEDIA, localUri: 'file:///tmp/old.jpg', path: `${ME}/${TASK}/${OLD_MEDIA}.jpg`, w: 1, h: 1 });

    await press(/Remove the photo/);

    // The whole bug in one line: without this the row and the object stay on
    // the server for ever, and nothing anywhere says so.
    expect(ops()).toEqual([`media.detach:${OLD_MEDIA}`]);
  });

  it('takes it off the upload queue as well', async () => {
    await mount();
    await press(/Add a photo/);
    expect(pendingMedia()).toHaveLength(1);

    await press(/Remove the photo/);

    expect(pendingMedia()).toHaveLength(0);
  });

  it('says nothing to the server about a photo that never reached it', async () => {
    // Picked and removed before the lane ever drained. The attach had not been
    // enqueued, the object was never uploaded, and the detach that *is* sent
    // is a delete of nothing — which is what lets the caller send one without
    // first working out how far the photo got.
    await mount();
    await press(/Add a photo/);
    await press(/Remove the photo/);

    expect(ops()).toEqual([`media.detach:${NEW_MEDIA}`]);
  });
});

describe('replacing a photo', () => {
  it('removes the old row before writing the new one', async () => {
    await mount({ id: OLD_MEDIA, localUri: 'file:///tmp/old.jpg', path: `${ME}/${TASK}/${OLD_MEDIA}.jpg`, w: 1, h: 1 });

    await press(/Remove the photo/);
    await press(/Add a photo/);

    // The outbox is serial, so enqueue order is send order. The old row is
    // gone before the new one is inserted — which is the only way both can
    // exist under `unique (task_id)`.
    expect(ops()).toEqual([`media.detach:${OLD_MEDIA}`]);
    expect(pendingMedia().map((e) => e.id)).toEqual([NEW_MEDIA]);
  });

  it('drops the old local file rather than leaving it in the sandbox', async () => {
    const old = { id: OLD_MEDIA, localUri: 'file:///tmp/old.jpg', path: `${ME}/${TASK}/${OLD_MEDIA}.jpg`, w: 1, h: 1 };
    await mount(old);

    await press(/Remove the photo/);

    expect(mockForget).toHaveBeenCalledWith(expect.objectContaining({ id: OLD_MEDIA }));
  });
});
