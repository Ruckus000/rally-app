# Profile Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let someone attach a photo to their profile that is screened before anyone sees it, shown wherever they appear, and removable — without inventing a second storage convention or a second answer to moderation.

**Architecture:** A private `avatars` bucket read through signed URLs, following the conventions `task_media` established. `profiles.avatar_path` holds the object name, never a URL. Uploads go direct to Storage from the client; the outbox keeps carrying rows only. A new `screen-image` edge function gates publication and **fails closed** — the deliberate inverse of `rate-goal`'s fail-open.

**Tech Stack:** Supabase Storage + Postgres RLS, Deno edge functions, Gemini (multimodal), React Native 0.86 / Expo 57, `expo-image-picker`, `expo-image-manipulator`, Jest.

**Spec:** `docs/superpowers/specs/2026-08-19-profile-photos-design.md` — **read its "Revised after reading `task_media`" section first.**

---

## Background

- **`CLAUDE.md`** — no path aliases; `tsconfig.json` excludes `supabase/functions` so `npm run typecheck` does **not** cover them; shared edge logic is `.mjs` so Deno and Node both load it, and `jest.config.js` transforms `\.mjs$`; `EXPO_PUBLIC_*` is baked into the bundle so the publishable key only; `GEMINI_API_KEY` is unprefixed and read from `supabase secrets set`.
- **The unit mock has no RLS.** Any "X cannot see Y" test belongs in `integration/`.
- **`supabase/migrations/20260819180000_task_media.sql`** on branch `claude/app-audit-ux-review-173a55` is the convention to follow. It is **not merged**. Nothing here depends on it at file level, but `docs/backend.md` and `integration/support/reset.ts` will conflict textually — merge those by hand.

### The conventions being reused, not reinvented

Private bucket; signed URLs minted per read; path `<owner_id>/<id>.<ext>`; **every uuid cast inside a storage policy guarded** so a malformed object name answers `false` rather than raising 22P02 on someone else's read; client-minted ids; 5 MB ceiling; jpeg/png/webp; no update policy — replace is delete plus insert.

### Suggested PR split

Tasks 1–4 and 9a are the server and can merge alone; the feature is simply invisible until the client lands. Tasks 5–8 and 9b are the client. Split if review gets unwieldy.

---

## Task 1: Migration — bucket, column, policies

**Files:** create `supabase/migrations/<timestamp>_avatars.sql` (`date -u +%Y%m%d%H%M%S`).

- [ ] **Step 1** — `profiles` gains `avatar_path text` (nullable) and `avatar_state text not null default 'none'` constrained to `('none','pending','ready','refused')`.

  The state column is load-bearing, not bookkeeping: **an unscreened image must never render, even to its owner** — otherwise the owner's screenshot is the distribution channel. `pending` renders initials.

- [ ] **Step 2** — a private `avatars` bucket mirroring `task-media`: `public = false`, `file_size_limit` 2097152 (2 MB — an avatar is smaller than a goal photo and the client downscales to a few hundred KB), `allowed_mime_types` jpeg/png/webp.

- [ ] **Step 3** — storage policies on `storage.objects` for `bucket_id = 'avatars'`:
  - insert/update/delete: `(storage.foldername(name))[1] = auth.uid()::text` — the owner's own folder only. **Compare as text; do not cast the segment to uuid**, so a malformed name is a policy miss rather than a raised exception.
  - select: authenticated. Avatars are visible to every signed-in person by product decision, so no `can_see_*` helper is needed and none should be invented.

- [ ] **Step 4** — `profiles_update` already exists; confirm it permits these two new columns and does not need widening. **Read it rather than assuming.** If a client could set `avatar_state = 'ready'` itself, that defeats screening — in that case the state must move behind a `security definer` RPC that only the edge function's service-role caller may set, and you should say so and stop rather than shipping a client-writable gate.

- [ ] **Step 5** — `npm run db:reset`, then verify in psql: bucket row exists and is private; the four storage policies exist; `profiles` has both columns with the check constraint. Paste real output.

- [ ] **Step 6** — commit: `Somewhere to put a face, and a gate in front of it`

---

## Task 2: Integration tests

**Files:** create `integration/rls/avatars.test.ts`; modify `integration/support/reset.ts` if it needs the new column cleared.

Read `integration/rls/task_media.test.ts` **on the other branch** first if you can reach it; otherwise `integration/rls/device_tokens.test.ts` for the harness.

- [ ] Pin: a user can write to their own folder; **cannot** write to another user's folder; can delete their own; cannot delete another's; any authenticated user can read; `anon` cannot read; a malformed object name is refused rather than raising; `avatar_state` cannot be set to `'ready'` by a client (or, if Task 1 moved it behind an RPC, that the RPC refuses a non-service caller).
- [ ] Verify at least the cross-user write and the `'ready'` gate genuinely bite by removing the guard and re-running. Report the failure output.
- [ ] `npm run test:integration` — all suites.
- [ ] Commit: `Prove the folder is yours and the gate is not`

---

## Task 3: Shared screening modules

**Files:** create `supabase/functions/_shared/imageScreening.mjs` and `supabase/functions/_shared/imageVerdict.mjs`; create `src/lib/__tests__/imageVerdict.test.ts`.

`.mjs` so Deno and the Node test suite read one file — the reason `rubric.mjs`, `screening.mjs` and `verdict.mjs` are.

- [ ] **The prompt** (`imageScreening.mjs`): follow `screening.mjs`'s register — one question, a tight yes-list, and an explicit "answer no for everything else" including vague, low-quality, unflattering or odd images. The failure mode that prompt is written against is a model saying yes to things it merely dislikes.

- [ ] **The verdict** (`imageVerdict.mjs`): mirrors `verdict.mjs`'s three-way shape — an answer, a refusal, and a call that never arrived — but **`unavailable` resolves `blocked`, not `ok`.**

  Comment that inversion where it happens, with the reason: an unscreened goal is text its author typed and only their circle sees, so failing open costs a false refusal; an unscreened avatar is a picture on the screens of people who have never met them, so failing open costs the thing app stores remove apps for.

- [ ] **Tests** pinning all four paths, including that `unavailable` blocks. Mutation-test the inversion — flip it to `ok` and confirm a test fails.

- [ ] Commit: `Screen a picture, and fail the other way`

---

## Task 4: The `screen-image` edge function

**Files:** create `supabase/functions/screen-image/index.ts`; possibly modify `supabase/functions/_shared/llm.ts`.

- [ ] **Step 1 — check the model first.** `llm.ts` calls `generateContent` with text-only `parts` and defaults to `gemini-3.5-flash-lite`. Confirm that model accepts `inlineData` image parts. **If it does not, say so and stop** rather than silently switching models — the model choice has a documented cost rationale in that file and changing it is a decision, not an implementation detail.

- [ ] **Step 2** — extend `complete()` to accept optional image parts, or add a sibling `completeWithImage()`. Prefer whichever keeps `llm.ts`'s existing comments true. Do not duplicate the retry, timeout and refusal handling.

- [ ] **Step 3** — the handler: authenticate the caller, read `avatar_path` for that user, download the object with the service role, screen it, then set `avatar_state` to `ready` or `refused` **and clear `avatar_path` on refusal**, so a refused object cannot be signed later. Follow `rate-goal/index.ts` for auth, usage counting and timeouts.

- [ ] **Step 4** — `supabase functions serve` and exercise both outcomes by hand. `npm run typecheck` does **not** cover this directory; say so in your report rather than implying it was typechecked.

- [ ] Commit: `Ask the model before anyone else sees it`

---

## Task 5: Upload from the client

**Files:** modify `src/sync/transport.ts`, `src/sync/engine.ts`, `src/state/store.tsx`; create `src/lib/avatarUpload.ts` and its test; add deps.

- [ ] **Step 1** — add `expo-image-picker` and `expo-image-manipulator`.

- [ ] **Step 2** — `src/lib/avatarUpload.ts`: pick → **downscale to a 512px long edge and re-encode as jpeg** → strip EXIF (the manipulator's re-encode does this; verify rather than assume, and say how you verified) → upload direct to Storage → call `screen-image`.

  **The outbox must not carry the binary.** A queued image is megabytes in AsyncStorage that must survive relaunches and identity changes, and the outbox was not built for it. An upload that fails is a UI-level retry, which is honest because the user is watching. Only the resulting *path* goes through the normal row path.

- [ ] **Step 3** — tests: downscale happens before upload; a failed upload does not touch the profile row; a refused screening leaves the avatar unset and surfaces one line.

- [ ] Commit: `Send a smaller picture, and only the path`

---

## Task 6: Rendering

**Files:** modify `src/components/Avatar.tsx`, `src/sync/transport.ts` (a signed-URL pull), `src/state/store.tsx`.

- [ ] `Avatar` renders the image when there is a `ready` path and a signed URL, and **falls back to the existing initials** in every other case — none, pending, refused, expired, or failed to load. Initials are the designed default (`HANDOFF.md:269`), not an error state.
- [ ] The accessible name stays the person's full name. The image is as decorative as the initials were.
- [ ] Signed URLs expire: decide and document a TTL, and where they are refreshed. A stale URL must degrade to initials, never to a broken-image glyph.
- [ ] Tests for each fallback path.
- [ ] Commit: `A face when there is one, initials when there is not`

---

## Task 7: The Settings entry point

**Files:** modify `src/overlays/SettingsOverlay.tsx` and its test.

- [ ] A row in the existing `Section`/`Card` idiom: add, replace, remove. Remove is a delete plus clearing the row — there is no update policy by design.
- [ ] Show `pending` honestly ("Checking your photo…") and `refused` in one `Trouble`-style line that does not argue with the model or explain what it objected to.
- [ ] Commit: `Choose a photo from the one page that holds your account`

---

## Task 8: Documentation

- [ ] `docs/backend.md` — the bucket, the column, the state machine, and **why the screener fails closed while `rate-goal` fails open**. Expect a textual conflict with the `task_media` branch here.
- [ ] `TESTING.md` — Known limits: nothing verifies the screener is any good (that needs a corpus and a human); screening costs a model call per upload; **`task_media` currently ships with no screening at all**, so goal photos are unscreened while avatars are not.
- [ ] Commit: `Write down what the screener does and does not promise`

---

## Task 9: The gate

- [ ] `npm run typecheck` (does not cover `supabase/functions` — say so)
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run test:integration`
- [ ] Mutation-test, recording evidence:

| # | Target | Mutation | Must be caught by |
|---|---|---|---|
| 1 | `imageVerdict.mjs` | `unavailable` resolves `ok` instead of `blocked` | the fail-closed test |
| 2 | storage insert policy | drop the folder-owner check | the cross-user write test |
| 3 | `avatar_state` gate | let a client set `'ready'` | the gate test |
| 4 | `Avatar.tsx` | render the image while `pending` | the pending-fallback test |
| 5 | `avatarUpload.ts` | skip the downscale | the downscale test |

Mutation 1 is the one that would publish an unscreened image whenever the model is having a bad day. Mutation 3 is the one that makes the whole screener decorative.

- [ ] PR, and merge on green.
