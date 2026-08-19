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

First applied 2026-08-10 with `supabase db push`. Re-counted 2026-08-19 against a
freshly reset local stack carrying all eighteen migrations, by querying
`pg_tables`, `pg_policies`, `pg_type` and `pg_proc` directly.

That method matters, because the previous re-count was done by grepping
`create policy` across the migrations and came out at 28. It is 26. Six policies
are dropped and recreated by `20260819164832_reports_and_blocks.sql`, so grep
counts each of them twice — an error that will recur every time a migration
amends an existing policy. **Count from the database, not from the files.**

`storage.objects` policies are not included here and never have been; the
`avatars` bucket adds four of them.

| Check | Result |
|---|---|
| Tables in `public` | 16 |
| Tables with RLS enabled | 16 |
| Policies in `public` | 26 |
| Enums | 5 |
| `private` helpers | 12, six of them called by policies |
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

A fifth table, `reports`, joins them as of `20260819164832_reports_and_blocks.sql`
— but it is not the same case, and folding it into the paragraph above would
overstate how reachable it is. The other four are still written by
`service_role`, which holds a grant on each; `reports` holds a grant for
nobody but its owner, not even `service_role`. See *Reports and blocks* below
for why.

Probed from the `anon` role with the publishable key: `select` on `tasks`
returns `[]`, `insert` is refused with `42501 new row violates row-level
security policy`, and `private.can_see_task` is not reachable over REST.

**One correction to what this page used to claim.** It said the `private`
helpers were "none executable by `anon` or `authenticated`". That is not true of
`authenticated`, which holds `EXECUTE` on eight of the ten functions.

That grant is **deliberate and load-bearing, not an oversight.** An RLS policy
is evaluated as the *calling* role, so `authenticated` must be able to execute
any helper a policy calls. `20260810000000_init.sql` ended with exactly the
revoke this page implied had happened, and it silently broke every policy that
calls a helper; `20260811025743_repair_write_paths.sql` §1b took it back out
and wrote down why. Re-running the revoke against the seeded local database
still fails the same way — `permission denied for function
shares_circle_with`, and 47 of `rls/tasks.test.ts` with it. It hides on an
empty database, because `tasks_select` short-circuits before reaching a helper.

What *was* removable is the schema grant, and
`20260818124000_close_private_to_clients.sql` removes it. Schema `USAGE` is
checked when a **name** is resolved; a stored policy already holds the
function's OID and never consults the schema again. So revoking `USAGE` blocks
`authenticated` from calling `private.shares_circle_with(...)` by name and
costs the policies nothing — measured both ways before it was written, and
pinned by two tests in `rls/profiles.test.ts` that were each mutation-tested.

The gain is a second lock, not a hole closed: `private` is absent from the
exposed schemas, so there is no `/rest/v1/rpc/` route to these functions
anyway, and each is scoped to `auth.uid()` so a caller who reached one would
learn nothing about anybody else.

## What the advisors say

Every current finding, and why it stands:

| Finding | Level | Why it is there |
|---|---|---|
| `rls_enabled_no_policy` ×5 | INFO | The four server-only tables above, plus `reports`. Deny-everything is the intent. |
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

## The pull is one round trip

`public.pull_world(p_week_start, p_notif_limit)` answers a whole pull cycle —
circle, members, bots, notifications, the week's tasks (own and feed), own
reactions, notes, rollups, and server-counted cheers — as one JSON payload.
The client's per-table pulls remain in `transport.ts` as the floor: a server
without the function answers `PGRST202`, the engine remembers that per session
and falls back to the old three-wave waterfall, so client and migration can
ship in either order.

The function is **SECURITY INVOKER**, and that is the load-bearing part: every
subquery runs as the caller under the same RLS as the client's own queries, so
it restates no visibility rule and cannot drift from the policies below.
`integration/rls/pull_world.test.ts` holds it to that.

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

## Reports and blocks

Two controls for when someone else is the problem, added in
`20260819164832_reports_and_blocks.sql`. They are opposite postures on
purpose: `blocks` is yours to read, `reports` is nobody's.

**`reports` has no policies and no grant at all — not even to `service_role`.**
RLS is on and there is no `create policy` for it anywhere: not for the
reporter, not for the subject, not for `authenticated`. `anon` and
`authenticated` are revoked per the pattern the section above already
describes, and `service_role` is revoked too, which is the one thing this
table does differently from `device_tokens`, `goal_ratings`, `llm_usage` and
`bot_goal_candidates` — each of those still grants `service_role` a way in,
because an edge function writes them. Nothing writes `reports` except the
`report_content` RPC, running as its own definer, so there is no writer that
needs the grant and no reader this table should hand one to. What's left
reachable is `postgres`, the table's owner — reading the queue means having
database access and querying as the owner, not calling anything a client or
an edge function can reach. A readable report table is a list of who accused
whom, and that list is more dangerous than the reports are useful: the one
thing a person filing a report is owed is that its subject cannot find it.
There is no moderation team yet, so nothing currently needs to read this
table — the queue exists so that one could, later. When that day comes, the
line to add is `grant select, update on public.reports to service_role`: one
line, a decision somebody makes on purpose, rather than a privilege that was
already sitting there because a platform default handed it over.

**Blocking is symmetric.** `private.block_between(other)` is true if a block
exists in either direction, and every amended policy below calls it that way.
A one-directional block would hide the blocked person from you while leaving
them free to keep cheering your tasks and writing notes on them — precisely
the contact the control exists to stop. Symmetry has a cost, and it belongs
in this document rather than left for someone to discover: a block is
*implicitly* discoverable. Once you block someone, their cheers stop
landing on your tasks, your name stops turning up for them, and an
attentive person can work out what happened. The app never says so — no
screen, no toast, no notification names a block — but the inference is
available, and writing as though it weren't would be dishonest. The
alternative, a block that leaves no trace at all, is a block that doesn't
actually stop the contact it exists to stop.

**`week_rollups_select` is deliberately not filtered**, even though it
exposes other members' numbers the same way the six amended policies expose
other members' content. Blocking someone doesn't remove them from the
circle; it hides what they say. A rollup isn't something they said — it's a
number the circle's shared arithmetic is made of. Filtering it would make
circle totals per-viewer instead of per-circle: two members of the same
circle would get two different answers to "how did we do this week," and
neither of them would be wrong. Leaving someone out of the maths is a
different feature — leaving the circle — and belongs on that control, not
this one.

**`profiles_select` carries a branch none of the other five amended
policies need.** `private.i_blocked(other)` is one-directional — true only
for "have *I* blocked them," never the reverse — and it sits outside the
`block_between` guard, alongside the pre-existing `is_bot` branch. Without
it, blocking someone would stop *their name resolving for the person who
blocked them*, because the ordinary branch (`shares_circle_with`) is
guarded by the symmetric check, and Settings needs an unblock list of
people, not uuids. So say the consequence plainly, because it's easy to
miss and a reader deserves to know: **blocking someone makes their profile
marginally more visible than it was a moment before.** A circle-less
account that blocks a stranger off the public feed can, from that moment
on, resolve that stranger's name and handle — something it could not do
before the block existed, since the stranger shares no circle with them and
isn't a bot. That is the accepted trade for an unblock list that shows a
person instead of an identifier nobody recognises. It is not an oversight,
and it is not free.

## Avatars: a face behind a screening gate

Added in `20260819194501_avatars.sql`: two columns on `profiles`, a private
`avatars` bucket, four storage policies, and two RPCs. If `task_media` (photos
on goals, an unmerged branch at the time of writing) has also landed by the
time you read this, that is a second private bucket following the same shape
— private, signed reads, path rooted at the owner, client-minted object names,
no update policy on the row. This section only writes down where an avatar is
*not* like a goal photo; it does not assume it is the only bucket in the
project.

**The state machine.** `avatar_state` is `none | pending | ready | refused`,
checked by a constraint. A goal photo is scoped to the goal's audience; an
avatar has no audience to delegate to — it is rendered on every screen that
names you, to everyone signed in. So the column isn't answering "who can see
this", it's answering "has anyone looked at this yet", and that has to be
settled before the first render rather than after the first report.
`pending` therefore renders initials **including to the image's own owner**
(`src/components/Avatar.tsx`, `src/lib/avatarUrl.ts`) — the part that looks
like over-caution and isn't. If an unscreened image rendered to its uploader,
the uploader's own screenshot would be the distribution channel, and
screening would have bought a delay instead of a decision. Only `ready` ever
reaches a screen. `refused` is kept distinct from `none` so the app can say
why nothing appears, rather than a refusal reading like a silently failed
upload.

**Why the bucket is private.** A public bucket moves visibility out of RLS
and into "does anyone know the URL" — normally argued about content with a
narrow audience, which makes it worth saying why it still holds here even
though an avatar's *intended* audience is everyone signed in. It is not the
`ready` image a public bucket would expose; it's the `pending` one and the
`refused` one, sitting in the same bucket under a name the uploader chose
and therefore knows. A public bucket would turn the screening gate into a
client-side render rule with the bytes sitting behind a guessable URL the
whole time — and the one image that gate must hold back is exactly the one
somebody has a reason to go looking for. A takedown against a public URL is
also cosmetic: the bytes stay reachable to anyone who already has the link,
because revoking public read access on a bucket doesn't retract a URL
already handed out. A private bucket's signed URLs expire on their own
(`AVATAR_URL_TTL_SECONDS = 3600` in `src/lib/avatarUrl.ts`) whether or not
anyone remembers to act.

**Why the storage policy compares text, not casts.** The path is
`<owner_id>/<name>.jpg`, and the insert/update/delete policies check
`(storage.foldername(name))[1] = (select auth.uid())::text` — text against
text, deliberately not `... = auth.uid()`, which would cast the client-chosen
path segment to `uuid`. A malformed segment then fails to parse and Postgres
raises `22P02` *inside the policy* — which is not one bad upload failing, it
is that policy failing for whoever evaluates it next. `task_media` hit the
same trap with `payload ->> 'actor_id'` and guarded it with a regex; here the
question is only "is this string the caller's id", so there's nothing to
parse and a malformed name is simply a policy miss. Casting the *other* side,
`auth.uid()::text`, is safe because that value is a uuid or null and never
malformed.

**Why the write path is two RPCs, not a column grant — and the trap
Postgres itself points you at.** `authenticated` already holds
`grant update (name) on public.profiles` from `20260813120745_oz_bots.sql`,
narrowed to one column so nobody could promote themselves to `is_bot`. A
column-level grant does not widen when the table gains columns, so
`avatar_path` and `avatar_state` arrive unwritable by inheritance, without
anyone deciding it for this feature specifically. That's a real gate, but
"safe because of a grant three migrations away" is exactly the kind of
coupling this schema has learned to distrust — the same lesson `reports_and_blocks`
already applied to a different table. So the migration doesn't lean on it:
`set_avatar(p_path)` is `SECURITY DEFINER`, and the whole of its security
property is that `'ready'` and `'refused'` appear nowhere in its signature —
a client can move itself into `pending` and back to `none` and nowhere
else, because the state written there is a literal in the function body, not
a parameter. `mark_avatar_screened(p_profile, p_state)` is the only route
into `ready`, and it is revoked from every role a client can hold and granted
only to `service_role` — the edge function calls it, never the app. **Do not
add `grant update (avatar_path, avatar_state) on public.profiles to
authenticated`.** It would reopen the whole gate, restoring a direct write
path to `ready`. The temptation is real, because Postgres's own error message
walks you toward exactly that: try to `UPDATE` a column you don't hold and
you get *"permission denied for table profiles"* with a HINT suggesting you
grant `UPDATE` on the table — generic wording for a column-privilege miss,
and advice that is right for almost every other case and wrong for this one.
The migration's own comments say so, so the next person reads it before
typing it.

**Why the screener fails closed while `rate-goal` fails open.**
`_shared/imageVerdict.mjs` is the deliberate mirror image of
`_shared/verdict.mjs`. Both give the same three-way shape to a screening
call — an answer, a refusal, and a call that never arrived — and resolve
`unavailable` in opposite directions. `rate-goal`'s `screeningVerdict` treats
a timeout, a 429, or a garbled body as `ok`: failing closed there would mean
a slow model silently stopping someone from writing down their week, and the
thing withheld is a sentence its author typed, shown only to the circle they
chose. `imageVerdict` treats the identical set of non-answers as `blocked`:
the thing withheld here is a picture that lands on the screens of people who
have never met its owner, and a false pass isn't recoverable by the person
who has already seen it — publishing exactly what app stores remove apps
for. The cost of getting it wrong the cautious way is one person asked to
upload again; the cost of getting it wrong the other way is silence about
the very images this feature exists to catch. Same shape, opposite
resolution, on purpose — and the model call is not free either: `screen-image`
shares `rate-goal`'s per-user daily cap (`bump_llm_usage`, 200/day, one
counter for both), and going over it also resolves `blocked`, deleting the
pending upload rather than leaving it stranded unscreened.

**On refusal, the object is deleted, not just the row.** The bucket's select
policy is `bucket_id = 'avatars'` for every authenticated account — deliberate,
since an avatar's audience is everyone — so an object that survives a refusal
is readable by anyone who learns its name, and the client that uploaded it
already knows the name. `screen-image` deletes the storage object before
marking the row `refused`; marking the row alone would hide the picture from
the app while leaving it addressable on the server for as long as the bucket
exists. The order matters: delete first, then mark, so the survivable failure
is a row still `pending` — which renders initials, and which a repeat call
resolves — rather than a row saying `refused` over bytes that are still
there.

**Client shape:** pick → downscale to 512px JPEG (`expo-image-manipulator`,
which drops EXIF as a side effect of re-encoding rather than by any explicit
strip step — see *Known limits* in `TESTING.md`) → upload → `set_avatar` →
`screen-image`. Clearing a photo and replacing one both delete the storage
object being abandoned — `src/lib/avatarUpload.ts`. `Avatar` renders a photo
only when `avatar_state === 'ready'` and a signed URL has come back; every
other state, and any URL that fails to load, draws initials instead. Signed
URLs live an hour, are held in a module-level cache rather than persisted,
and are dropped on sign-out (`resetAvatarUrls`) since they're bearer tokens
for objects the next account signed into this device has no business holding
links to.

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
5. ✅ **Rollups and notifications.** Rollover moves server-side; push arrives,
   which needs the paid Apple programme. Both halves are now built, though the
   rollup half arrived by the opposite route to the one planned — see below.
   - **Push: built.** `device_tokens`, the `push_on_notification` trigger, and
     the deployed `push` edge function. Untestable on a simulator — a physical
     device is the only way to see it work.
   - **Rollups: built, client-side.** `week_rollups` gained an insert policy in
     `20260818150000_write_your_own_rollups.sql`, and a week is queued when you
     confirm the rollover — not by a trigger, because rollover happens in the
     reducer and the server never sees the week close. Insert only: a week
     closes once, and a replayed queue entry is absorbed by
     on-conflict-do-nothing rather than by an update path nobody needs.
     Rollover itself stays on the device, which is the half of this phase that
     was never really about storage.

## Open questions this design does not settle

- **Auth method.** Half settled. Every account still *starts* as an anonymous
  sign-in, which asks a new user for nothing and is why it was right for
  getting the sync layer working. Wave D adds the way out on iOS: Me attaches
  an Apple identity with `linkIdentity` and a native id token, keeping the same
  user id, and the Welcome screen signs that account back in on a fresh
  install. **Android is still unreachable** — `expo-apple-authentication` is
  iOS-only, so Google is the outstanding half. Email OTP remains an option and
  is not built; Sign in with Apple is effectively required by the App Store
  once any social login exists, which is the other reason it went first.
- **Manual linking, which linking required.** `enable_manual_linking = true` is
  now set in `supabase/config.toml` and must be set on the hosted project too.
  The cost, recorded rather than discovered later: with it on, anyone holding a
  stolen session can attach *their own* identity to that account and keep it.
  Proportionate for a beta whose sessions live in AsyncStorage behind the OS's
  own disk encryption, and worth revisiting before this holds anything a
  stranger would want.
- **Two accounts that both hold data.** Linking refuses with
  `identity_already_exists` when the Apple id belongs to another Rally account,
  and the app says so rather than merging. Merging is the conflict-resolution
  case the Supabase docs sketch and leave to the application, and there is no
  version of it here that does not silently lose one of the two weeks.
- **Humans on the global feed.** The feed is scoped to the Oz bots, who are
  openly fictional and readable by everyone. Letting real users' `everyone`
  tasks in implies moderation, reporting and abuse handling. Reporting and
  blocking are now built — see *Reports and blocks* above — but that is not
  the same as moderation: `report_content` fills a queue nobody reads yet,
  because there is no moderation team. Opening the feed to real strangers
  before one exists is still out of scope, and not a small annexe.
- **Cost.** The project sits in a separate Free-plan organisation, so it costs
  nothing. Free projects pause after 7 days of inactivity and restore within
  90; that is fine for development and is the thing to revisit before anyone
  else relies on it.
