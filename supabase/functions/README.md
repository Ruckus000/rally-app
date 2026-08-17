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

## What cannot be tested without hardware

The last hop. Expo hands the message to APNs, and APNs delivers to a real
device — the iOS Simulator cannot receive remote push at all. Proving that hop
needs an APNs key in EAS credentials, a dev or TestFlight build, and two
accounts, since a cheer on your own task deliberately produces no notification.
