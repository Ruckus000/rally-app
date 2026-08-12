# Wave C — the identity you set, and the circle you can actually invite into

## Context

Waves A and B are merged. Your name now reaches `profiles.name`, and a live account can create or join a circle through the real RPCs. Both were verified against hosted.

Neither is visible where it counts. Three findings, all from reading where identity is *displayed* rather than where it is stored:

| # | Finding | Evidence |
|---|---|---|
| **1** | The Me screen shows **someone else's name to everyone**. Wave A wrote your name to the server and the directory; the one screen whose job is your identity reads neither | [MeScreen.tsx:64](../src/screens/MeScreen.tsx:64) renders `ME.name` — the fixture `'Alex Rivera'` / `'@alexrivera'` |
| **2** | The invite link is a **dead code**, and Copy copies nothing | [DetailSheet.tsx:450](../src/overlays/DetailSheet.tsx:450) shows `ME.inviteLink` = `rally.app/join/basement-9x2`. That code was deliberately rotated away by `close_circle_join_hole`, and `circles_invite_code_entropy` now makes its shape impossible. The button dispatches a toast and touches no clipboard |
| **3** | Anyone already called "Someone" stays that way | No rename surface. Reachable in two taps: "Get started" flips you live, one back press hits `SKIP_ONBOARD`, which [keeps the account you already chose](../src/state/store.tsx:743) |

**Finding 2 is the one that matters.** `InviteSheet` is the *only* invite surface in the app, reached from the Circle tab's "A circle of one" empty state. Wave B mints a real high-entropy code and there is no way to give it to anyone. A circle nobody can join is inert — this is what blocks the two-device test at the product level, not the schema.

**Outcome:** your own name and circle on the Me screen, a real invite code you can actually send, and a way to fix a name that is already wrong.

---

## Principles applied

Ordered YAGNI → KISS → SRP → DRY, with the calls that went the other way called out.

### Rejected as YAGNI

- **`Person.handle`.** `rowToPerson` drops the handle today. Carrying it through would mean a field, a mapper change and a merge path — to display `anon_6e8dd5641ace`, which is machine noise, not an identity. Demo keeps `ME.handle`; **live shows the circle name, or nothing.** Consistent with hiding the handle preview on the onboarding Identity screen for the same reason.
- **Persisting the circle slice.** It is server-derived and refetched on launch and on foreground. Not persisting avoids a new `isSound` validator and the VERSION question entirely. Cost: the invite code is blank for one pull on a cold offline start — a share action you could not complete offline anyway.
- **Multi-circle support.** The schema allows many; every screen has always assumed one. Take the first and document it.
- **Renaming on demo accounts.** There is nowhere honest to put it and nobody asked. Live only, which also keeps the demo pixel-identical.
- **Deep links.** `rally.app/join/<code>` implies a website that does not exist. Show the code itself.
- **Editing a circle's name.**

### Rejected as KISS — no new native dependency

The Copy button needs a clipboard, and there is no clipboard package. `expo-clipboard` is a **native module**: adding it invalidates the installed dev-client build and forces a rebuild before anything can be tested again.

Instead: React Native's built-in **`Share`** API, which is core, needs no rebuild — and is a better fit, since the actual task is *sending a friend a code*, not putting it on a pasteboard. The code itself becomes `selectable` so manual copy still works.

### Where each rule lives (SRP)

- **Identity resolution stays in `people.ts`.** `MeScreen` reads the resolver; it must not read `ME` for anything a live account has an answer for. This is the fix for finding 1, and the rule that stops it recurring.
- **`pullCircle` and `pullMyCircle` stay separate functions.** One answers "who shares a circle with me", the other "which circle am I in". Folding them would fail the *describe it without "and"* test, and they have different shapes and different consumers.
- **The rename needs no sync code at all.** Wave A's `observe` already watches `people[selfId].name` and enqueues `profile.update` on any change. A rename is therefore a reducer action plus an input — the push is already built and already tested. This is the single biggest simplification in the wave, and it exists because Wave A watched the directory rather than special-casing onboarding.
- **`Share` is called from the UI edge**, not from transport. Sending a string to the OS is not data access.

### DRY, where the repeats are real

- `NAME_MAX` (`people.ts`) is already the one bound, imported by persistence and the onboarding input. The rename input imports the same constant — third real consumer.
- The circle row has **two** consumers (the invite code, and the Me screen's circle name), which meets the 2–3 threshold for a slice rather than two ad-hoc reads.
- `createCircle` from Wave B is reused as-is by the sheet. No second creation path.

---

## The work

### 1. The Me screen shows you

- **`src/screens/MeScreen.tsx`** — replace `ME.name` with `people.name(state.selfId)` and the avatar label with the same. The subtitle line becomes: demo → `ME.handle · CIRCLE_NAME` as today; live → the circle name from the new slice, or nothing when you are in none.
- The `world.members.length > 1` gate must become `circleMembers(state).length > 1`. `world` is `FRESH` on a live account, so the current gate is always false there regardless of who is in your circle.
- `ME` stays for the demo. It is a fixture and this is a fixture-backed demo; the bug was using it on the path that has real data.

### 2. A real invite code

- **`src/sync/transport.ts`** — `pullMyCircle(userId)`: the caller's `circle_members` row, then the `circles` row, returning `{ id, name, inviteCode } | null`. First circle only.
- **`src/state/store.tsx`** — `circle` added to `State` and to `ServerMerge`, folded in `SERVER_MERGE`, returned by identity when unchanged. Cleared on account change alongside the outbox. Not persisted (see YAGNI).
- **`src/sync/engine.ts`** — one more read in the existing `Promise.all`, contributing to `merge` only when it differs.
- **`src/overlays/DetailSheet.tsx`** — `InviteSheet` renders the real code, `selectable`, with **Share** replacing the fake Copy. Three states, all honest:
  - a circle → the code, and Share.
  - no circle yet → a name field and Create, calling Wave B's `createCircle`. **This is the judgement call in the wave**: the alternative is an empty state that is a dead end, since onboarding is otherwise the only place a circle can be made and a solo account can never reach one again.
  - not signed in (demo) → today's behaviour, minus the dead link.

### 3. A name you can fix

- **`src/state/store.tsx`** — `RENAME_SELF { name }`: writes the trimmed, bounded name into the directory under `selfId`. Nothing else. The engine sees the directory move and queues the push.
- **`src/screens/MeScreen.tsx`** — tapping your name on the identity card opens an inline `TextInput` bounded by `NAME_MAX`; submitting dispatches `RENAME_SELF`. Local component state, no new overlay and no new sheet variant.
- Live only. On demo the name is a fixture and the affordance would promise something it cannot keep.

---

## Verification

Gate per the standing process: typecheck, lint, unit, integration, security review, PR, merge on green. Baseline **420 unit + 215 integration**.

- **Mutation-test each guard**, and check the new tests are not vacuous — the Wave A echo test passed with its guard deleted because both names matched, and that is the failure mode to watch for here too.
- **The rename is the sharpest test available**, because it exercises Waves A and C together: dispatch `RENAME_SELF`, assert `profiles.name` on the fake changed, with no new sync code involved.
- **A control for the Me screen**: a live account with a name renders it, *and* a demo account still renders `ME.name`. Without the second, replacing the fixture everywhere would pass.
- **A control for the invite sheet**: the code shown is the one `create_circle` minted — asserted against the row, not against a literal, so it cannot pass on a hardcoded string.
- **Integration**: `pullMyCircle` against the seeded world — maya sees a circle she is in; jordan sees his own, not hers.
- **On device**, once the second simulator is granted: create a circle on A, read the code off the Me screen, join from B, and watch the two accounts see each other. That is the two-device test, and this wave is the last thing it needs.

## Risks

- **`SKIP_ONBOARD` into live** leaves an account with no name until it is renamed. This wave gives it the cure but not the prevention; whether onboarding should refuse to leave without a name is a product call, not a bug fix.
- **Not persisting the circle** means the invite code is briefly absent on a cold start. If that proves annoying it is a small, additive change later — the seam is the `circle` slice either way.
- **The Share sheet is untestable in jest** beyond asserting the call was made with the code. The string it carries is asserted; the OS sheet is not.
