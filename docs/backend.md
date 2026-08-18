# Backend design

> **The schema exists and the app uses it.** All fourteen migrations are
> applied to the Rally project (`zproxpxkxduzgxmzpeqa`, free plan, ca-central-1)
> and verified — see *Status* below. `src/sync/` is the client this document
> describes: a session, an outbox, a transport, reconciliation and realtime.
> Phases 1 to 4 of *Phasing* are built, and so is the push half of phase 5.
> What is **not** built is the rollup half — nothing writes `week_rollups`, so
> history, running totals and week rollover are still computed on the device.

This describes how the server was added **without losing what makes the app
feel good** — every tap lands instantly and it works with no network. The
reducer is still the source of truth; the server is a sync target. Two of the
three account modes (`fresh` and `seeded`) make no network call at all.

## Status

First applied 2026-08-10 with `supabase db push`. Re-counted against the hosted
project on 2026-08-18, after all fourteen migrations:

| Check | Result |
|---|---|
| Tables in `public` | 14 |
| Tables with RLS enabled | 14 |
| Policies | 24 |
| Enums | 5 |
| `private` helpers | 10 |
| `supabase db advisors --type all` | see *What the advisors say* below |

Four of those tables — `device_tokens`, `goal_ratings`, `llm_usage` and
`bot_goal_candidates` — carry RLS with **no policy at all**, which is the
deny-everything default and is deliberate. Two different things write them, and
neither is a client: the edge functions, which hold the service-role key and so
bypass RLS as `service_role`; and `SECURITY DEFINER` RPCs such as
`register_device`, which hold no key at all and bypass RLS by executing as the
function's owner, each one deriving its actor from `auth.uid()` rather than
trusting an argument. No client has any business reading these tables. The
advisor reports each of the four as an INFO, and this paragraph is the answer
to all of them.

Probed from the `anon` role with the publishable key: `select` on `tasks`
returns `[]`, `insert` is refused with `42501 new row violates row-level
security policy`, and `private.can_see_task` is not reachable over REST.

**One correction to what this page used to claim.** It said the `private`
helpers were "none executable by `anon` or `authenticated`". That is not true of
`authenticated`, which holds `USAGE` on the `private` schema and `EXECUTE` on
eight of the ten functions in it — the default `PUBLIC` grant, never revoked.
What keeps them out of reach is one layer further out: `private` is not in
PostgREST's exposed schemas, so there is no `/rest/v1/rpc/` route to any of
them, which is what the probe above actually established. The functions are
each scoped to `auth.uid()` regardless, so the grant buys a caller nothing even
if a route to it ever appeared. Worth revoking anyway, as the belt to that
brace — it is defence in depth that was described as already done.

## What the advisors say

Every current finding, and why it stands:

| Finding | Level | Why it is there |
|---|---|---|
| `rls_enabled_no_policy` ×4 | INFO | The four server-only tables above. Deny-everything is the intent. |
| `authenticated_security_definer_function_executable` ×4 | WARN | `create_circle`, `join_circle_by_code`, `register_device`, `unregister_device`. This is the RPC surface — `authenticated` calling them is the whole point, and each scopes its writes to `auth.uid()`. |
| `auth_allow_anonymous_sign_ins` ×10 | WARN | Every account in the app **is** an anonymous sign-in. The advisor is flagging the design, not a slip. |
| `auth_leaked_password_protection` | WARN | There are no passwords. Nothing to protect. |

Two advisor WARNs once pointed at `public.rls_auto_enable()`, the event trigger
function that auto-enables RLS on new tables. It was described here as a
Supabase platform object and "not ours" — both wrong. It is owned by `postgres`
rather than `supabase_admin`, so it was made by somebody with project access,
and it existed on production and in no migration at all. It now lives in
`private`, created by `20260817125331_adopt_ensure_rls.sql`, which is also what
put it under review for the first time. Not exploitable either way: it returns
`event_trigger`, so calling it over REST fails with *"cannot display a value of
type event_trigger"* before it can do anything.

The performance INFOs are all `unused_index` and `unindexed_foreign_keys` on a
near-empty database — meaningless until there is traffic, so nothing has been
changed in response to them. They become worth re-reading after the first week
of real use, not before.

**What this does not prove.** Every policy above was exercised as `anon`
against empty tables, which is why this page once said the audience model would
only be genuinely tested "once two real signed-in users exist, which is phase 1".

That gap has since been closed by `integration/`, not by phase 1.
`rls/tasks.test.ts` signs in as real seeded users and covers every branch of
`tasks_select` — `friends`, `everyone`, `private`, and a `private` task a second
user is paired on — with real JWTs rather than the `anon` key.

What is *still* outstanding is neither of those: it is everything no test can
stand in for — **two people, two devices, a real network, a whole week.** Phase
1 shipped; that test has not been run. It is the last unticked box before
anyone outside this repo is handed a build.

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

1. ✅ **Auth and profiles.** Replace the hardcoded `ME` with a real session.
   Everything else stays local. This is where the app stops being single-user
   and is the biggest behavioural change. *Anonymous sign-in, in
   `src/sync/session.ts`.*
2. ✅ **Tasks up.** The outbox, one table, one direction. Proves the pipe with
   the least surface. *`src/sync/outbox.ts`, `task.upsert` and `task.delete`.*
3. ✅ **Tasks down, and the circle.** Reconciliation and real membership. The
   Circle screen stops reading fixtures. *`reconcile.ts`; `pullCircle` and
   `pullMyCircle` in `transport.ts`.*
4. ✅ **Reactions and notes.** Realtime becomes worth having here — a cheer
   landing on someone's phone is the product's whole thesis. *`realtime.ts`,
   plus `reaction.add` / `reaction.remove` / `note.add`.*
5. ◐ **Rollups and notifications.** Rollover moves server-side; push arrives,
   which needs the paid Apple programme.
   - **Push: built.** `device_tokens`, the `push_on_notification` trigger, and
     the deployed `push` edge function. Untestable on a simulator — a physical
     device is the only way to see it work.
   - **Rollups: not built.** Nothing writes `week_rollups`. `mappers.ts` counts
     the rows it already holds instead, which is cheaper and current. The
     consequence is that history, running totals and rollover live on one
     device and nowhere else — see the caveat in the README about there being
     no way back into an account.

## Open questions this design does not settle

- **Auth method.** Settled provisionally, and it is the largest open risk in
  the build: every account is an **anonymous** sign-in. That needs no Apple
  developer account and asks a new user for nothing, which is why it was
  right for getting the sync layer working — but it has no recovery path.
  Delete the app and the account is unreachable forever. Email OTP works
  without a paid membership; Sign in with Apple needs the paid programme and
  is effectively required by the App Store once any social login exists. The
  Welcome screen already stubs Apple and Google as "coming soon".
- **Humans on the global feed.** The feed is scoped to the Oz bots, who are
  openly fictional and readable by everyone. Letting real users' `everyone`
  tasks in implies moderation, reporting and abuse handling — out of scope
  here, and not a small annexe.
- **Cost.** The project sits in a separate Free-plan organisation, so it costs
  nothing. Free projects pause after 7 days of inactivity and restore within
  90; that is fine for development and is the thing to revisit before anyone
  else relies on it.
