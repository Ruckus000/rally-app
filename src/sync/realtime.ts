/**
 * The push half of the pipe: one channel, and a debounced "ask again".
 *
 * **An event is never applied.** It sets a dirty flag and schedules a refetch,
 * whose rows go through the same `SERVER_MERGE` the poll uses. Three reasons,
 * and each one on its own is enough:
 *
 * - A payload is a single row and arrives in whatever order the socket felt
 *   like. Folding it straight into state would mean a second merge path with
 *   different ordering guarantees from the one `reconcileTasks` was written for.
 * - A DELETE payload is **not** RLS-filtered and carries only the replica
 *   identity columns. It is a rumour that something changed, not data — and
 *   acting on it as data is how a client deletes a row it was never allowed to
 *   see in the first place.
 * - One merge code path is one thing to test. The poll already had to be right.
 *
 * So the socket's whole job is to make the next pull happen in half a second
 * instead of up to a minute. Everything below that is the poll, unchanged, and
 * an app whose socket never opens is a slower app rather than a broken one —
 * which is why `open` swallows.
 */
import { getSupabase } from '../lib/supabase';

/**
 * The three tables in `supabase_realtime`, all with replica identity full.
 * `tasks` is your own week from another device; `reactions` and `notes` are the
 * product's whole thesis — a cheer landing on someone's phone.
 */
const TABLES = ['tasks', 'reactions', 'notes'] as const;

/**
 * A burst is normal: a friend closing their week writes a task and a rollup and
 * the cheers that follow it, and every one of those is the same refetch. Long
 * enough to coalesce a burst, short enough that "instant" is still the word for
 * it. Matches the outbox's own debounce.
 */
const DEBOUNCE_MS = 400;

/** Just the surface this file uses. supabase-js's channel is far wider. */
export type RealtimeChannelLike = {
  on(
    type: 'postgres_changes',
    filter: { event: string; schema: string; table: string },
    callback: (payload: unknown) => void,
  ): RealtimeChannelLike;
  subscribe(callback?: (status: string) => void): unknown;
  unsubscribe(): unknown;
};

export type RealtimeClientLike = {
  channel(topic: string): RealtimeChannelLike;
  removeAllChannels(): unknown;
};

let clientFactory: () => RealtimeClientLike = () =>
  getSupabase() as unknown as RealtimeClientLike;

let channel: RealtimeChannelLike | null = null;
/** What `channel` is subscribed for. A change here is a resubscribe. */
let topicKey: string | null = null;
/** Backgrounded. The socket is closed and must not be reopened until foreground. */
let paused = false;
/**
 * Whether a channel has ever been opened on this client. `removeAllChannels()`
 * would otherwise *construct* a client to tear down nothing — which in a demo
 * account is precisely the thing that must never happen.
 */
let opened = false;

let refetch: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

function fire(): void {
  timer = null;
  if (!dirty) return;
  dirty = false;
  refetch?.();
}

/** Something changed. What, and to which row, is deliberately not asked. */
function touch(): void {
  dirty = true;
  // Leading edge deliberately not taken: the write that produced this event may
  // still be inside its own transaction as far as a read replica is concerned,
  // and a refetch that races it just returns the old rows.
  if (!timer) timer = setTimeout(fire, DEBOUNCE_MS);
}

function close(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  dirty = false;
  const open = channel;
  channel = null;
  topicKey = null;
  if (!open) return;
  try {
    open.unsubscribe();
  } catch {
    // A socket that is already gone is the state we were asking for.
  }
}

/**
 * Subscribe for `key`, or make sure nothing is subscribed when there isn't one.
 *
 * Called on every pull tick and every kick rather than once at start: the
 * session arrives long after the engine does, and this is the only place that
 * has to notice. Idempotent — the same key twice is a no-op, which is what
 * makes calling it on a timer free.
 *
 * `key` is one channel per circle. Until circles are real the signed-in user is
 * that scope: RLS already decides which rows reach this socket, so the key's job
 * is to name what the channel is *for*, so that scope changing tears the old one
 * down instead of leaving it listening for somebody else.
 */
export function syncRealtime(key: string | null, onChange: () => void): void {
  refetch = onChange;

  if (paused || !key) {
    close();
    return;
  }
  if (channel && topicKey === key) return;

  close();
  try {
    const ch = clientFactory().channel(`rally:circle:${key}`);
    for (const table of TABLES) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, touch);
    }
    ch.subscribe();
    channel = ch;
    topicKey = key;
    opened = true;
  } catch {
    // No socket — blocked by a network, or a client that cannot open one. The
    // poll is still running and is still the thing that merges, so this is a
    // minute of latency rather than a failure. The next tick tries again.
    close();
  }
}

/** Backgrounded. Joins the store's existing AppState listener. */
export function pauseRealtime(): void {
  paused = true;
  close();
}

/** Foregrounded. The resubscribe itself is the next `syncRealtime`, via `kick`. */
export function resumeRealtime(): void {
  paused = false;
}

/** The engine stopping: unmount, or sync being switched off. */
export function stopRealtime(): void {
  close();
  refetch = null;
}

/**
 * Sign-out, or RESET. Unlike `stop`, this drops channels this module may not
 * know about — a resubscribe that raced a teardown, or anything a future caller
 * opened — because the account they were opened for no longer exists.
 */
export function teardownRealtime(): void {
  close();
  refetch = null;
  paused = false;
  if (!opened) return;
  opened = false;
  try {
    clientFactory().removeAllChannels();
  } catch {
    // Same as close(): failing to tear down a socket that is already gone is
    // not news, and this runs on the path where the user is switching accounts.
  }
}

/** What is subscribed, for tests and for a debug screen. */
export function realtimeTopicKey(): string | null {
  return topicKey;
}

/** Test seam. Pass null to go back to the real client. */
export function __setRealtimeClientForTests(factory: (() => RealtimeClientLike) | null): void {
  clientFactory = factory ?? (() => getSupabase() as unknown as RealtimeClientLike);
}

export function __resetRealtimeForTests(): void {
  close();
  refetch = null;
  paused = false;
  opened = false;
}
