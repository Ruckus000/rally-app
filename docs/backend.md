# Backend design

> **The schema exists; the app does not use it.** The migration has been
> applied to the Rally project (`zproxpxkxduzgxmzpeqa`, free plan, ca-central-1)
> and verified — see *Status* below. But there is still no client code, no
> `@supabase/supabase-js` dependency and no network call anywhere in the app.
> Everything below the *Status* section is design, not working software.

The app is complete and entirely local. This describes what a server would look
like and, more importantly, how to add one **without losing what makes the app
feel good** — every tap lands instantly and it works with no network.

## Status

Applied 2026-08-10 with `supabase db push`, then checked:

| Check | Result |
|---|---|
| Tables in `public` | 10 |
| Tables with RLS enabled | 10 |
| Policies | 23 |
| Enums | 5 |
| `private` helpers | 4, none executable by `anon` or `authenticated` |
| `supabase db advisors --type all` | no security finding against this schema |

Probed from the `anon` role with the publishable key: `select` on `tasks`
returns `[]`, `insert` is refused with `42501 new row violates row-level
security policy`, and `private.can_see_task` is not reachable over REST.

Two advisor WARNs exist but belong to `public.rls_auto_enable()`, a Supabase
platform event trigger that auto-enables RLS on new tables. It returns
`event_trigger`, so calling it over REST fails with *"cannot display a value of
type event_trigger"* before it can do anything. Not ours, and not exploitable.

The performance INFOs are all `unused_index` and `unindexed_foreign_keys` on an
empty database — meaningless until there is traffic, so nothing has been
changed in response to them.

**What this does not prove.** Every policy above was exercised as `anon`
against empty tables. The audience model — friends / everyone / private — is
only genuinely tested once two real signed-in users exist, which is phase 1.

## The decision that matters: local-first

The reducer stays the source of truth. The server is a sync target, not the
thing the UI waits on.

```
tap → reducer (instant) → persistence (existing) → outbox → Supabase
                ↑                                              │
                └──────────────── reconcile ───────────────────┘
```

Concretely:

- `src/state/store.tsx` is unchanged in character. Actions still apply
  immediately and synchronously.
- `src/state/persistence.ts` already is the local cache. It gains a sibling: an
  **outbox** of mutations that haven't reached the server.
- A sync worker drains the outbox when there's a network, and applies server
  changes back into state.
- **Conflicts resolve last-write-wins per field.** Rally has no genuinely
  concurrent editing — one person owns their tasks — so the only real conflict
  is the same user on two devices, where last-write-wins is both correct enough
  and explicable.

The alternative, making every action a round trip, is far less code. It is
rejected because it would cost the thing the build has been protecting: taps
stop being instant, every screen grows loading and error states it doesn't
have, and the app stops working on a plane. That is a large, visible regression
in exchange for a smaller diff.

**What local-first costs**, stated plainly so this stays re-checkable: an
outbox with retry and ordering, idempotent mutations (client-generated UUIDs,
not server sequences), reconciliation on every read, and a story for a
mutation that the server ultimately rejects. It is the larger half of the work.

## State → schema

| Client slice | Goes to | Note |
|---|---|---|
| `myTasks` | `tasks` + `task_pairs` | `week_start` (a Monday date) replaces the week number — 33 is ambiguous across years |
| `acted` | `reactions` | The `unique (actor, target_type, target_id, kind)` constraint *is* the cheer toggle |
| `personNotes`, task `cmts`, `globalNotes` | `notes` | One table, targeted at a task or a person |
| `history`, `profile`, `yearLevels` | `week_rollups` | Written when a week closes; Me and the year grid read it back |
| `notifRead` | `notifications.read_at` | Per-item, as the client already does it |
| `pending` | `invites` | |
| `moments` | derived | A view over other members' `tasks` and `week_rollups` |
| circle membership | `circle_members` | `circleMembers(state)` is the one reader; the demo's is a fixture |
| `globalPosts` | `tasks` where `owner_id` is a bot | The Oz bots' weeks. No public-post table: a bot's post *is* a task, `aud = 'everyone'` |
| `globalNotes` | *(demo only)* | The two demo modes' posts have fixture ids, which `syncableNote` refuses. A note on a bot's post is an ordinary note |

## What stops being the client's job

- **`ranking()`** — currently computed over fixtures in `selectors.ts`. Becomes
  a view over `week_rollups`, so everyone sees the same order.
- **Rollover** — the client prompts and commits locally. On a server this is a
  scheduled job writing `week_rollups`, with the prompt reading the result.
- **Notification tiering and batching** — the handoff's three tiers and "cheers
  batch into one" are a server concern. `notifications.payload` carries the
  rendering data so the client stays a renderer.

## RLS is where the audience model lives

The handoff's audience rule — friends / everyone / private — is expressed once,
as policy on `tasks`, rather than as filtering the client could forget:

- owner always
- circle members when `aud = 'friends'`
- anyone when `aud = 'everyone'`
- owner and pairs when `aud = 'private'`

Two traps this schema deliberately avoids, both confirmed against current
Supabase docs:

1. **Policy recursion.** A policy on `tasks` that reads `circle_members`
   triggers that table's policy, which reads `circle_members` again; Postgres
   aborts with *"infinite recursion detected in policy for relation"*. The
   membership checks are therefore `SECURITY DEFINER` functions in a `private`
   schema, each scoped to `auth.uid()` so the elevated privilege can't be used
   to read anyone else's rows.
2. **Authentication mistaken for authorization.** `TO authenticated` alone
   would let any signed-in user read every row. Every policy pairs it with an
   ownership or membership predicate, and every `UPDATE` carries both `USING`
   and `WITH CHECK` so a row can't be reassigned to someone else.

## Phasing

Each phase leaves the app working.

1. **Auth and profiles.** Replace the hardcoded `ME` with a real session.
   Everything else stays local. This is where the app stops being single-user
   and is the biggest behavioural change.
2. **Tasks up.** The outbox, one table, one direction. Proves the pipe with
   the least surface.
3. **Tasks down, and the circle.** Reconciliation and real membership. The
   Circle screen stops reading fixtures.
4. **Reactions and notes.** Realtime becomes worth having here — a cheer
   landing on someone's phone is the product's whole thesis.
5. **Rollups and notifications.** Rollover moves server-side; push arrives,
   which needs the paid Apple programme.

## Open questions this design does not settle

- **Auth method.** Email OTP works without an Apple developer account; Sign in
  with Apple needs the paid programme and is effectively required by the App
  Store once any social login exists.
- **Humans on the global feed.** The feed is scoped to the Oz bots, who are
  openly fictional and readable by everyone. Letting real users' `everyone`
  tasks in implies moderation, reporting and abuse handling — out of scope
  here, and not a small annexe.
- **Cost.** The project sits in a separate Free-plan organisation, so it costs
  nothing. Free projects pause after 7 days of inactivity and restore within
  90; that is fine for development and is the thing to revisit before anyone
  else relies on it.
