# Reporting and Blocking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let someone report content and block a person, so that reported content disappears for the reporter at once, blocked people stop reaching them in both directions, and reports land in a queue only the service role can read.

**Architecture:** The block filter lives in **RLS**, not in the client — a `private.block_between()` helper is added to the existing `private` schema and folded into the five SELECT policies that expose other people's content, so blocked rows never leave the database. The client keeps a local mirror for the offline case. Writes go through `security definer` RPCs following the `register_device` / `unregister_device` precedent, so no client holds a grant on either new table.

**Tech Stack:** Postgres + Supabase RLS, React Native 0.86 / Expo 57 / React 19, TypeScript, `useReducer` + Context, Jest (`--selectProjects unit` and `--selectProjects integration`).

**Spec:** `docs/superpowers/specs/2026-08-19-reporting-and-blocking-design.md`

---

## Background an engineer new to this repo needs

- **`CLAUDE.md`** — no path aliases, no navigation library, every file opens with an
  explanatory block comment, `src/theme/tokens.ts` owns every design value.
- **`docs/backend.md`** — the schema and the RLS rationale. Read it before touching a
  policy.
- **The unit-test mock has no RLS.** `src/__mocks__/@supabase/supabase-js.ts` is applied
  to every unit test automatically. **Any test named "X cannot see Y" belongs in
  `integration/`** or it passes for the wrong reason. This is the single most important
  thing to get right in this plan — most of the value here is RLS, and the unit suite
  cannot test it.
- **`src/sync/transport.ts`** is the only module that talks to Supabase, via a `WireOp`
  union. `mappers.ts` converts row ↔ domain.
- Integration tests need Docker: `npm run db:start`, `npm run db:reset`,
  `npm run test:integration`.

### The existing patterns you are copying

**For the RPCs:** `register_device` / `unregister_device` in
`supabase/migrations/20260815225639_device_tokens.sql:55-100`. Note all four properties —
`security definer`, `set search_path = ''`, reading `auth.uid()` internally rather than
taking an owner argument, and the explicit
`revoke execute … from public, anon` at the end. Postgres grants EXECUTE to PUBLIC on
every new function, so **a `security definer` function in `public` is an open endpoint
until told otherwise.**

**For the visibility helper:** `private.shares_circle_with()` at
`supabase/migrations/20260810000000_init.sql:183`. Same shape: `language sql`,
`security definer`, `stable`, `set search_path = ''`.

**For a table nothing may read:** `device_tokens` — RLS enabled, **no policies**, no
grant to `authenticated`. `reports` follows this exactly.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/<ts>_reports_and_blocks.sql` (create) | Both tables, `private.block_between()`, the three RPCs, and the amended SELECT policies |
| `src/sync/transport.ts` (modify) | Three new `WireOp` members and their push cases; `pullBlocks` |
| `src/state/store.tsx` (modify) | `blocked: string[]` state, `BLOCK`, `UNBLOCK`, `BLOCKS_PULLED` actions |
| `src/state/selectors.ts` (modify) | Local filtering — the offline half of the block |
| `src/sync/engine.ts` (modify) | Queue helpers `queueReport`, `queueBlock`, `queueUnblock`; pull blocks |
| `src/overlays/ReportSheet.tsx` (create) | The report/block flow: reason picker, confirm, copy |
| `src/overlays/DetailSheet.tsx` (modify) | Entry points on the task and person variants |
| `src/overlays/SettingsOverlay.tsx` (modify) | A "Blocked people" section with unblock |
| `integration/rls/blocks.test.ts` (create) | The whole point: blocked rows do not come back |
| `integration/rls/reports.test.ts` (create) | Nobody can read `reports`; the RPC works |
| `src/state/__tests__/blocking.test.ts` (create) | Reducer + local filter |

---

## Task 1: The migration

**Files:**
- Create: `supabase/migrations/<timestamp>_reports_and_blocks.sql`

Generate the timestamp with `date -u +%Y%m%d%H%M%S`. Do not hand-write one, and do not
reuse an existing prefix.

- [ ] **Step 1: Write the tables**

```sql
-- Reporting and blocking, which this app has needed since it had a second user.
--
-- Two tables with opposite postures. `blocks` is yours: you must be able to see
-- who you have blocked and undo it, so the owner reads and deletes their own
-- rows. `reports` is nobody's — a readable report table is a list of who
-- accused whom, and the cheapest time not to have one is before it exists. It
-- follows `device_tokens`: RLS on, no policies, no grant, written only through
-- a function.

create table blocks (
  blocker_id  uuid not null references profiles (id) on delete cascade,
  blocked_id  uuid not null references profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  -- Blocking yourself is not a thing anybody means to do, and a self-row would
  -- make `block_between` hide your own content from you.
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

-- The predicate below runs on every row of every feed read, in both directions.
create index blocks_blocked_idx on blocks (blocked_id);

create table reports (
  id            uuid primary key default gen_random_uuid(),
  reporter_id   uuid not null references profiles (id) on delete cascade,
  subject_kind  text not null,
  subject_id    uuid not null,
  reason        text not null,
  created_at    timestamptz not null default now(),
  -- For whoever eventually looks. Null until then, and nothing in the app
  -- reads either.
  resolution    text,
  resolved_at   timestamptz,

  constraint reports_kind_known check (subject_kind in ('task', 'note', 'profile')),
  -- A bounded enum rather than free text. Free text is a field where people
  -- type their own name, someone else's phone number, or a slur — and this
  -- table is the one place the app would then be storing it.
  constraint reports_reason_known check (
    reason in ('harassment', 'spam', 'sexual', 'violence', 'self_harm', 'other')
  )
);

create index reports_open_idx on reports (created_at) where resolved_at is null;

alter table blocks enable row level security;
alter table reports enable row level security;
```

`subject_kind` deliberately omits `'avatar'` — profile photos do not exist yet, and a
constraint that permits a value nothing can produce is a comment pretending to be a
check. The photos work adds it.

- [ ] **Step 2: The visibility helper**

```sql
-- Is there a block between the caller and this person, in either direction?
--
-- Symmetric on purpose. One-way blocking leaves the blocked person free to keep
-- cheering, noting and pairing on somebody who wants nothing to do with them,
-- which is the harm the control exists to stop. The cost is that a block is
-- implicitly discoverable — their cheers stop landing and somebody attentive
-- can infer it. The app never says so; this does not pretend the inference is
-- impossible.
create or replace function private.block_between(other_profile uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = (select auth.uid()) and blocked_id = other_profile)
       or (blocked_id = (select auth.uid()) and blocker_id = other_profile)
  );
$$;
```

- [ ] **Step 3: Amend the SELECT policies**

Five policies expose other people's content. Each must keep showing you **your own**
rows unconditionally — a block must never hide your own work from you — and hide
everyone else's when a block exists.

Read the current definitions first (`supabase/migrations/20260810000000_init.sql:254-333`,
and note `profiles_select` was later replaced in `20260813120745_oz_bots.sql:39`). Drop
and recreate each with the added predicate:

```sql
drop policy tasks_select on tasks;
create policy tasks_select on tasks for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (
      not private.block_between(owner_id)
      and (
        aud = 'everyone'
        or (aud = 'friends' and private.shares_circle_with(owner_id))
        or (aud = 'private' and private.is_paired_on(id))
      )
    )
  );
```

Apply the same shape to `notes_select` (guard on `author_id`), `reactions_select`
(guard on `actor_id`), and `profiles_select` (guard on `id`, and **leave the `is_bot`
branch alone** — bots cannot be blocked and a new account must still resolve their
names). `notifications_select` needs thought rather than a mechanical edit: a
notification names an actor in its payload rather than a column, so check the real shape
before writing the predicate, and if it cannot be expressed cleanly say so rather than
guessing.

**`week_rollups_select` is deliberately left alone.** Rollups are the numbers behind
circle rankings, and the spec decided a blocked circle member still counts toward circle
totals. Filtering them here is what would make the maths per-viewer.

- [ ] **Step 4: The three RPCs**

Follow `register_device` exactly — `security definer`, `set search_path = ''`,
`auth.uid()` read internally, and the revoke at the end.

```sql
create or replace function public.report_content(
  p_subject_kind text,
  p_subject_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- Deliberately not deduplicated. Two reports of the same thing from the same
  -- person is a signal, not a mistake, and silently swallowing the second would
  -- make the app look like it did nothing.
  insert into public.reports (reporter_id, subject_kind, subject_id, reason)
  values (me, p_subject_kind, p_subject_id, p_reason);
end;
$$;

create or replace function public.block_person(p_blocked uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  insert into public.blocks (blocker_id, blocked_id)
  values (me, p_blocked)
  on conflict do nothing;
end;
$$;

create or replace function public.unblock_person(p_blocked uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.blocks
  where blocker_id = auth.uid() and blocked_id = p_blocked;
end;
$$;

revoke execute on function public.report_content(text, uuid, text) from public, anon;
revoke execute on function public.block_person(uuid) from public, anon;
revoke execute on function public.unblock_person(uuid) from public, anon;
```

- [ ] **Step 5: One policy on `blocks`, and none on `reports`**

```sql
-- You can see and undo your own blocks. Nobody can read rows naming them as the
-- blocked party: being blocked is not something this app announces.
create policy blocks_select on blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
```

No insert or delete policy — both go through the RPCs. No policy at all on `reports`.

- [ ] **Step 6: Apply and verify**

```bash
npm run db:start
npm run db:reset
```

Expected: migrations apply cleanly, seed runs. If `db:reset` fails, the migration is
wrong — fix it rather than editing an applied migration by hand.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/
git commit -m "A table for what people report, and one for who they will not see"
```

---

## Task 2: Integration tests — the part that actually matters

**Files:**
- Create: `integration/rls/blocks.test.ts`
- Create: `integration/rls/reports.test.ts`

These come **before** any client code. Everything valuable in this feature is enforced by
the database, and the unit suite structurally cannot test it.

- [ ] **Step 1: Read an existing integration test**

Read `integration/rls/tasks.test.ts` and `integration/rls/device_tokens.test.ts` in full
before writing. They establish how users are created, how clients are made for each, and
the assertion style. Follow it; do not invent a second harness.

- [ ] **Step 2: Write `integration/rls/blocks.test.ts`**

Cover, each as its own test:

- A blocks B. B's `aud = 'everyone'` task no longer comes back for A.
- **Symmetry:** A's task no longer comes back for B either.
- A's *own* tasks still come back for A. (The regression that would make this feature
  hide your week from you.)
- B's notes on a shared task no longer come back for A — **including notes written
  before the block**, which is the retroactive rule.
- B's reactions no longer come back for A.
- B's profile row no longer comes back for A.
- **A bot's profile still comes back** for an account with no circle. Bots cannot be
  blocked, and this is the row that stops a new account rendering "Someone".
- **`week_rollups` still come back** — deliberately unfiltered, so circle totals stay
  consistent for everyone.
- A cannot read `blocks` rows where A is the *blocked* party.
- Unblocking restores visibility both ways.

- [ ] **Step 3: Write `integration/rls/reports.test.ts`**

- `report_content` inserts a row as the caller.
- A signed-in user gets **zero rows** selecting from `reports`, including one they filed
  themselves.
- A user cannot insert into `reports` directly.
- The reason and kind constraints reject an unknown value.
- `anon` cannot execute any of the three RPCs.

- [ ] **Step 4: Run**

```bash
npm run test:integration
```

Expected: all pass. If a block test passes before you have written the policy change,
the test is wrong — verify it fails against the pre-migration schema.

- [ ] **Step 5: Commit**

```bash
git add integration/
git commit -m "Prove the block happens in the database, not in the client"
```

---

## Task 3: Transport

**Files:**
- Modify: `src/sync/transport.ts`

- [ ] **Step 1: Add the WireOp members**

Beside `device.register`, which is the closest precedent — note its comment explaining
why it carries no owner:

```ts
  // No reporter or blocker id, for the same reason `device.register` carries no
  // `profile_id`: the RPC reads `auth.uid()` itself, so there is no owner for a
  // payload to name and therefore none to forge.
  | { id: string; at: number; op: 'report.file'; subjectKind: 'task' | 'note' | 'profile'; subjectId: string; reason: ReportReason }
  | { id: string; at: number; op: 'block.add'; blockedId: string }
  | { id: string; at: number; op: 'block.remove'; blockedId: string }
```

with `export type ReportReason = 'harassment' | 'spam' | 'sexual' | 'violence' | 'self_harm' | 'other';`

- [ ] **Step 2: Add the push cases and `pullBlocks`**

Push each via `.rpc(...)`, mirroring how `device.register` is pushed. Add
`pullBlocks(userId: string): Promise<string[]>` to the `Transport` type and implement it
as a plain select of `blocked_id` from `blocks` — RLS already scopes it to the caller.

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck && npm test
git add src/sync/transport.ts
git commit -m "Teach the wire to carry a report and a block"
```

---

## Task 4: State and the local filter

**Files:**
- Modify: `src/state/store.tsx`, `src/state/selectors.ts`, `src/sync/engine.ts`
- Create: `src/state/__tests__/blocking.test.ts`

- [ ] **Step 1: Write the failing tests first**

`src/state/__tests__/blocking.test.ts` — the reducer and the local filter. Note what
these can and cannot prove: they cover the **offline** half, where the block must work
before a round trip. They do not prove the block; Task 2 does that. Say so in the file's
block comment so nobody later mistakes this for the real coverage.

Cover: `BLOCK` adds an id and is idempotent; `UNBLOCK` removes it; `BLOCKS_PULLED`
replaces the list wholesale; a blocked author's moments, notes and cheers are filtered
from the feed selectors; **your own content is never filtered**; blocking does not remove
the person from `circleMembers` (the decided behaviour, and the one most likely to be
"fixed" by a later reader who thinks it is a bug).

- [ ] **Step 2: Implement**

`blocked: string[]` on `State`, initial `[]`, added to `PERSISTED_KEYS` — a block must
survive a relaunch offline. **That means a `VERSION` bump in
`src/state/persistence.ts`**, which discards rather than migrates, so an existing install
loses its local state on upgrade. Note it in the PR.

Filter in `src/state/selectors.ts` where the feed is assembled, not at each call site.

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck && npm test && npx expo lint
git add src/state/ src/sync/engine.ts
git commit -m "Make the block work before the round trip"
```

---

## Task 5: The report sheet

**Files:**
- Create: `src/overlays/ReportSheet.tsx`
- Modify: `src/state/store.tsx` (a `reportTarget` slice), `src/App.tsx`
- Create: `src/overlays/__tests__/ReportSheet.test.tsx`

- [ ] **Step 1: Tests first**

Reason picker renders all six; choosing one and confirming files the report and hides the
content; blocking is a **separate** confirmed step, not bundled; cancelling does nothing;
offline still files (it queues).

- [ ] **Step 2: Implement**

A bottom sheet in the shape of `DetailSheet`, reusing `Overlay`. Copy rules from the
spec, and they matter here more than anywhere else in the app:

- Plain, not warm. This is the one flow where the house voice reads as insincere.
- Say what happened — hidden, filed. **Do not promise review.**
- Do not thank them for making the community better.
- The block confirm must say the circle is separate and name how to leave it, or the
  block will look broken when the person is still on the podium.

- [ ] **Step 3: Verify and commit**

---

## Task 6: Entry points and the blocked list

**Files:**
- Modify: `src/overlays/DetailSheet.tsx`, `src/overlays/SettingsOverlay.tsx`
- Create: `src/overlays/__tests__/reportEntry.test.tsx`

- [ ] **Step 1: Tests first**

The task sheet offers "Report this"; the person sheet offers report and block; Settings
lists blocked people and unblocks them; the list's empty state exists and reads as
normal rather than congratulatory.

- [ ] **Step 2: Implement**

**One unobtrusive control per surface, not a button on every card.** HANDOFF's engagement
row is at its density limit and this must not become a fourth icon beside 🔥 and 💬.

The Settings section is a plain list following the existing `Section` / `Card` idiom in
that file.

- [ ] **Step 3: Verify and commit**

---

## Task 7: Documentation

**Files:** `docs/backend.md`, `TESTING.md`

- [ ] Document both tables and the amended policies in `docs/backend.md`, in its
  existing voice — including *why* `week_rollups` is unfiltered and why the block is
  symmetric.
- [ ] Add a `TESTING.md` Known-limits bullet: reports are filed and nothing reads them;
  a blocked circle member still counts toward circle totals; blocking is inferable.
- [ ] Commit.

---

## Task 8: The gate

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run test:integration` (needs Docker)
- [ ] **Mutation-test the block predicate**, by hand, recording evidence:

| # | Mutation | Must be caught by |
|---|---|---|
| 1 | `private.block_between`: drop the second (reverse) direction | the symmetry test |
| 2 | `tasks_select`: remove `not private.block_between(owner_id)` | the hidden-task test |
| 3 | `tasks_select`: move the block guard so it also gates `owner_id = auth.uid()` | "your own tasks still come back" |
| 4 | `notes_select`: remove the guard | the retroactive-notes test |
| 5 | `profiles_select`: let the guard cover the `is_bot` branch | the bot-still-visible test |
| 6 | local filter in `selectors.ts`: return the list unfiltered | the offline filter test |
| 7 | `blocks_select`: change `blocker_id` to `blocked_id` | "cannot read rows naming you as blocked" |

Mutation 3 is the one that would ship a feature that hides your own week from you.
Mutation 5 would make a new account render "Someone" for the Oz bots.

- [ ] PR, and merge on green.

---

## Self-review notes

Spec coverage checked: both tables (Task 1), the no-read posture on `reports` (Tasks 1,
2), symmetric blocking (Task 1 Step 2, tested Task 2), retroactive notes (Task 2),
circle membership preserved (Task 1 Step 3's deliberate `week_rollups` omission, tested
Task 4), server-side filtering (Task 1), local filtering for offline (Task 4), bounded
reason enum (Task 1), entry points (Task 6), copy rules (Task 5), integration-not-unit
(Task 2's preamble).

Naming is consistent throughout: `blocks`, `reports`, `private.block_between`,
`report_content`, `block_person`, `unblock_person`, `report.file`, `block.add`,
`block.remove`, `pullBlocks`, `BLOCK`, `UNBLOCK`, `BLOCKS_PULLED`, `blocked`.
