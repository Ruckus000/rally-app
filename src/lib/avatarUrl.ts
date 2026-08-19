/**
 * Turning an avatar path into something an `<Image>` can actually load, and
 * deciding how long that answer is good for.
 *
 * The bucket is private, so `profiles.avatar_path` is an object name and not a
 * URL: nothing renders until Storage has signed one. This module is the only
 * place that asks, holds the answers in memory, and hands out `null` for every
 * case that is not a live, screened photo — because `null` is what makes the
 * caller draw initials, which is the designed default rather than an error
 * state (`HANDOFF.md`: *avatars are generated initials on tinted circles*).
 *
 * ─── the three decisions, written down ────────────────────────────────────
 *
 * **TTL: one hour.** A signed URL is a bearer token for one object, so the
 * number is a trade between how long a leaked link stays useful and how often
 * a phone on a train has to ask again. An hour is comfortably longer than the
 * time anyone spends in a session of this app — so in practice a face is
 * signed once per launch, not once per screen — and short enough that a URL
 * pasted into a chat is dead by the time anybody clicks it. Minutes would mean
 * re-signing every face on every scroll for no security anybody can name; a
 * day would mean the link outliving the photo, since replacing an avatar
 * writes a *new* object name and leaves the old URL resolving until it expires.
 *
 * **Refresh: on demand, from the cache, with a five-minute margin.** There is
 * no timer and no background sweep. `useAvatarUrl` asks for a path, the cache
 * answers if it holds one that is still comfortably fresh, and otherwise one
 * request is made and shared by every avatar of that person on screen. The
 * margin exists so a URL handed out at 59 minutes is not one an `<Image>` is
 * still fetching when it expires.
 *
 * **Expiry: initials, never a broken image.** Three ways a URL can be no good,
 * all landing in the same place. It can be too old to hand out — the cache
 * drops it and mints another. Signing can fail (offline, or a path whose
 * object is gone) — that answers `null`, and `null` is initials. And it can
 * expire *after* the `<Image>` has it, which is the one this module cannot
 * see: that surfaces as `onError`, and `Avatar` treats a failed load as no URL
 * at all. There is no state in which a torn-image glyph is reachable.
 *
 * ─── not persisted, deliberately ──────────────────────────────────────────
 *
 * The cache is module state and dies with the process. A signed URL written to
 * disk is a URL that is dead on the next launch — it would restore, render
 * nothing, and take a whole render pass to discover that. The durable half is
 * the path, which lives on `Person` and is worth persisting precisely because
 * it does not expire.
 */
import React from 'react';

import { getSupabase, hasSupabaseConfig } from './supabase';
import type { AvatarState } from '../data/people';

const BUCKET = 'avatars';

/** How long Storage is asked to sign for. See the header for why an hour. */
export const AVATAR_URL_TTL_SECONDS = 3600;

/**
 * How long before expiry a cached URL stops being handed out. Long enough that
 * a slow image request started on the last handout still finishes inside the
 * window it was signed for.
 */
const REFRESH_MARGIN_MS = 5 * 60_000;

type Signed = { url: string; goodUntil: number };

const cache = new Map<string, Signed>();
/** One request per path, however many avatars of that person are on screen. */
const inflight = new Map<string, Promise<string | null>>();

/**
 * A cached URL that is still worth handing out, or null. Never asks the
 * network, and — because a component reads it while rendering — never mutates
 * anything either: a stale entry is simply not an answer, and is overwritten
 * by the next signing rather than swept.
 */
export function cachedAvatarUrl(path: string): string | null {
  const held = cache.get(path);
  if (!held || held.goodUntil <= Date.now()) return null;
  return held.url;
}

/**
 * A URL for this object, from the cache or from Storage. Never throws, and
 * answers `null` for every failure — an unsigned photo is initials.
 */
export async function signAvatarUrl(path: string): Promise<string | null> {
  const held = cachedAvatarUrl(path);
  if (held) return held;
  const already = inflight.get(path);
  if (already) return already;

  const request = (async (): Promise<string | null> => {
    try {
      // Demo builds make zero network calls, and `getSupabase()` throws rather
      // than handing back a client pointed at nothing.
      if (!hasSupabaseConfig()) return null;
      const { data, error } = await getSupabase()
        .storage.from(BUCKET)
        .createSignedUrl(path, AVATAR_URL_TTL_SECONDS);
      const url = data?.signedUrl;
      if (error || !url) return null;
      cache.set(path, {
        url,
        goodUntil: Date.now() + AVATAR_URL_TTL_SECONDS * 1000 - REFRESH_MARGIN_MS,
      });
      return url;
    } catch {
      return null;
    } finally {
      inflight.delete(path);
    }
  })();

  inflight.set(path, request);
  return request;
}

/**
 * Forget every signed URL. Called on sign-out: they are bearer tokens for
 * objects the next account has no business holding links to.
 */
export function resetAvatarUrls(): void {
  cache.clear();
  inflight.clear();
}

/**
 * The hook every avatar uses: a URL when there is a screened photo behind it,
 * and `null` — meaning initials — in every other case.
 *
 * `pending` answers `null` without asking Storage for anything, which is the
 * security half of this module rather than an optimisation. See `Avatar`.
 */
export function useAvatarUrl(
  path: string | null | undefined,
  state: AvatarState | undefined,
): string | null {
  const signable = state === 'ready' && path ? path : null;
  // Not the URL itself, which is read straight from the cache below: holding it
  // in state as well would mean two answers to the same question and a render
  // where a face that is already signed still blinks through its initials. This
  // is only "something finished, look again".
  const [, signings] = React.useReducer((n: number) => n + 1, 0);
  const url = signable ? cachedAvatarUrl(signable) : null;

  React.useEffect(() => {
    // Nothing to sign, or the cache already answered. The `url` dependency is
    // what turns a completed signing into exactly one more pass through here,
    // which then does nothing.
    if (!signable || url) return;
    let alive = true;
    void signAvatarUrl(signable).then((answer) => {
      // A failure asks again only when something else changes — a new path, a
      // remount. Retrying on a timer would be a loop nobody is watching, for a
      // picture the screen is perfectly happy to draw as initials.
      if (alive && answer) signings();
    });
    return () => {
      alive = false;
    };
  }, [signable, url]);

  return url;
}
