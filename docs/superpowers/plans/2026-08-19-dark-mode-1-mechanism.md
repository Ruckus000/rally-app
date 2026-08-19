# Dark Mode, PR 1: The Mechanism

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the palette swappable at runtime without changing a single pixel, so the remaining five PRs can migrate one area at a time under a rule anyone can check: *nothing may look different.*

**Architecture:** A `ThemeProvider` at the root supplies a palette through context; `useColors()` reads it. The existing `color` export stays exactly as it is, so the 31 files that import it keep compiling untouched — the two coexist for the whole migration and the static one is removed in PR 6.

**Tech Stack:** React 19 context, React Native 0.86 / Expo 57, TypeScript, Jest.

**Spec:** `docs/superpowers/specs/2026-08-19-dark-mode-design.md` — read the sequencing section.

---

## The rule for this PR and the four after it

**Nothing may look different.** There is one palette, the current light one, byte-identical. If any rendered colour changes, the change is wrong.

That is what makes these PRs reviewable: a reviewer does not have to check 470 token swaps against a design, only that the palette is unchanged and the wiring is right.

---

## Background

- `CLAUDE.md`: no path aliases; `src/theme/tokens.ts` holds every design value and **nothing else hardcodes one**; every file opens with an explanatory block comment.
- `design-reference/HANDOFF.md` is authoritative for the values themselves. This PR changes none of them.
- Measured on `main`: 31 files import tokens; 472 `color.*` reads; 62 `onDark.*`.
- The app has no navigation library. The root is `src/App.tsx` → `StoreProvider` → `Shell`.

### Why not a mutable module object

The tempting version — swap the fields on `color` at launch — is wrong and must not be built. Module scope captures values: `SettingsOverlay`'s `cardBox`, `LedgerOverlay`'s `closeButton` and every other module-level style object would freeze whichever palette was active at import. The bug only appears on a live toggle, which is the worst possible time to find it.

---

## Task 1: The provider and the hook

**Files:** create `src/theme/ThemeProvider.tsx` and `src/theme/__tests__/theme.test.tsx`; modify `src/theme/tokens.ts`.

- [ ] **Step 1: Write the failing test.**

  - `useColors()` returns the light palette by default.
  - It returns every key `color` has — assert by comparing key sets, so a palette that forgets one fails here rather than rendering `undefined` somewhere.
  - **The default palette is value-identical to the exported `color`.** This is the test that enforces "nothing looks different" for the whole migration; write it as a deep equality against `color` itself, not a hand-copied literal.
  - A component under a provider with an explicit scheme gets that scheme's palette.
  - `useColors()` outside a provider returns the light palette rather than throwing — a screen rendered in a test without the provider must not explode.

- [ ] **Step 2: Restructure `tokens.ts` minimally.**

  Introduce `lightColors` as the single source of the current values, and keep `export const color = lightColors` so every existing import is untouched. **Do not reorder, rename, or reformat any value.** The diff on the values themselves should be zero.

- [ ] **Step 3: The provider.**

  ```tsx
  export type Scheme = 'light' | 'dark';
  export type Palette = typeof lightColors;
  ```

  A context defaulting to `lightColors`. `ThemeProvider` takes an optional explicit `scheme` (tests and, later, the user's override) and otherwise follows `useColorScheme()`. **In this PR, `dark` resolves to the light palette** — there is no dark palette yet, and inventing half of one here is how a migration PR starts changing pixels.

  Shape it so `yearLevelColor`, `personTints` and `hairlineGradient` can join later without a second migration: the context value should be a palette *object* with room for them, not a bare colour map. Say in the comment that they are deliberately not moved yet.

- [ ] **Step 4:** run tests, typecheck, lint. Commit: `A palette you can swap, holding the one we have`

---

## Task 2: Mount it

**Files:** modify `src/App.tsx`; modify `src/theme/__tests__/theme.test.tsx`.

- [ ] Wrap `Shell` in `ThemeProvider`, outside `StoreProvider` — the palette is a device fact, not account state, and nothing in the store reads it.
- [ ] A test that the real `App` renders with a palette available.
- [ ] **Confirm no snapshot, screenshot or colour assertion anywhere in the suite changed.** If one did, something moved and the PR is wrong.
- [ ] Commit: `Put the palette where every screen can reach it`

---

## Task 3: Migrate the leaves, as proof

**Files:** `src/components/primitives.tsx`, `src/components/Banner.tsx`, `src/screens/BootScreen.tsx`, `src/shell/TabBar.tsx` (5, 5, 4 and 6 reads).

Deliberately the smallest files. The point is to prove the mechanism against real components — including the two shapes that will bite later — not to make progress on volume.

- [ ] **Step 1:** migrate each to `useColors()`.

- [ ] **Step 2: the two hard shapes.** Expect both in these files and solve them here, where the diff is small:

  - **A module-level style object that reads `color`.** It must become a function of the palette, or move inside the component. Pick one and apply it consistently for the rest of the migration — later PRs will follow whatever this establishes, so say which you chose and why.
  - **A default parameter reading `color`** (`primitives.tsx` has `color: c = color.ink`). A hook cannot be called in a parameter default; resolve it in the body.

- [ ] **Step 3:** tests asserting these components render identically under the provider. If existing tests already cover them, confirm they still pass **unchanged** — an existing test needing an edit is a signal something moved.

- [ ] **Step 4:** commit: `Move the leaves onto the hook, and settle the two awkward shapes`

---

## Task 4: Stop the count growing

**Files:** `eslint.config.js`.

- [ ] A rule forbidding raw hex and `rgba(` literals in `src/`, outside `src/theme/`. The migration takes several PRs, and without this the 472 grows underneath it.
- [ ] Expect existing violations. **Report the count and list them; do not fix them in this PR** unless there are only one or two — a mechanism PR that also fixes twenty unrelated hardcoded colours is two PRs.
- [ ] If violations are numerous, land the rule as a warning with a comment saying it becomes an error in PR 6.
- [ ] Commit: `Stop the hardcoded colours growing while we move them`

---

## Task 5: The gate

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run test:integration` — nothing here touches SQL, but run it; the gate is only meaningful if it runs when you expect it to pass.
- [ ] **Mutation-test the one guard that matters:**

| # | Mutation | Must be caught by |
|---|---|---|
| 1 | Change one value in `lightColors` | the palette-identity test |
| 2 | Make `useColors()` outside a provider throw | the no-provider test |
| 3 | Make the `dark` scheme return a different object | the "dark resolves to light for now" test |

Mutation 1 is the important one: it is the test standing between this migration and a PR that silently changes a colour.

- [ ] **Confirm the app still renders identically.** `npx expo export --platform ios` must bundle. State plainly that no visual verification was done beyond the test suite, unless you actually ran the app.
- [ ] PR, and merge on green.
