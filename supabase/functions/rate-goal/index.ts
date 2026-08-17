/**
 * Price one goal, and refuse to price a harmful one.
 *
 *   POST { title, cat } -> { verdict, points, reason }
 *
 * Runs with `verify_jwt` on, which is the default and is load-bearing: without
 * it an anonymous caller could spend a shared model's time from anywhere.
 *
 * Three things stand between a model and the number on the button:
 *
 *   1. The cache. Goals repeat — across a person's own week, across everybody
 *      who copies a line off the Global feed, and across every keystroke pause
 *      that lands on a title someone already typed. A hit costs one indexed
 *      lookup and no model call at all.
 *   2. `clampPoints`. The model proposes; this decides. Nothing it returns
 *      reaches a task row unrounded or out of band.
 *   3. The per-user daily cap. One model serves every account, so one client
 *      stuck in a debounce loop is one client holding up everybody's queue.
 *      Over the cap is not an error — it is a fallback price and a quiet log,
 *      because a rate limit is our problem and not the user's.
 *
 * Every failure path returns 200 with a usable price. The composer treats a
 * missing rating and a returned one identically, so the only thing a bad day
 * for the model costs is a goal priced the way it was priced before any of
 * this existed.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { clampPoints, isCategory } from '../_shared/points.ts';
import { RUBRIC, SCREENING, complete } from '../_shared/llm.ts';
import { cacheable, screeningVerdict } from '../_shared/verdict.mjs';

/** Matches the composer: 8 is short enough to be nothing, 50 is the feed's ceiling. */
const TITLE_MIN = 8;
const TITLE_MAX = 50;

/** Calls per user per UTC day. Well above honest use, well below what one box serves. */
const DAILY_CAP = 200;

/**
 * Two questions, two calls, run together.
 *
 * They were one call to begin with. A small model asked to price a goal and
 * judge its safety in a single schema fills the verdict field from whatever is
 * nearest in its context rather than from the goal — a 3B blocked "Finish
 * module 3 of the SQL course" as "a clearly illegal act", which is a phrase
 * that appeared in the prompt and nowhere else. Split, with neither prompt
 * mentioning the other's job, the same model answers both correctly.
 *
 * Run in parallel, so two calls cost one call's latency.
 */
const PRICE_SCHEMA = {
  type: 'object',
  properties: { points: { type: 'integer' } },
  required: ['points'],
} as const;

const SCREEN_SCHEMA = {
  type: 'object',
  properties: { harmful: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['harmful', 'reason'],
} as const;

type Rating = { verdict: 'ok' | 'blocked'; points: number; reason: string };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  let title: string;
  let cat: string;
  try {
    const body = await req.json();
    title = String(body?.title ?? '').trim();
    cat = String(body?.cat ?? '');
  } catch {
    return json({ error: 'expected a JSON body' }, 400);
  }

  if (!isCategory(cat)) return json({ error: 'unknown category' }, 400);
  // Rejected before the model, not after: a two-word fragment mid-typing is the
  // single most common thing this endpoint is asked to price, and it is never
  // worth a call.
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) {
    return json({ error: 'title out of range' }, 400);
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Who is asking. The platform has already verified the token; this reads the
  // subject out of it so the cap has something to count against.
  //
  // The token is passed to `getUser` explicitly rather than through the
  // client's `global.headers`. With no argument, `getUser()` looks for a stored
  // session — which an edge function, having never signed anyone in, does not
  // have — and every request comes back unauthenticated no matter what header
  // it carried.
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '');
  const { data: auth } = await db.auth.getUser(token);
  const userId = auth?.user?.id;
  if (!userId) return json({ error: 'not signed in' }, 401);

  const hash = await sha256(`${title.toLowerCase()}|${cat}`);

  const { data: cached } = await db
    .from('goal_ratings')
    .select('points, verdict, reason')
    .eq('title_hash', hash)
    .maybeSingle();
  if (cached) {
    return json({ verdict: cached.verdict, points: cached.points, reason: cached.reason ?? '' });
  }

  if (await overCap(db, userId)) {
    console.warn(`rate-goal: ${userId} over the daily cap of ${DAILY_CAP}`);
    return json(fallback(cat));
  }

  const [priced, screened] = await Promise.all([
    complete<{ points: number }>({
      system: RUBRIC,
      user: `Category: ${cat}\nGoal: ${title}`,
      schema: PRICE_SCHEMA,
    }),
    complete<{ harmful: boolean; reason: string }>({
      system: SCREENING,
      user: title,
      schema: SCREEN_SCHEMA,
    }),
  ]);

  // A screening call that did not come back is not a block; one the model
  // *declined* is. `verdict.mjs` holds that distinction, and holds it in a file
  // the unit suite can import — the two cases resolve opposite ways and neither
  // is reachable from a test that can only talk to this handler over HTTP.
  const { verdict, reason } = screeningVerdict(screened);

  // A blocked goal has no price — it cannot be staked — but the field still
  // carries a real number so a client that ignores the verdict cannot end up
  // rendering a zero or a NaN on the button.
  const points = clampPoints(priced.status === 'ok' ? priced.value.points : undefined, cat);

  // Answer with whatever came back, but only remember a *complete* answer.
  //
  // Either half can fail on its own, and a half-answer is still perfectly
  // usable for this one request — an unpriced goal falls back to its category,
  // an unscreened one is treated as ok. What it must not do is get written to
  // the cache, because the cache is permanent: one timed-out pricing call would
  // otherwise freeze that goal at its category price for every user who ever
  // types it, long after the model came back.
  if (!cacheable(priced, screened)) return json({ verdict, points, reason });

  // Best-effort. A failed write costs the caller nothing — it has its rating
  // already, and the next request simply asks again.
  await db
    .from('goal_ratings')
    .upsert({ title_hash: hash, title, category: cat, points, verdict, reason });

  return json({ verdict, points, reason });
});

/** The price this goal had before any model existed. */
function fallback(cat: string): Rating {
  return { verdict: 'ok', points: clampPoints(undefined, cat), reason: '' };
}

async function sha256(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Counts first, then decides. An upsert-and-read keeps this to one round trip
 * and makes the row appear on a user's first call of the day.
 */
async function overCap(
  // deno-lint-ignore no-explicit-any
  db: any,
  userId: string,
): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  const { data, error } = await db.rpc('bump_llm_usage', { u: userId, d: day });
  if (error) {
    // A broken counter must not become a broken composer. Let the call through
    // and rely on the free tier's own limit as the backstop.
    console.warn(`rate-goal: usage counter failed — ${error.message}`);
    return false;
  }
  return (data ?? 0) > DAILY_CAP;
}
