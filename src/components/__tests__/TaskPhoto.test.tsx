/**
 * The one renderer, and the guards the copy it replaced was missing.
 *
 * There used to be two: `TaskPhoto` in the sheet and a hand-rolled `<Image>` on
 * the feed card. They did not agree, and the one on the feed — the one more
 * people look at — was the one without the guards. So these are the tests that
 * say why there is only one now.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

import { TaskPhoto } from '../TaskPhoto';
import type { TaskMedia } from '../../data/fixtures';

const photo = (over: Partial<TaskMedia> = {}): TaskMedia => ({
  id: 'm1',
  path: 'owner/task/m1.jpg',
  w: 1600,
  h: 1200,
  ...over,
});

const shown = () => screen.queryByLabelText('Photo on this goal');
/** expo-image normalises `source` to an array, however it was handed one. */
const sourceOf = () => {
  const raw = shown()?.props.source;
  return Array.isArray(raw) ? raw[0] : raw;
};
const styleOf = () => {
  const flat = shown()?.props.style;
  return Array.isArray(flat) ? Object.assign({}, ...flat) : flat;
};

it('draws the local file when this device has one', () => {
  // Free, already decoded, and there before any round trip — which is what
  // makes a photo appear the instant it is picked.
  render(<TaskPhoto media={photo({ localUri: 'file:///tmp/a.jpg', url: 'https://x/1' })} />);
  expect(sourceOf().uri).toBe('file:///tmp/a.jpg');
});

it('draws the signed url when it does not — which is every friend’s photo', () => {
  render(<TaskPhoto media={photo({ url: 'https://x/1' })} />);
  expect(sourceOf().uri).toBe('https://x/1');
});

it('renders nothing at all when neither source is there', () => {
  // Not a placeholder and not a grey rectangle. A goal with no photo and a goal
  // whose photo could not be signed this cycle look the same, deliberately: the
  // next pull tries again, and a coloured box in the meantime is
  // indistinguishable from a slow load. The card this replaced drew the box.
  render(<TaskPhoto media={photo()} />);
  expect(shown()).toBeNull();
});

it('falls back to the url when the local file has gone', () => {
  // `localUri` is an absolute path under the app's data container, and iOS
  // reassigns that id on some updates — so a live photo can have a dead local
  // path and a working signed url sitting right beside it.
  render(<TaskPhoto media={photo({ localUri: 'file:///gone.jpg', url: 'https://x/1' })} />);
  expect(sourceOf().uri).toBe('file:///gone.jpg');

  act(() => {
    screen.UNSAFE_getByProps({ recyclingKey: 'm1' }).props.onError();
  });

  expect(sourceOf().uri).toBe('https://x/1');
});

it('survives a zero height rather than taking the screen', () => {
  // The bug in the copy: `w / h || 4 / 3` is `Infinity` when `h` is 0, because
  // only `NaN` is falsy enough to reach the default. An infinite aspect ratio
  // is a card with no bottom.
  render(<TaskPhoto media={photo({ h: 0, url: 'https://x/1' })} />);
  expect(styleOf().aspectRatio).toBe(4 / 3);
});

it('floors a very tall photo so it cannot push everything off screen', () => {
  render(<TaskPhoto media={photo({ w: 100, h: 900, url: 'https://x/1' })} />);
  expect(styleOf().aspectRatio).toBe(3 / 4);
});

it('keys the byte cache on the photo, never the url', () => {
  // Signed urls are re-minted as they age. Keyed on one, expo-image would treat
  // every re-signing as a new image and re-download the whole feed.
  //
  // This asserted `recyclingKey` for as long as it has existed, which is a
  // different prop — it resets a recycled view, and says nothing about bytes.
  // The name was right and the assertion was not, so the disk cache could never
  // hit and the test that existed to notice reported success.
  render(<TaskPhoto media={photo({ url: 'https://x/1' })} />);
  expect(sourceOf().cacheKey).toBe('m1');
});

it('keeps the byte cache key when the url is re-signed', () => {
  // The whole point, stated as the thing that changes: a second render with a
  // fresh signed url is the same image to the cache.
  const { rerender } = render(<TaskPhoto media={photo({ url: 'https://x/1?sig=a' })} />);
  expect(sourceOf()).toEqual({ uri: 'https://x/1?sig=a', cacheKey: 'm1' });

  rerender(<TaskPhoto media={photo({ url: 'https://x/1?sig=b' })} />);
  expect(sourceOf()).toEqual({ uri: 'https://x/1?sig=b', cacheKey: 'm1' });
});

it('can say whose photo it is', () => {
  render(<TaskPhoto media={photo({ url: 'https://x/1' })} label="Photo on Maya’s goal" />);
  expect(screen.getByLabelText('Photo on Maya’s goal')).toBeTruthy();
});
