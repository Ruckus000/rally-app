/**
 * Which taps in `state.acted` are actually rows in `reactions`, and which are
 * only ever a local highlight.
 *
 * `acted` is one flat `Record<"<id>:<kind>", true>` written by every screen that
 * has a cheer button, and its ids are heterogeneous by design — a moment id, a
 * fixture post id, a synthetic `${who}${index}`, and the literal `mywin`. Only
 * some of those name a row the server has heard of. Reshaping `acted` so the
 * distinction is carried in the key would touch every screen that reads it and
 * buy nothing the UI needs, so the distinction is derived here instead: a key is
 * syncable when its target is a uuid and its kind is in the enum, and anything
 * else stays on the device forever without further ceremony.
 *
 * That gate is deliberately the strict one. A key that fails it is a tap the
 * user still sees highlighted; a key that wrongly passes it is a permanent
 * `22P02 invalid input syntax for type uuid` that jams the queue behind it.
 *
 * Nothing here decides *when* to send. Toggling is the server's job already —
 * `unique (actor_id, target_type, target_id, kind)` is the cheer toggle, and the
 * table has insert and delete policies and no update — so a reaction is only
 * ever an insert of that tuple or a delete of it, which is exactly what
 * `diffActed` reports.
 */

/** `reactions.kind`. The client's `acted` kinds are a superset — see `parseActedKey`. */
export const REACTION_KINDS = ['cheer', 'in', 'cosign', 'nod', 'share'] as const;

export type ReactionKind = (typeof REACTION_KINDS)[number];

/**
 * One row of `reactions`, minus the parts the client has no business naming.
 *
 * `actor_id` is absent for the same reason `owner_id` is absent from an outbox
 * payload: it is stamped from the session at send time, and a payload that can
 * name its own actor is a payload that can cheer as someone else. `target_type`
 * is absent because it is always `task` — the only other member of that enum is
 * `post`, and the global feed has no backing table for one.
 */
export type ReactionRef = { targetId: string; kind: ReactionKind };

/** What `acted` is, read-only: the reducer only ever writes `true`. */
export type Acted = Readonly<Record<string, boolean>>;

/**
 * Canonical 8-4-4-4-12. Version and variant nibbles are left unchecked on
 * purpose: the ids this gate sees come from `randomUUID` today, but a row minted
 * by the server or by a future build is no less real for being v7.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: string): boolean => UUID.test(v);

const isKind = (v: string): v is ReactionKind => (REACTION_KINDS as readonly string[]).includes(v);

/**
 * `"<id>:<kind>"` → the reaction it stands for, or `null` if it stands for
 * nothing the server can hold.
 *
 * Split on the *last* colon, not the first: the id half is opaque here, and a
 * first-colon split would silently reinterpret any future prefixed id as a kind.
 *
 * Returns `null` for every key shape the app writes today except a reaction on a
 * real task row — see the tests, which are written against the literal keys the
 * dispatch sites produce.
 */
export function parseActedKey(key: string): ReactionRef | null {
  const cut = key.lastIndexOf(':');
  if (cut <= 0 || cut === key.length - 1) return null;

  const targetId = key.slice(0, cut);
  const kind = key.slice(cut + 1);
  if (!isUuid(targetId) || !isKind(kind)) return null;

  // Postgres renders uuids lowercase, so a mixed-case local key and the row it
  // names must not read as two different targets on the way back in.
  return { targetId: targetId.toLowerCase(), kind };
}

/**
 * The reactions that have to reach the server, given `acted` before and after.
 *
 * Presence is truthiness rather than `in`: a `false` restored from disk is not a
 * reaction, and inserting one because the key survived would put a cheer on
 * someone's phone that this device is not showing.
 *
 * Non-syncable keys are dropped from both sides, so a screen full of fixture
 * moments produces an empty diff rather than a queue of doomed inserts.
 */
export function diffActed(prev: Acted, next: Acted): { added: ReactionRef[]; removed: ReactionRef[] } {
  const added: ReactionRef[] = [];
  const removed: ReactionRef[] = [];

  for (const key of Object.keys(next)) {
    if (!next[key] || prev[key]) continue;
    const ref = parseActedKey(key);
    if (ref) added.push(ref);
  }

  for (const key of Object.keys(prev)) {
    if (!prev[key] || next[key]) continue;
    const ref = parseActedKey(key);
    if (ref) removed.push(ref);
  }

  return { added, removed };
}

/**
 * The outbox coalescing key for a reaction.
 *
 * The unique tuple is what makes this correct: two entries sharing this key are
 * the same row, so a cheer taken back before the insert has left the device
 * collapses against it instead of racing it to a server that would then hold a
 * cheer the user cancelled.
 */
export const reactionKey = (ref: ReactionRef): string => `reaction:${ref.targetId}:${ref.kind}`;
