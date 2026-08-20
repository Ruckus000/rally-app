/**
 * The photo on a goal, wherever it is drawn.
 *
 * One component for three places — your own card, somebody else's card, and the
 * sheet either of them opens — because the two copies that existed before did
 * not agree, and the copy without the guards was the one on the feed.
 *
 * ─── two sources, and why the local one goes first ────────────────────────
 *
 * `localUri` is a file this device holds; `url` is a signed link minted by the
 * pull. The owner of a photo usually has both, a friend only ever has the
 * second, and a device that has just picked one has only the first. Local wins
 * when it is there: it is free, it is already decoded, and it is what makes a
 * photo appear the instant it is chosen rather than after a round trip.
 *
 * ─── falling back is not belt-and-braces ─────────────────────────────────
 *
 * `localUri` is an absolute path under the app's data container, and iOS
 * reassigns that container's id on some updates — so a perfectly good photo can
 * have a dead local path and a working signed URL sitting next to it. Without
 * the fallback that renders as the photo vanishing. `onError` therefore records
 * the *source that failed*, not a boolean, so a freshly signed URL still gets
 * its own attempt.
 *
 * ─── the cache key is the media id, never the URL ─────────────────────────
 *
 * Signed URLs are re-minted as they age. Keyed on the URL, expo-image's disk
 * cache would treat every re-signing as a new image and re-download the whole
 * feed. The id is stable for the life of the photo, which is what a cache key
 * is supposed to be.
 */
import React from 'react';
import { Image } from 'expo-image';

import { radius } from '../theme/tokens';
import { useColors } from '../theme/ThemeProvider';
import type { TaskMedia } from '../data/fixtures';

/**
 * Floors the aspect ratio so a very tall photo cannot push everything below it
 * off the screen. `w && h` rather than a bare division: a zero height is an
 * *infinite* ratio, and `|| 4 / 3` does not catch it — only `NaN` is falsy
 * enough to fall through.
 */
const TALLEST = 3 / 4;

export function TaskPhoto({
  media,
  label = 'Photo on this goal',
  marginTop = 12,
}: {
  media: TaskMedia;
  /** Named so a friend's card can say whose photo it is. */
  label?: string;
  marginTop?: number;
}) {
  const color = useColors();
  const [broken, setBroken] = React.useState<string | null>(null);

  const local = media.localUri && media.localUri !== broken ? media.localUri : null;
  const remote = media.url && media.url !== broken ? media.url : null;
  const source = local ?? remote;

  // Nothing to draw. Not an error state and not a placeholder: a goal with no
  // photo and a goal whose photo could not be signed this cycle look the same,
  // which is right — the next pull tries again, and a grey rectangle in the
  // meantime is indistinguishable from a slow load.
  if (!source) return null;

  const ratio = media.w && media.h ? media.w / media.h : 4 / 3;

  return (
    <Image
      source={{ uri: source }}
      cachePolicy="disk"
      recyclingKey={media.id}
      contentFit="cover"
      accessibilityLabel={label}
      onError={() => setBroken(source)}
      style={{
        width: '100%',
        aspectRatio: Math.max(ratio, TALLEST),
        borderRadius: radius.chip,
        marginTop,
        backgroundColor: color.chip,
      }}
    />
  );
}
