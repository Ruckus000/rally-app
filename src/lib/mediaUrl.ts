/**
 * Turning goal-photo object names into URLs an `<Image>` can load, and deciding
 * how long each answer is good for.
 *
 * `avatarUrl.ts`'s sibling, and the three decisions in its header are this
 * file's too: a signed URL is a bearer token, an hour is the trade between a
 * leaked link's useful life and a phone on a train re-asking, and none of it is
 * ever written to disk. Read that file first; this one only writes down where a
 * goal photo differs from a face.
 *
 * ─── batched, because a pull carries a feed's worth ───────────────────────
 *
 * An avatar is one object asked for by one component, so `avatarUrl` signs per
 * path from a hook. Goal photos arrive as a *set* — one pull hands over every
 * photo on every goal it can see — and signing them one at a time would be a
 * round trip per card. `signMedia` already batches (`transport.ts`); what this
 * adds is the cache in front of it, so a batch only ever asks for the paths it
 * does not already hold.
 *
 * Which is why there is no hook here. The URL is resolved once, in the engine,
 * and travels on `TaskMedia.url` to a renderer that stays dumb.
 *
 * ─── why an hour matters more here than it does for avatars ───────────────
 *
 * `signMedia` was written with a seven-day default, and seven days would have
 * been wrong twice over. `moments` and `globalPosts` are persisted, so a URL
 * put on a `Moment` reaches AsyncStorage — a week-long bearer token sitting in
 * a file on the device. And a goal photo can be *taken back*: `media.detach`
 * removes the row and the object, but a URL already minted goes on resolving
 * until it expires. An hour bounds both. The persisted half is stripped on the
 * way to disk regardless (see `persistence.ts`), because a URL restored from a
 * previous launch is a URL that renders nothing.
 *
 * ─── the cache is what makes the change-detection work ────────────────────
 *
 * Not only an optimisation. `sameMoments` and `carryThreads` decide whether a
 * pull changed anything, and both compare the URL. Without a cache every pull
 * mints new URLs, every card reads as changed, and the whole feed re-renders on
 * a timer — which is the exact thing those guards exist to prevent. With it, a
 * photo's URL is one stable string for fifty-five minutes, so "the URL moved"
 * genuinely means "this needs re-rendering".
 */
import { signMedia } from '../sync/transport';

/** How long Storage is asked to sign for. See the header, and `avatarUrl.ts`. */
export const MEDIA_URL_TTL_SECONDS = 3600;

/**
 * How long before expiry a cached URL stops being handed out. Long enough that
 * an image request started on the last handout still finishes inside the window
 * it was signed for.
 */
const REFRESH_MARGIN_MS = 5 * 60_000;

type Signed = { url: string; goodUntil: number };

const cache = new Map<string, Signed>();
/** One request per path, however many pulls overlap asking for it. */
const inflight = new Map<string, Promise<string | null>>();

/**
 * A cached URL still worth handing out, or null. Never asks the network and
 * never mutates: a stale entry is simply not an answer, and the next signing
 * overwrites it rather than a sweep removing it.
 */
export function cachedMediaUrl(path: string): string | null {
  const held = cache.get(path);
  if (!held || held.goodUntil <= Date.now()) return null;
  return held.url;
}

/**
 * URLs for these objects: cached where possible, one batched signing for the
 * rest.
 *
 * Never throws and never rejects. A path that cannot be signed is simply
 * absent from the answer, which the caller renders as a goal with no photo —
 * the same shape `signMedia` already chose, for the same reason: a pull that
 * cannot sign is a pull with no pictures in it, not a failed pull.
 */
export async function signMediaUrls(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const misses: string[] = [];
  const waiting: Promise<void>[] = [];

  for (const path of new Set(paths)) {
    const held = cachedMediaUrl(path);
    if (held) {
      out[path] = held;
      continue;
    }
    // Another pull is already signing this one. Join it rather than asking
    // again — two overlapping pulls of the same feed is the ordinary case, not
    // the rare one, because realtime kicks a pull on every change.
    const already = inflight.get(path);
    if (already) {
      waiting.push(
        already.then((url) => {
          if (url) out[path] = url;
        }),
      );
      continue;
    }
    misses.push(path);
  }

  if (misses.length > 0) {
    const batch = signMedia(misses, MEDIA_URL_TTL_SECONDS).then((signed) => {
      const goodUntil = Date.now() + MEDIA_URL_TTL_SECONDS * 1000 - REFRESH_MARGIN_MS;
      for (const path of misses) {
        const url = signed[path];
        if (url) cache.set(path, { url, goodUntil });
      }
      return signed;
    });

    for (const path of misses) {
      const mine = batch.then((signed) => signed[path] ?? null);
      inflight.set(path, mine);
      waiting.push(
        mine
          .then((url) => {
            if (url) out[path] = url;
          })
          .finally(() => {
            // Only if it is still ours: a later batch may have replaced it.
            if (inflight.get(path) === mine) inflight.delete(path);
          }),
      );
    }
  }

  // `signMedia` swallows its own failures, so this settles rather than
  // rejecting — but a thrown transport (offline, no config) must not take the
  // pull down with it either.
  await Promise.allSettled(waiting);
  return out;
}

/**
 * Forget every signed URL. Called on sign-out beside `resetAvatarUrls`: these
 * are bearer tokens for photos the next account has no business holding links
 * to.
 */
export function resetMediaUrls(): void {
  cache.clear();
  inflight.clear();
}
