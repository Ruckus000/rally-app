# Edge Functions

Deno, not Node. URL imports, a `Deno` global, and no `package.json` — which is
why `tsconfig.json` excludes this directory: compiling it with the app's config
reports a dozen errors about a runtime it does not run in.

## `push` — carry a notification out to a phone

`private.notify_on_reaction` writes a `notifications` row when someone cheers
your task. The bell renders it when you next open the app. This function is what
gets it onto a lock screen before then.

```
cheer → reactions insert → trigger → notifications row
                                        ↓  Database Webhook
                                     push()  → device_tokens (service_role)
                                            → exp.host/--/api/v2/push/send
                                            → APNs → phone
```

It reads `payload` and nothing else — the trigger put `actor_name` and
`task_title` there so the bell needed no second read, and this is the second
reader.

**A bot's cheer never reaches this function.** The Oz bots cheer real people's
public tasks on purpose — a Global feed that never reacts to you reads as a room
full of people ignoring you — so the bell showing "🔥 Dorothy Gale cheered you"
is wanted. The buzz is not: a fictional character is not a good enough reason to
light somebody's phone at three in the morning. `private.push_notification`
skips the call when `payload -> 'actor_id'` names an `is_bot` profile, and the
notification row is written either way. `integration/rls/push_suppression.test.ts`
pins both halves, including the control that a *real* person's cheer still
queues one.

### Deploying

```bash
npx supabase functions deploy push
```

`verify_jwt = false` is set in `supabase/config.toml`, because a webhook is not
a user and carries no JWT. **That makes the `x-webhook-secret` header the whole
authorisation story for this endpoint** — behind it are every device token on
the service and the ability to push to any of them. The function refuses every
request with a 500 if the secret is unset, rather than falling open.

### Secrets — yours to set, never in this repo

```bash
npx supabase secrets set PUSH_WEBHOOK_SECRET=<invent a long random string>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically for
deployed functions; you do not set those.

### The webhook

Dashboard → **Database** → **Webhooks** → **Create a new hook**:

| Field | Value |
| --- | --- |
| Table | `public.notifications` |
| Events | `Insert` |
| Type | HTTP Request → `POST` |
| URL | `https://<project-ref>.supabase.co/functions/v1/push` |
| HTTP Headers | `x-webhook-secret: <the same string>` |

Configured here rather than in a migration on purpose: a webhook is a `pg_net`
call carrying a secret, and a secret does not belong in migration history.

### Running it locally

```bash
npx supabase functions serve --env-file supabase/functions/.env.local
```

with `PUSH_WEBHOOK_SECRET=` in that file. `.env*.local` is gitignored.

Then, against the local stack:

```bash
curl -X POST http://127.0.0.1:55321/functions/v1/push \
  -H 'content-type: application/json' \
  -H 'x-webhook-secret: <your local secret>' \
  -d '{"record":{"recipient_id":"<a profile id>","tier":"circle","kind":"cheer",
       "payload":{"actor_name":"Maya Chen","task_title":"Run 5k"}}}'
```

With no device registered for that profile it answers `{"sent":0,"reason":"no
devices"}`. With a made-up token registered it answers
`{"sent":0,"failed":1,"pruned":1}` — Expo rejects the token as
`DeviceNotRegistered` and the function deletes the row, which is the pruning
path doing its job. Both were exercised this way before it ever shipped.

## `rate-goal` — what a goal is worth, and whether it is safe to stake

`POST { title, cat } -> { verdict, points, reason }`, behind `verify_jwt`. Two
prompts run in parallel: `rubric.mjs` prices, `screening.mjs` judges harm. A
cache keyed on the title hash means a repeated goal costs one indexed lookup and
no model call, and a per-user daily cap keeps one client's debounce loop out of
everybody else's queue.

**Every failure path returns 200 with a usable price.** The composer shows the
category price immediately and sharpens it when the answer lands, so nothing a
model does can stop somebody writing down their week.

### The one distinction worth understanding

A screening call that **did not arrive** — timeout, 429, no network — says
nothing about the goal and resolves `ok`. Failing closed there would mean a slow
model quietly refusing to let anyone write anything down.

A screening call the model **declined** is different. Gemini's safety filters
block the response itself: a 200, a `finishReason`, and no content. The goals
that trigger it are exactly the ones `screening.mjs` exists to catch, so a
refusal resolves `blocked`.

Both used to arrive as `null`, which meant a refusal failed open on precisely
the goals that must not. `_shared/verdict.mjs` holds that decision now, in a
`.mjs` both Deno and Node import, and `src/lib/__tests__/screeningVerdict.test.ts`
pins the pair.

### Deploying

```bash
npx supabase functions deploy rate-goal
npx supabase secrets set GEMINI_API_KEY=<from https://aistudio.google.com/apikey>
```

`LLM_MODEL` and `LLM_BASE_URL` are optional overrides. The default is
`gemini-3.5-flash-lite` — **not** `gemini-3.5-flash`, whose free tier is twenty
requests a *day*. With no key the function logs an error and prices everything
by category, which is the same fallback as an outage.

### Running it locally

```bash
npx supabase functions serve --env-file supabase/functions/.env.local
```

with `GEMINI_API_KEY=` in that file. `.env*.local` is gitignored.

To exercise the refusal and outage paths without waiting for a real refusal,
point `LLM_BASE_URL` at a stub in the same file and have it answer:

| To simulate | Stub responds |
| --- | --- |
| an answer | `200 {"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"{\"points\":40}"}]}}]}` |
| a refusal | `200 {"candidates":[{"finishReason":"SAFETY","content":{"parts":[]}}]}` |
| an outage | any non-2xx |

Driven that way through the real edge runtime, the three answer `ok` (cached),
`blocked` (not cached), and `ok` (not cached) respectively. Only a complete
answer is ever written to `goal_ratings` — the cache is permanent and shared, so
one timed-out call written there would freeze a goal at its category price for
everybody who ever types it.

## `screen-image` — ask the model before anyone else sees it

`POST {} -> { state }`, behind `verify_jwt`. Screens the caller's own pending
avatar: reads `avatar_path`/`avatar_state`, downloads the object with the
service role (the bucket is private), sends it to `imageScreening.mjs` as an
inline base64 part, and calls `mark_avatar_screened` — the only route into
`ready`, and service-role only.

There is no profile id in the request. The subject is always the caller, and a
parameter there would let any signed-in account aim the one key that can publish
an image at somebody else's row.

**Everything that is not `harmful: false` refuses**, and a refusal deletes the
object as well as marking the row. The bucket's select policy is
`bucket_id = 'avatars'` for every authenticated account, so a rejected image
left in place stays readable by anyone who learns its name — and the client that
uploaded it knows the name. Marking the row alone would hide the picture from
the app and leave it on the server. Delete first, then mark: the survivable
failure is a row still `pending`, which renders initials and which a repeat call
resolves.

`imageVerdict.mjs` explains why `unavailable` blocks here and passes in
`rate-goal`. Short version: an unscreened goal is a private line of text, an
unscreened avatar is a picture on the screens of people who have never met its
owner.

**The model's `reason` is never returned.** It is model-written text, logged for
diagnostics; the client shows `IMAGE_BLOCKED_COPY`, which does not explain what
was objected to and so cannot accuse anybody or hand anyone a checklist.

### Deploying

```bash
npx supabase functions deploy screen-image
```

Same `GEMINI_API_KEY` as `rate-goal`, and the same default model —
`gemini-3.5-flash-lite` takes images as well as text, which is why the avatar
guard needed no second model and no second cost story.

### Running it locally

`npx supabase functions serve --env-file supabase/functions/.env.local`, then
sign in, upload to `avatars/<your id>/<name>.jpg`, call `set_avatar`, and POST
to the function. Point `LLM_BASE_URL` at a stub as above to drive the paths a
real model will not produce on demand:

| Stub responds | Result |
| --- | --- |
| `200 {"candidates":[{"finishReason":"STOP","content":{"parts":[{"text":"{\"harmful\":false,\"reason\":\"\"}"}]}}]}` | `ready`, object kept |
| the same with `"harmful":true` | `refused`, object deleted |
| `200 {"candidates":[{"finishReason":"SAFETY","content":{"parts":[]}}]}` | `refused`, object deleted |
| any non-2xx, or never answering | `refused`, object deleted |

All four were driven that way through the real edge runtime before this
shipped, along with: a second call for the same upload (returns the settled
state and spends no model call), a call after the owner cleared the photo
(returns `none`, no model call), and an `avatar_path` with no object behind it
(`refused`).

## `screen-task-media` — the same gate, on a photo hung off a goal

`POST { mediaId, taskId } -> { state }`, behind `verify_jwt`. `screen-image`'s
sibling, and everything above about failing closed, about `unavailable`
blocking, and about never returning the model's `reason` is true here too.
Three things differ, and each has a reason.

**It takes an argument, which its sibling refuses to.** A person has one avatar
and many goals, so "the subject is always the caller" is not available. The
property is kept another way: the row is selected by `id` **and**
`owner_id = caller`, so a `mediaId` naming somebody else's photo matches
nothing. `taskId` only ever builds a storage prefix whose owner segment comes
from the token, so lying about it reaches one of the caller's own empty
folders.

**There are three answers, not two.** The client uploads the object first and
writes the row second, through the outbox — so "no row" is an ordinary,
temporary state rather than an error, and it has to be told apart from
"refused" or the client would delete a photo that was merely early. The object
is what tells them apart:

| Row | Object | Answer |
| --- | --- | --- |
| `pending` | — | screen it now |
| `ready` | — | `ready`, no second model call |
| none | present | `waiting` — the outbox has not caught up |
| none | gone | `refused` — this function already blocked it |

**A refusal deletes the row as well as the object.** `screen-image` keeps the
row and marks it `refused`, because there the row is the profile and cannot be
deleted. Here the row *is* the photo, and `unique (task_id)` would let a kept
refusal occupy the goal's only photo slot forever — so a blocked attempt
leaves the task exactly as it found it. That is also why there is no `refused`
state: `task_media.state` is `pending | ready` and nothing else.

The prompt is `GOAL_IMAGE_SCREENING`, not `IMAGE_SCREENING`. Same three things
looked for, same closed yes-list; what changes is the description of what the
image *is*, because a prompt expecting a portrait would find a photo of a trail
or a plate of food surprising, and surprise is one step from flagging it.

### Deploying

```bash
npx supabase functions deploy screen-task-media
```

Same `GEMINI_API_KEY` and same model as the other two.

### Running it locally

`npx supabase functions serve --env-file supabase/functions/.env.local`, then
sign in, upload to `task-media/<your id>/<task id>/<media id>.jpg`, insert the
`task_media` row, and POST `{ mediaId, taskId }`. The same `LLM_BASE_URL` stub
table as `screen-image` drives the verdicts; the two extra paths worth driving
are a `mediaId` with no row (`waiting` while the object is there, `refused`
once it is not) and a `mediaId` belonging to another account (`waiting`, and
no model call).

## `collect-media` — delete the files the database cannot reach

Undocumented until now, which is its own small bug: it has been deployed and
draining since `20260820163000_collect_orphaned_media.sql`.

`task_media` rows cascade from `tasks`; the objects they name do not, because
Postgres deletes rows and the bytes live in a bucket. **Deleting from
`storage.objects` in SQL does not remove the file** — it orphans it, and the
project keeps paying for it — so objects come out through the storage API or
they do not come out. This function is the hands that do that.

Two inputs. `media_gc` is certain: a trigger wrote each path inside the
transaction that removed its row. `orphaned_media` is a guess with a one-hour
grace, because an object no row names is also exactly what a live upload looks
like in the seconds before its row is written.

No JWT. It is called by a trigger, which is not a user, and
`COLLECT_MEDIA_WEBHOOK_SECRET` is the whole gate. Unset, it refuses everything.

### Deploying

```bash
npx supabase functions deploy collect-media
npx supabase secrets set COLLECT_MEDIA_WEBHOOK_SECRET="$(openssl rand -hex 32)"
```

The trigger reads the endpoint and the secret from Vault, not from `.env`, and
is silent when either is missing — which is what keeps every local stack and
every integration run off the network:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/collect-media',
                           'collect_media_function_url');
select vault.create_secret('<the same secret>', 'collect_media_webhook_secret');
```

## `delete-account` — finish a deletion the fortnight has run out on

The second half of App Store Guideline 5.1.1(v).
`20260824090000_account_deletion.sql` marks an account and hides it from
everybody; this is what happens fourteen days later.

Almost nothing here does the deleting — `auth.admin.deleteUser` fires the
cascade, and a trigger takes the notifications the cascade cannot reach. Two
things are left, and each is a thing SQL cannot do: remove the account's
objects from the `avatars` bucket (the one bucket with no collector), and
delete the `auth.users` row.

**It takes no account id, and `accounts_due_for_purge()` takes no window.**
That pair is the security story: the worst a leaked secret can do is bring
forward by hours a deletion that fourteen days of grace already made certain.
An id in the body would turn the same leak into "delete anybody".

Avatar first, account second, and a failure on the first leaves the account
entirely alone for the next run — so an account is either wholly gone or wholly
still there. Deleting the account first would lose the only handle on its
files: the path is `<uid>/…`, and once the profile row is gone nothing lists
it.

### Deploying

```bash
npx supabase functions deploy delete-account
npx supabase secrets set DELETE_ACCOUNT_WEBHOOK_SECRET="$(openssl rand -hex 32)"
```

Then the Vault pair the schedule reads, same shape as `collect-media`:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/delete-account',
                           'delete_account_function_url');
select vault.create_secret('<the same secret>', 'delete_account_webhook_secret');
```

`pg_cron` runs `private.purge_due_accounts()` at 03:17 UTC daily. Until both
Vault secrets exist the job runs and does nothing, silently and on purpose —
**so deploying the function without setting them means accounts are marked for
deletion and never actually deleted.** Check the job is there:

```sql
select jobname, schedule, active from cron.job;
```

### Running it locally

`npx supabase functions serve`, then invoke it directly rather than waiting for
the schedule — backdate a `deleted_at` first, since nothing is due otherwise:

```bash
curl -i -X POST http://127.0.0.1:55321/functions/v1/delete-account \
  -H 'x-webhook-secret: <your local secret>' -H 'content-type: application/json' -d '{}'
```

Worth driving all four answers: no secret set (500), wrong secret (401),
nothing due (`{"purged":0,"failed":0,"due":0}`), and one backdated account
(`purged: 1`, and its rows gone).

## What cannot be tested without hardware

The last hop. Expo hands the message to APNs, and APNs delivers to a real
device — the iOS Simulator cannot receive remote push at all. Proving that hop
needs an APNs key in EAS credentials, a dev or TestFlight build, and two
accounts, since a cheer on your own task deliberately produces no notification.
