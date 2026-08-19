# Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a signed-in Rally account one reachable place to see who it is, rename itself, check notification permission, secure itself with Apple, and sign out — closing the hole where a live account could not sign out or reach the recovery flow without deleting the app.

**Architecture:** A full-screen overlay behind new reducer state (`settingsOpen`), rendered conditionally in `src/App.tsx` beside Plan / Ledger / Notifications. There is no navigation library and none is added. Sign-out reuses the recovery flow that already exists but is unreachable: a new `SIGN_OUT` action returns state to `initialState`, whose `onboardStep` is `'onboarding'`, which puts the Welcome screen and its working `recoverWithApple` back on screen. The two risky pieces — the visibility guards and the sign-out sequence — are extracted into pure/near-pure modules so they can be tested and mutation-tested without rendering.

**Tech Stack:** React Native 0.86 / Expo 57 / React 19, TypeScript, `useReducer` + Context (no redux/zustand), `@testing-library/react-native`, Jest (`--selectProjects unit`).

**Spec:** `docs/superpowers/specs/2026-08-19-settings-page-design.md`

---

## Background an engineer new to this repo needs

Read these before starting. They are short and they will save you from three wrong turns.

- **`CLAUDE.md`** — the repo's own rules. The ones that bite here: no path aliases (all
  imports relative, there is no `@/`), no navigation library, every file opens with an
  explanatory block comment, `src/theme/tokens.ts` holds every design value and nothing
  else hardcodes one.
- **`design-reference/HANDOFF.md`** — authoritative for design. The settings page is not
  in it (the prototype has no auth), so it is built from the existing token and
  primitive vocabulary rather than invented: `Bri` for display type, `Sans` for body,
  `Caps` for tracked uppercase labels, `Tap` for anything tappable, 44px minimum hit
  target, never show a bare zero, empty states say something human.
- **The unit-test mock.** `src/__mocks__/@supabase/supabase-js.ts` is auto-applied to
  every unit test with no `jest.mock` call. It has **no RLS and no realtime**. Nothing
  in this plan needs either.
- **Three account modes.** `fresh` and `seeded` are demo modes that make zero network
  calls; only `live` touches the server. Most of the settings page's conditional
  rendering is about this distinction.

### Why sign-out is not `RESET`

`RESET` already exists and looks like the right action. It is not: it sets
`onboardStep: null`, and the entire point of this feature is to land on
`onboardStep: 'onboarding'` — the Welcome screen — because `OnboardOverlay` already
contains a working `recoverWithApple` (`src/overlays/OnboardOverlay.tsx:246`) that is
merely unreachable once onboarding completes. Sign-out reuses it instead of building a
second Apple sign-in path.

### Why the order of operations in sign-out matters

`src/state/store.tsx:1647` holds a `lastSelfId` effect: when `selfId` changes it calls
`clearOutbox()` and `teardownRealtime()`. `SIGN_OUT` changes `selfId` back to the demo
sentinel. So dispatching before flushing would destroy the queue of unsent work. Flush
first, then sign out, then dispatch.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/state/store.tsx` (modify) | `settingsOpen` on `State`; `OPEN_SETTINGS`, `CLOSE_SETTINGS`, `SIGN_OUT` actions and their reducer cases |
| `src/overlays/settings/guards.ts` (create) | Pure predicates deciding which account rows render. No React, no async, no I/O — so the mutation testing has somewhere clean to bite |
| `src/overlays/settings/signOut.ts` (create) | The sign-out sequence and its refusal copy. Async, orchestrates outbox + session, returns an outcome rather than dispatching — so it is testable without a store |
| `src/overlays/SettingsOverlay.tsx` (create) | Presentation only: reads state, calls the two modules above, renders rows |
| `src/App.tsx` (modify) | Render `SettingsOverlay` when `state.settingsOpen` |
| `src/screens/MeScreen.tsx` (modify) | A `Settings` row at the foot of the screen. `DevControls` is **not** touched |
| `src/overlays/settings/__tests__/guards.test.ts` (create) | The visibility matrix |
| `src/overlays/settings/__tests__/signOut.test.ts` (create) | The sequence, and the abort that prevents silent data loss |
| `src/overlays/__tests__/SettingsOverlay.test.tsx` (create) | Rendering, routing, and the disabled state |
| `TESTING.md` (modify) | Retire the "no settings page" bullet |

Three small files rather than one overlay, because the two things most likely to be
wrong — who sees the sign-out button, and what happens when the queue is not empty —
should be provable without mounting a component tree.

---

## Task 1: Reducer state for opening and closing the overlay

**Files:**
- Modify: `src/state/store.tsx`
- Test: `src/state/__tests__/settingsRouting.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/state/__tests__/settingsRouting.test.ts`:

```ts
/**
 * Settings is a destination like every other overlay here: reducer state, not a
 * route. These assert it behaves like its siblings — it opens, it closes, and a
 * route to somewhere else takes it off screen rather than leaving it stacked.
 */
import { reducer } from '../store';
import { baseState } from '../../test/baseState';

describe('opening and closing settings', () => {
  it('opens', () => {
    expect(reducer(baseState, { type: 'OPEN_SETTINGS' }).settingsOpen).toBe(true);
  });

  it('closes', () => {
    const open = { ...baseState, settingsOpen: true };
    expect(reducer(open, { type: 'CLOSE_SETTINGS' }).settingsOpen).toBe(false);
  });

  it('is cleared by a route to somewhere else, like every other overlay', () => {
    const open = { ...baseState, settingsOpen: true };
    const next = reducer(open, { type: 'GO_PLACE', patch: { tab: 'circle' } });
    expect(next.settingsOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/state/__tests__/settingsRouting.test.ts
```

Expected: TypeScript/Jest failure — `settingsOpen` is not a property of `State`, and
`OPEN_SETTINGS` is not assignable to `Action`.

- [ ] **Step 3: Add the state field**

In `src/state/store.tsx`, in the `State` type beside the other overlay flags
(`planOpen`, `wrapOpen`, `notifOpen` — around line 259):

```ts
  /**
   * Account settings. An overlay like the others, and like the others it is a
   * fact about this session rather than about the account — so it is not in
   * `PERSISTED_KEYS` and reopening the app never lands you inside it.
   */
  settingsOpen: boolean;
```

In `initialState` (around line 319, beside `planOpen: false`):

```ts
  settingsOpen: false,
```

In `CLEARED` (around line 471), so any overlay-to-overlay route closes it:

```ts
  settingsOpen: false,
```

- [ ] **Step 4: Add the actions**

In the `Action` union (around line 364, beside `OPEN_NOTIF`):

```ts
  | { type: 'OPEN_SETTINGS' }
  | { type: 'CLOSE_SETTINGS' }
```

And the reducer cases, beside `case 'OPEN_NOTIF'` (around line 920):

```ts
    case 'OPEN_SETTINGS':
      return { ...state, settingsOpen: true };

    case 'CLOSE_SETTINGS':
      return { ...state, settingsOpen: false };
```

- [ ] **Step 5: Add the field to the test fixture**

`src/test/baseState.ts` spells out a full `State`, so it will not compile without the
new key. Add beside `planOpen: false`:

```ts
  settingsOpen: false,
```

- [ ] **Step 6: Run the test and the typechecker**

```bash
npm test -- src/state/__tests__/settingsRouting.test.ts && npm run typecheck
```

Expected: 3 passing, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/state/store.tsx src/test/baseState.ts src/state/__tests__/settingsRouting.test.ts
git commit -m "Route to settings the way this app routes to anything"
```

---

## Task 2: The SIGN_OUT action

**Files:**
- Modify: `src/state/store.tsx`
- Test: `src/state/__tests__/signOutAction.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/state/__tests__/signOutAction.test.ts`:

```ts
/**
 * What signing out leaves behind, which is nothing — and specifically it leaves
 * `onboardStep` at 'onboarding'.
 *
 * That last one is the whole feature. `OnboardOverlay` already contains a
 * working Apple recovery flow; it has simply been unreachable once onboarding
 * finished. Landing on 'onboarding' is what makes signing back in possible
 * without deleting the app, so it is asserted here rather than left as a
 * property of `initialState` that someone could change without noticing.
 *
 * The wipe is not incidental either. Recovery deliberately refuses to restore
 * history onto a device that already has some, so leaving local weeks behind
 * would mean signing back in restores nothing.
 */
import { reducer } from '../store';
import { baseState } from '../../test/baseState';
import { SELF_DEMO_ID } from '../../data/people';

const signedIn = {
  ...baseState,
  account: 'live' as const,
  selfId: '11111111-1111-4111-8111-111111111111',
  settingsOpen: true,
};

describe('signing out', () => {
  it('lands on onboarding, which is where the Apple button lives', () => {
    expect(reducer(signedIn, { type: 'SIGN_OUT' }).onboardStep).toBe('onboarding');
  });

  it('forgets the account, which is what stops sync', () => {
    const next = reducer(signedIn, { type: 'SIGN_OUT' });
    expect(next.account).toBeNull();
    expect(next.selfId).toBe(SELF_DEMO_ID);
  });

  it('clears the week, so recovery is allowed to restore one', () => {
    const next = reducer(signedIn, { type: 'SIGN_OUT' });
    expect(next.myTasks).toEqual([]);
    expect(next.history).toEqual([]);
    expect(next.moments).toEqual([]);
  });

  it('closes itself on the way out', () => {
    expect(reducer(signedIn, { type: 'SIGN_OUT' }).settingsOpen).toBe(false);
  });

  it('takes its week from the calendar, not from the stale module literal', () => {
    const next = reducer(signedIn, { type: 'SIGN_OUT' });
    expect(next.day).toBe(next.week.today);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/state/__tests__/signOutAction.test.ts
```

Expected: `SIGN_OUT` is not assignable to `Action`.

- [ ] **Step 3: Implement**

Add to the `Action` union:

```ts
  | { type: 'SIGN_OUT' }
```

And the reducer case, immediately after `case 'RESET'` (which ends around line 1012) so
the two sit together and the comment explains why they are not the same thing:

```ts
    /**
     * Sign out, which is `RESET` with one difference that is the entire point.
     *
     * `RESET` sets `onboardStep: null` — it drops you into the app with a fresh
     * account. This sets it to `'onboarding'`, via `initialState`, because the
     * Welcome screen is where `recoverWithApple` lives. Without that, signing
     * out would be a one-way door and this whole feature would be a way to lose
     * an account rather than a way to leave one.
     *
     * The wipe is required, not merely tidy: the restore path refuses to fill
     * history onto a device that already has some, so anything left behind here
     * would mean signing back in restores nothing.
     *
     * `week` is re-read rather than inherited from `initialState`, which
     * captured the calendar at module load and may be a week stale in a
     * long-lived process.
     */
    case 'SIGN_OUT': {
      const week = liveWeek();
      return { ...initialState, week, day: week.today };
    }
```

`liveWeek` is already imported at line 29. No new import.

- [ ] **Step 4: Run the test**

```bash
npm test -- src/state/__tests__/signOutAction.test.ts && npm run typecheck
```

Expected: 5 passing, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/state/store.tsx src/state/__tests__/signOutAction.test.ts
git commit -m "Sign out to the one screen that can sign you back in"
```

---

## Task 3: The visibility guards

**Files:**
- Create: `src/overlays/settings/guards.ts`
- Test: `src/overlays/settings/__tests__/guards.test.ts`

These are pure functions on purpose. They are the rules that decide whether a person is
offered an irreversible action, and they should be provable without a component tree.

- [ ] **Step 1: Write the failing test**

Create `src/overlays/settings/__tests__/guards.test.ts`:

```ts
/**
 * Who is offered what, stated as a table rather than discovered by rendering.
 *
 * The load-bearing rule: sign-out is offered only to an account that can be got
 * back. An anonymous account that signs out is gone — nothing else holds that
 * uuid — so rather than ship that behind a warning, the control is absent and
 * "Secure this account" stands in its place.
 */
import { canSecure, signOutEnabled, signOutVisible } from '../guards';
import type { SessionState } from '../../../sync/session';

const READY_SECURED: SessionState = { status: 'ready', userId: 'u1', anonymous: false };
const READY_ANON: SessionState = { status: 'ready', userId: 'u1', anonymous: true };
const OFFLINE: SessionState = { status: 'offline' };
const EXPIRED: SessionState = { status: 'expired' };
const OFF: SessionState = { status: 'off' };

describe('signOutVisible', () => {
  it('is offered to a secured live account', () => {
    expect(signOutVisible('live', READY_SECURED)).toBe(true);
  });

  it('is withheld from an anonymous account, which could not come back', () => {
    expect(signOutVisible('live', READY_ANON)).toBe(false);
  });

  it('is withheld from the demo, which has no account to leave', () => {
    expect(signOutVisible('seeded', OFF)).toBe(false);
    expect(signOutVisible('fresh', OFF)).toBe(false);
    expect(signOutVisible(null, OFF)).toBe(false);
  });

  it('stays on screen when the session is unresolved, rather than blinking out', () => {
    expect(signOutVisible('live', OFFLINE)).toBe(true);
    expect(signOutVisible('live', EXPIRED)).toBe(true);
  });
});

describe('signOutEnabled', () => {
  it('is tappable only once the session says the account is secured', () => {
    expect(signOutEnabled(READY_SECURED)).toBe(true);
  });

  it('is not tappable without a resolved session', () => {
    expect(signOutEnabled(OFFLINE)).toBe(false);
    expect(signOutEnabled(EXPIRED)).toBe(false);
    expect(signOutEnabled(OFF)).toBe(false);
  });

  it('is not tappable for an anonymous account even when resolved', () => {
    expect(signOutEnabled(READY_ANON)).toBe(false);
  });
});

describe('canSecure', () => {
  it('is offered to a live anonymous account on iOS', () => {
    expect(canSecure('live', READY_ANON, 'ios')).toBe(true);
  });

  it('is not offered on Android, where there is no provider to reach', () => {
    expect(canSecure('live', READY_ANON, 'android')).toBe(false);
  });

  it('is not offered to an account that is already secured', () => {
    expect(canSecure('live', READY_SECURED, 'ios')).toBe(false);
  });

  it('is not offered to the demo', () => {
    expect(canSecure('seeded', OFF, 'ios')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/overlays/settings/__tests__/guards.test.ts
```

Expected: FAIL — `Cannot find module '../guards'`.

- [ ] **Step 3: Implement**

Create `src/overlays/settings/guards.ts`:

```ts
/**
 * Which account controls a given account is offered.
 *
 * Pure, and separate from the overlay that renders them, because these are the
 * rules that decide whether somebody is shown an irreversible action. A rule
 * that can only be exercised by mounting a screen is a rule that gets tested
 * shallowly, and this is not the place for that.
 *
 * `Platform` is passed in rather than read here for the same reason: the
 * Android case is a real branch with a real consequence, and it should be
 * assertable without a native module.
 */
import type { AccountMode } from '../../data/seed';
import type { SessionState } from '../../sync/session';

/**
 * Whether the sign-out row appears at all.
 *
 * Withheld from an anonymous account, which is the whole safety property here:
 * nothing but that session holds the uuid, so signing out would strand
 * everything the account owns on the server with no way back to it. The row is
 * absent rather than present-and-warned — "Secure this account" occupies the
 * same place and is the action that makes leaving safe.
 *
 * Deliberately still visible when the session is unresolved. `anonymous` is a
 * JWT claim, so an offline device cannot tell secured from anonymous; hiding
 * the row would make it appear and vanish with connectivity, which reads as a
 * bug. It renders disabled instead — see `signOutEnabled`.
 */
export function signOutVisible(account: AccountMode | null, session: SessionState): boolean {
  if (account !== 'live') return false;
  return !(session.status === 'ready' && session.anonymous);
}

/**
 * Whether that row does anything when tapped.
 *
 * Note what is *not* here: the outbox. Gating this on an empty queue would grey
 * the button out for work that the flush is about to send, so the queue is
 * checked after the flush instead, in `attemptSignOut`.
 */
export function signOutEnabled(session: SessionState): boolean {
  return session.status === 'ready' && !session.anonymous;
}

/**
 * Whether to offer Apple linking. Mirrors the rule already applied on the Me
 * profile card; both call the same `linkApple`, so the two cannot drift into
 * offering it in different circumstances.
 */
export function canSecure(
  account: AccountMode | null,
  session: SessionState,
  platform: string,
): boolean {
  if (account !== 'live') return false;
  if (platform !== 'ios') return false;
  return session.status === 'ready' && session.anonymous;
}
```

`AccountMode` is exported from `src/data/seed.ts:48`, so `../../data/seed` is correct
as written. `SessionState` is exported from `src/sync/session.ts`. No new exports are
needed anywhere.

- [ ] **Step 4: Run the test**

```bash
npm test -- src/overlays/settings/__tests__/guards.test.ts && npm run typecheck
```

Expected: 11 passing, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/overlays/settings/guards.ts src/overlays/settings/__tests__/guards.test.ts
git commit -m "State the account rules as functions, not as JSX conditions"
```

---

## Task 4: The sign-out sequence, and the abort that prevents silent loss

**Files:**
- Create: `src/overlays/settings/signOut.ts`
- Test: `src/overlays/settings/__tests__/signOut.test.ts`

This is the riskiest code in the feature. Read the test's block comment before writing
the implementation.

- [ ] **Step 1: Write the failing test**

Create `src/overlays/settings/__tests__/signOut.test.ts`:

```ts
/**
 * The order, and the refusal.
 *
 * `flushOutbox` is best-effort and `signOutEverywhere` deliberately completes
 * locally when it cannot reach the network. Put those two together with a wipe
 * and you get a silent permanent-loss window: sign out in a tunnel with work
 * still queued, and the wipe takes it off the device having never sent it, so
 * signing back in restores everything except the thing you did last. That is
 * exactly the class of bug this whole settings page was opened to remove, so
 * the sequence refuses instead — and the refusal is what these tests are for.
 */
import { attemptSignOut, unsentLine } from '../signOut';
import * as outbox from '../../../sync/outbox';
import * as session from '../../../sync/session';
import type { OutboxEntry } from '../../../sync/outbox';

const entry = (key: string): OutboxEntry =>
  ({ id: key, op: 'task.upsert', key, payload: {}, tries: 0 }) as unknown as OutboxEntry;

describe('attemptSignOut', () => {
  let flush: jest.SpyInstance;
  let pending: jest.SpyInstance;
  let out: jest.SpyInstance;

  beforeEach(() => {
    flush = jest.spyOn(outbox, 'flushOutbox').mockResolvedValue(undefined);
    pending = jest.spyOn(outbox, 'pending').mockReturnValue([]);
    out = jest.spyOn(session, 'signOutEverywhere').mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('flushes before it signs out, so queued work gets its last chance', async () => {
    const order: string[] = [];
    flush.mockImplementation(async () => void order.push('flush'));
    out.mockImplementation(async () => void order.push('signOut'));

    await attemptSignOut();

    expect(order).toEqual(['flush', 'signOut']);
  });

  it('signs out when the queue drained', async () => {
    await expect(attemptSignOut()).resolves.toEqual({ ok: true });
    expect(out).toHaveBeenCalled();
  });

  it('refuses, and does not sign out, when work is still unsent', async () => {
    pending.mockReturnValue([entry('task:a'), entry('task:b')]);

    await expect(attemptSignOut()).resolves.toEqual({ ok: false, unsent: 2 });
    expect(out).not.toHaveBeenCalled();
  });

  it('counts things, not attempts', async () => {
    // One task written and then deleted is two ops about one row. Telling
    // someone two things are unsent when one is would be its own small lie —
    // the same reasoning `unsavedCount` documents.
    pending.mockReturnValue([entry('task:a'), entry('task:a')]);

    await expect(attemptSignOut()).resolves.toEqual({ ok: false, unsent: 1 });
  });
});

describe('unsentLine', () => {
  it('speaks singular without a bare number', () => {
    expect(unsentLine(1)).toContain('One thing');
  });

  it('names the count in the plural', () => {
    expect(unsentLine(3)).toContain('3 things');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/overlays/settings/__tests__/signOut.test.ts
```

Expected: FAIL — `Cannot find module '../signOut'`.

- [ ] **Step 3: Implement**

Create `src/overlays/settings/signOut.ts`:

```ts
/**
 * Leaving an account, in the only order that does not lose anything.
 *
 * 1. Flush the queue, so work already staked gets its last chance to land.
 * 2. Look again. If anything is still unsent, stop — see below.
 * 3. Sign out, which deregisters this device's push token while there is still
 *    a session to do it with.
 *
 * The caller dispatches `SIGN_OUT` only on `{ ok: true }`. That split is
 * deliberate: this module returns an outcome rather than dispatching, so the
 * sequence can be tested without a store, and so the dispatch cannot
 * accidentally happen first — which would change `selfId`, fire the
 * `lastSelfId` effect in `store.tsx`, and clear the outbox before it drained.
 *
 * Step 2 is the one worth defending. `flushOutbox` is best-effort and
 * `signOutEverywhere` completes locally when offline, so without the check a
 * sign-out on a train takes unsent work off the device forever while the server
 * never hears about it. The user is told what is unsent and asked to reconnect,
 * rather than having it discarded on their behalf.
 */
import { flushOutbox, pending } from '../../sync/outbox';
import { signOutEverywhere } from '../../sync/session';

export type SignOutOutcome =
  | { ok: true }
  /** Nothing happened. `unsent` is distinct rows, not queued operations. */
  | { ok: false; unsent: number };

export async function attemptSignOut(): Promise<SignOutOutcome> {
  await flushOutbox();

  // By key, not by entry: the key is the row and the entry is the attempt.
  const unsent = new Set(pending().map((e) => e.key)).size;
  if (unsent > 0) return { ok: false, unsent };

  await signOutEverywhere();
  return { ok: true };
}

/**
 * "Things" rather than "tasks", because an unsent write can equally be a note, a
 * reaction or a name change — the same word `UnsavedBanner` settled on.
 */
export function unsentLine(unsent: number): string {
  return unsent === 1
    ? 'One thing hasn’t reached the server yet. Reconnect and try again — it’d be lost otherwise.'
    : `${unsent} things haven’t reached the server yet. Reconnect and try again — they’d be lost otherwise.`;
}
```

- [ ] **Step 4: Run the test**

```bash
npm test -- src/overlays/settings/__tests__/signOut.test.ts && npm run typecheck
```

Expected: 6 passing, no type errors. If the `OutboxEntry` cast in the test fails to
compile, open `src/sync/outbox.ts:36` and build the fixture from the real shape rather
than widening the cast.

- [ ] **Step 5: Commit**

```bash
git add src/overlays/settings/signOut.ts src/overlays/settings/__tests__/signOut.test.ts
git commit -m "Refuse to sign out over the top of work that never sent"
```

---

## Task 5: The overlay

**Files:**
- Create: `src/overlays/SettingsOverlay.tsx`
- Test: `src/overlays/__tests__/SettingsOverlay.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/overlays/__tests__/SettingsOverlay.test.tsx`:

```tsx
/**
 * What the page shows to each kind of account.
 *
 * Rendered through the real `StoreProvider` with `persist` and `sync` off:
 * nothing here needs a live session, because the guards take the session as a
 * value and the sequence is tested on its own. What is worth asserting here is
 * that the rules reach the screen — in particular that sign-out renders
 * *disabled* rather than absent when the session is unresolved, which is the
 * difference between a control that looks broken and one that explains itself.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StoreProvider } from '../../state/store';
import { SettingsOverlay } from '../SettingsOverlay';
import type { SessionState } from '../../sync/session';

const ME = '11111111-1111-4111-8111-111111111111';

const mount = (restored: Record<string, unknown>) =>
  render(
    <StoreProvider persist={false} sync={false} restored={{ settingsOpen: true, ...restored }}>
      <SettingsOverlay topInset={0} />
    </StoreProvider>,
  );

const live = (session: SessionState) => mount({ account: 'live', selfId: ME, session });

describe('what a demo account sees', () => {
  it('has no sign-out, because there is no account to leave', () => {
    mount({ account: 'seeded' });
    expect(screen.queryByLabelText('Sign out')).toBeNull();
  });

  it('still gets a page, and it says what kind of account this is', () => {
    mount({ account: 'seeded' });
    expect(screen.getByText(/Demo/i)).toBeTruthy();
  });
});

describe('what a secured live account sees', () => {
  it('is offered sign-out', () => {
    live({ status: 'ready', userId: ME, anonymous: false });
    expect(screen.getByLabelText('Sign out')).toBeTruthy();
  });

  it('is not offered Apple linking, having already done it', () => {
    live({ status: 'ready', userId: ME, anonymous: false });
    expect(screen.queryByLabelText(/Secure this account/)).toBeNull();
  });
});

describe('what an anonymous live account sees', () => {
  it('is not offered sign-out, which it could not come back from', () => {
    live({ status: 'ready', userId: ME, anonymous: true });
    expect(screen.queryByLabelText('Sign out')).toBeNull();
  });
});

describe('when the session has not resolved', () => {
  it('shows sign-out disabled rather than removing it', () => {
    live({ status: 'offline' });
    const row = screen.getByLabelText('Sign out');
    expect(row).toBeTruthy();
    expect(row.props.accessibilityState?.disabled).toBe(true);
  });

  it('says why', () => {
    live({ status: 'offline' });
    expect(screen.getByText(/needs a connection/i)).toBeTruthy();
  });
});

describe('closing', () => {
  it('has a close control', () => {
    mount({ account: 'seeded' });
    expect(screen.getByLabelText('Close settings')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/overlays/__tests__/SettingsOverlay.test.tsx
```

Expected: FAIL — `Cannot find module '../SettingsOverlay'`.

- [ ] **Step 3: Implement**

Create `src/overlays/SettingsOverlay.tsx`:

```tsx
/**
 * Account settings — the one place a live account can see who it is and leave.
 *
 * Before this, "Secure this account" was on the Me card, "Reset app data" was
 * behind `__DEV__`, "Start over" appeared only inside an error banner, and
 * "Continue with Apple" was on a Welcome screen unreachable after onboarding.
 * A signed-in account could not sign out, switch accounts, or reach the
 * recovery path without deleting the app.
 *
 * Presentation only. Which rows a given account is offered lives in
 * `settings/guards.ts`, and what signing out actually does lives in
 * `settings/signOut.ts` — both because those are the rules worth proving
 * without a component tree, and because this file should stay readable.
 *
 * Reset app data is deliberately **not** here. It is data loss with no undo,
 * and a row of it directly below Sign out would make two destructive controls
 * read as siblings. It stays in `MeScreen`'s `__DEV__` block.
 */
import React from 'react';
import { Alert, Linking, Platform, ScrollView, TextInput, View } from 'react-native';
import { color, gutter, radius } from '../theme/tokens';
import { Bri, Caps, Sans, Tap, fill, row } from '../components/primitives';
import { Icon } from '../components/Icon';
import { Overlay } from './Overlay';
import { closeButton } from './LedgerOverlay';
import { Trouble } from '../components/Trouble';
import { useStore } from '../state/store';
import { queueProfileName } from '../sync/engine';
import { linkApple } from '../sync/session';
import { appleTrouble } from '../lib/appleCopy';
import { askForReminders, hasReminderPermission } from '../lib/reminders';
import { canSecure, signOutEnabled, signOutVisible } from './settings/guards';
import { attemptSignOut, unsentLine } from './settings/signOut';

export function SettingsOverlay({ topInset }: { topInset: number }) {
  const { state, dispatch, people } = useStore();
  const { account, session } = state;
  const live = account === 'live';
  const close = () => dispatch({ type: 'CLOSE_SETTINGS' });

  const [trouble, setTrouble] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  return (
    <Overlay zIndex={60} background={color.paper} onRequestClose={close}>
      <View
        style={{
          ...row,
          gap: 10,
          paddingTop: Math.max(topInset, 20) + 16,
          paddingHorizontal: gutter,
          paddingBottom: 6,
        }}
      >
        <Bri size={19} weight={800} tracking={-0.3} style={fill}>
          Settings
        </Bri>
        <Tap onPress={close} accessibilityLabel="Close settings" style={closeButton}>
          <Icon name="close" size={16} color={color.ink} />
        </Tap>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: 40, gap: 22 }}
        keyboardShouldPersistTaps="handled"
      >
        <AccountSection />
        {live ? <NameSection /> : null}
        <NotificationsSection />

        {canSecure(account, session, Platform.OS) ? (
          <Section label="Getting back in">
            <Tap
              accessibilityLabel="Secure this account with Apple, so you can sign back in"
              onPress={
                busy
                  ? undefined
                  : () => {
                      setBusy(true);
                      setTrouble(null);
                      void linkApple().then((result) => {
                        setBusy(false);
                        if (!result.ok && result.reason !== 'cancelled') {
                          setTrouble(appleTrouble(result.reason));
                        }
                      });
                    }
              }
              style={rowStyle}
            >
              <Sans size={14} weight={600} style={fill}>
                {busy ? 'Securing…' : 'Secure this account'}
              </Sans>
            </Tap>
            <Sans size={12} color={color.muted} style={{ marginTop: 8 }}>
              Attaches your Apple ID. Nothing changes here — it just means you can sign
              back in on a new phone.
            </Sans>
            <Trouble message={trouble} />
          </Section>
        ) : null}

        {signOutVisible(account, session) ? <SignOutSection /> : null}
      </ScrollView>
    </Overlay>
  );
}

const rowStyle = {
  ...row,
  minHeight: 50,
  backgroundColor: color.card,
  borderRadius: radius.row,
  paddingHorizontal: 14,
  gap: 10,
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Caps size={10} tracking={1.6} color={color.muted} style={{ marginBottom: 8 }}>
        {label}
      </Caps>
      {children}
    </View>
  );
}

/**
 * Who this is, and whether it can be got back.
 *
 * The second half is the part that matters: every destructive control below is
 * legible only once you know whether leaving is reversible. On Android it also
 * has to say why there is no sign-out at all, or the absence reads as a missing
 * feature rather than as the deliberate consequence of Apple sign-in being
 * iOS-only.
 */
function AccountSection() {
  const { state } = useStore();
  const { account, session } = state;

  const line = (): string => {
    if (account !== 'live') return 'Demo account. Nothing here reaches a server.';
    if (session.status !== 'ready') return 'Signed in. Checking this account…';
    if (!session.anonymous) return 'Signed in, and this account can be got back with Apple.';
    return Platform.OS === 'ios'
      ? 'Signed in, but this account can’t be got back yet. Secure it below and you can sign back in on a new phone.'
      : 'Signed in, but this account can’t be got back — signing in with Apple is iOS-only for now. That’s also why there’s no sign-out here: there’d be no way back.';
  };

  return (
    <Section label="Account">
      <View style={{ ...rowStyle, paddingVertical: 12, alignItems: 'flex-start' }}>
        <View style={fill}>
          <Sans size={14} weight={600}>
            {account === 'live' ? 'Live' : 'Demo'}
          </Sans>
          <Sans size={12} lineHeight={17} color={color.muted} style={{ marginTop: 4 }}>
            {line()}
          </Sans>
          {account === 'live' && session.status === 'ready' ? (
            <Caps size={9.5} tracking={1.2} color={color.faintInk} style={{ marginTop: 8 }}>
              {`ID ${session.userId.slice(0, 8)}`}
            </Caps>
          ) : null}
        </View>
      </View>
    </Section>
  );
}

/**
 * The same rename the Me card offers, given a label so it can be found.
 *
 * Same `RENAME_SELF` and same `queueProfileName` in the same tick — this is a
 * second entry point to one behaviour, not a second implementation of it.
 */
function NameSection() {
  const { state, dispatch, people } = useStore();
  const current = people.name(state.selfId);
  const [draft, setDraft] = React.useState(current);

  const commit = () => {
    dispatch({ type: 'RENAME_SELF', name: draft });
    queueProfileName(draft);
  };

  return (
    <Section label="Your name">
      <View style={rowStyle}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={commit}
          onSubmitEditing={commit}
          returnKeyType="done"
          selectionColor={color.lime}
          accessibilityLabel="Your name"
          style={{ flex: 1, fontFamily: 'InstrumentSans_600SemiBold', fontSize: 14, color: color.ink, paddingVertical: 0 }}
        />
      </View>
      <Sans size={12} color={color.muted} style={{ marginTop: 8 }}>
        This is the name your circle sees.
      </Sans>
    </Section>
  );
}

/**
 * Permission state, and a way to the only place it can actually be changed.
 *
 * Once the OS has been asked, it cannot be asked again — so past that point the
 * honest affordance is a jump to system settings rather than a switch that
 * would silently do nothing.
 */
function NotificationsSection() {
  const [granted, setGranted] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let alive = true;
    void hasReminderPermission().then((ok) => {
      if (alive) setGranted(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const ask = () => {
    void askForReminders().then((result) => setGranted(result === 'granted'));
  };

  return (
    <Section label="Notifications">
      <Tap
        accessibilityLabel={granted ? 'Open notification settings' : 'Turn on notifications'}
        onPress={granted === false ? ask : () => void Linking.openSettings()}
        style={rowStyle}
      >
        <Sans size={14} weight={600} style={fill}>
          {granted === null ? 'Checking…' : granted ? 'On' : 'Off'}
        </Sans>
        <Sans size={12} weight={600} color={color.moss}>
          {granted === false ? 'Turn on' : 'Change'}
        </Sans>
      </Tap>
      <Sans size={12} color={color.muted} style={{ marginTop: 8 }}>
        Nudges only arrive when someone is actually waiting on you. Cheers batch into one.
      </Sans>
    </Section>
  );
}

/**
 * Leaving.
 *
 * Rendered disabled rather than hidden when the session has not resolved:
 * `anonymous` is a JWT claim, so an offline device cannot tell a secured
 * account from one that could never come back. A control that appears and
 * vanishes with signal reads as a bug; one that is present and explains itself
 * does not.
 */
function SignOutSection() {
  const { state, dispatch } = useStore();
  const enabled = signOutEnabled(state.session);
  const [busy, setBusy] = React.useState(false);

  const go = () => {
    setBusy(true);
    void attemptSignOut().then((outcome) => {
      setBusy(false);
      if (outcome.ok) {
        dispatch({ type: 'SIGN_OUT' });
        return;
      }
      Alert.alert('Not yet', unsentLine(outcome.unsent), [{ text: 'OK' }]);
    });
  };

  const confirm = () =>
    Alert.alert(
      'Sign out of this account?',
      'This device is cleared — your week, your circle and your history stay on the server. Sign back in with Apple and they come back.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: go },
      ],
      { cancelable: true },
    );

  return (
    <Section label="Leaving">
      <Tap
        accessibilityLabel="Sign out"
        accessibilityState={{ disabled: !enabled || busy }}
        onPress={enabled && !busy ? confirm : undefined}
        style={{ ...rowStyle, opacity: enabled ? 1 : 0.5 }}
      >
        <Sans size={14} weight={600} style={fill}>
          {busy ? 'Signing out…' : 'Sign out'}
        </Sans>
      </Tap>
      <Sans size={12} color={color.muted} style={{ marginTop: 8 }}>
        {enabled
          ? 'You’ll come back to the welcome screen. Continue with Apple signs you back in.'
          : 'Signing out needs a connection.'}
      </Sans>
    </Section>
  );
}
```

One thing to fix as you type it: the top-level `SettingsOverlay` destructures `people`
and never uses it (the rename lives in `NameSection`, which reads the store itself).
Drop it from the destructure or `npm run lint` will flag it.

The icon set is a closed union — `bell`, `check`, `chevronLeft`, `close`, `plus`,
`comment`, `heart`, `send`, `week`, `circle`, `me`, `due`, `streak`, `wrap`
(`src/components/Icon.tsx:8`). There is no `chevron`, which is why the rows above carry
no trailing glyph. If you want one, `chevronLeft` is the only near fit and it points the
wrong way — leave it out rather than adding to the set for decoration.

- [ ] **Step 4: Run the test**

```bash
npm test -- src/overlays/__tests__/SettingsOverlay.test.tsx && npm run typecheck && npm run lint
```

Expected: 8 passing, no type errors, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/overlays/SettingsOverlay.tsx src/overlays/__tests__/SettingsOverlay.test.tsx
git commit -m "Give the account one page it can be seen and left from"
```

---

## Task 6: Reaching it

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/screens/MeScreen.tsx`
- Test: `src/screens/__tests__/settingsEntry.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/screens/__tests__/settingsEntry.test.tsx`:

```tsx
/**
 * The row that makes the page exist as far as anyone using the app is
 * concerned. An overlay nothing opens is an overlay nobody has.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StoreProvider, useStore } from '../../state/store';
import { MeScreen } from '../MeScreen';

let settingsOpen = false;

function Harness() {
  const { state } = useStore();
  settingsOpen = state.settingsOpen;
  return <MeScreen />;
}

const mount = (account: 'live' | 'seeded') =>
  render(
    <StoreProvider persist={false} sync={false} restored={{ account }}>
      <Harness />
    </StoreProvider>,
  );

describe('the settings row on Me', () => {
  it('is there for a live account', () => {
    mount('live');
    expect(screen.getByLabelText('Settings')).toBeTruthy();
  });

  it('is there for the demo too — the page says which mode this is', () => {
    mount('seeded');
    expect(screen.getByLabelText('Settings')).toBeTruthy();
  });

  it('opens settings', () => {
    mount('live');
    fireEvent.press(screen.getByLabelText('Settings'));
    expect(settingsOpen).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- src/screens/__tests__/settingsEntry.test.tsx
```

Expected: FAIL — `Unable to find an element with accessibilityLabel: Settings`.

- [ ] **Step 3: Add the row to MeScreen**

In `src/screens/MeScreen.tsx`, immediately after the "See this week's ledger" `Tap`
closes (around line 463) and **before** the `__DEV__` block:

```tsx
      {/*
        Not dev-gated, unlike everything below it. This is the only route a
        live account has to its own identity, to Apple linking, and to signing
        out — before it existed, those were spread across a card, a banner that
        only appears on failure, and an onboarding screen you cannot get back to.
      */}
      <Tap
        onPress={() => dispatch({ type: 'OPEN_SETTINGS' })}
        accessibilityLabel="Settings"
        style={{
          minHeight: 50,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 10,
        }}
      >
        <Sans size={13} weight={600} color={color.muted}>
          Settings
        </Sans>
      </Tap>
```

`Sans`, `Tap`, `color` and `dispatch` are all already in scope in that component.

- [ ] **Step 4: Render the overlay in the shell**

In `src/App.tsx`, beside the other overlays. Place it **after** `NotificationsOverlay`
and **before** `OnboardOverlay`, matching its zIndex of 60 — the onboarding overlay has
to be able to cover it, because that is where signing out lands:

```tsx
      {state.settingsOpen ? <SettingsOverlay topInset={insets.top} /> : null}
```

And the import, beside the other overlay imports:

```tsx
import { SettingsOverlay } from './overlays/SettingsOverlay';
```

- [ ] **Step 5: Run the test**

```bash
npm test -- src/screens/__tests__/settingsEntry.test.tsx && npm run typecheck && npm run lint
```

Expected: 3 passing, clean.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/screens/MeScreen.tsx src/screens/__tests__/settingsEntry.test.tsx
git commit -m "Put the door to settings where someone would look for it"
```

---

## Task 7: The end-to-end assertion

**Files:**
- Test: `src/overlays/__tests__/signOutJourney.test.tsx`

Tasks 1–6 each prove a piece. This proves the thing the feature is actually for: that
signing out lands somewhere you can sign back in from. Nothing else in the suite
asserts the whole route.

- [ ] **Step 1: Write the failing test**

Create `src/overlays/__tests__/signOutJourney.test.tsx`:

```tsx
/**
 * The reason this feature exists, asserted end to end.
 *
 * Not a duplicate of the reducer test: that one proves `SIGN_OUT` sets
 * `onboardStep`, this one proves the shell then renders the Welcome screen and
 * that the Apple button on it is real. Those are two different failures — the
 * reducer could be right while `App.tsx` renders the wrong overlay, and the
 * user's experience of that is identical to the bug this replaces.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { App } from '../../App';
import * as outbox from '../../sync/outbox';
import * as session from '../../sync/session';

describe('signing out and back in', () => {
  beforeEach(() => {
    jest.spyOn(outbox, 'flushOutbox').mockResolvedValue(undefined);
    jest.spyOn(outbox, 'pending').mockReturnValue([]);
    jest.spyOn(session, 'signOutEverywhere').mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('lands on the welcome screen, where the way back in is', async () => {
    render(
      <App
        persist={false}
        sync={false}
        restored={{
          account: 'live',
          onboardStep: null,
          selfId: '11111111-1111-4111-8111-111111111111',
        }}
      />,
    );

    // The store is the seam here rather than a tap, because the confirm is a
    // native Alert and driving it would be testing React Native's dialog.
    await act(async () => {
      await session.signOutEverywhere();
    });

    // Assert through the rendered result rather than the action: what matters
    // is that the recovery door is on screen.
    expect(screen.queryByLabelText(/Continue with Apple/)).toBeTruthy();
  });
});
```

**Note for the implementer:** this test as written will need adjusting once you see how
`App` accepts `restored` — it may be simpler to render `App` with
`restored={{ onboardStep: 'onboarding' }}` directly and assert the Apple button, then
separately assert that `SIGN_OUT` produces that state (already covered in Task 2). If
driving the full journey turns out to need more machinery than it proves, **say so and
simplify it rather than building a mock rig** — the reducer test plus the render test
already cover both halves. Do not delete the test silently.

- [ ] **Step 2: Run it**

```bash
npm test -- src/overlays/__tests__/signOutJourney.test.tsx
```

Expected: passing, possibly after the simplification noted above.

- [ ] **Step 3: Commit**

```bash
git add src/overlays/__tests__/signOutJourney.test.tsx
git commit -m "Assert the whole route, not just its halves"
```

---

## Task 8: Documentation

**Files:**
- Modify: `TESTING.md`

- [ ] **Step 1: Retire the known limit**

In `TESTING.md`, find the "no settings page" bullet under `## Known limits` and replace
it with a statement of what is now true and what still is not:

```markdown
- **A live account can now sign out, but only on iOS.** Me → Settings gathers account
  state, your name, notification permission, Apple linking and sign-out. Sign-out is
  offered only once the account has been secured with Apple, because an anonymous
  account that signs out is unreachable forever — so on Android, where Apple sign-in
  does not exist, no account can sign out and the page says why. Signing out clears the
  device and lands on Welcome, which also means the recovery flow can finally be
  exercised without a reinstall.
```

Also check the bullet beginning "**On iOS an account can now be got back**" and amend
its last clause if it still claims a reinstall is the only route back to the Apple
button.

- [ ] **Step 2: Commit**

```bash
git add TESTING.md
git commit -m "Say what changed about getting out of an account"
```

---

## Task 9: The gate

Run everything, in this order. Do not skip the integration suite because nothing here
touches RLS — the point of a standing gate is that it runs when you think it will pass.

- [ ] **Step 1: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 2: Lint**

```bash
npm run lint
```

- [ ] **Step 3: Unit**

```bash
npm test
```

- [ ] **Step 4: Integration** (needs Docker and a local Supabase stack)

```bash
npm run test:integration
```

If Docker is not available, say so explicitly in the PR rather than reporting the gate
as green.

- [ ] **Step 5: Mutation-test the new guards**

There is no mutation-testing harness in this repo, so this is done by hand and the
evidence goes in the PR. For each mutation below: apply it, run the named test file,
confirm a test **fails**, then revert.

| # | File | Mutation | Must be caught by |
|---|---|---|---|
| 1 | `settings/guards.ts` | `signOutVisible`: `account !== 'live'` → `account === 'live'` | `guards.test.ts` demo cases |
| 2 | `settings/guards.ts` | `signOutVisible`: drop the `session.anonymous` clause, returning `true` for any live account | "is withheld from an anonymous account" |
| 3 | `settings/guards.ts` | `signOutEnabled`: drop `!session.anonymous` | "is not tappable for an anonymous account even when resolved" |
| 4 | `settings/guards.ts` | `signOutEnabled`: drop `status === 'ready'` | the offline/expired/off cases |
| 5 | `settings/guards.ts` | `canSecure`: drop the platform check | "is not offered on Android" |
| 6 | `settings/signOut.ts` | **delete the `if (unsent > 0) return` abort** | "refuses, and does not sign out, when work is still unsent" |
| 7 | `settings/signOut.ts` | count entries instead of distinct keys (`pending().length`) | "counts things, not attempts" |
| 8 | `settings/signOut.ts` | move `await flushOutbox()` after `signOutEverywhere()` | "flushes before it signs out" |
| 9 | `store.tsx` | `SIGN_OUT` returns `{ ...initialState, onboardStep: null, ... }` | "lands on onboarding" |

Mutation 6 is the one that matters most — it is the silent-data-loss path, and if no
test fails when you delete that line, the test is wrong and not the code.

- [ ] **Step 6: PR**

```bash
git push -u origin HEAD
gh pr create --title "A settings page, and a way out of an account that you can come back from" --body "$(cat <<'BODY'
Account controls were scattered across four surfaces and one was unreachable: a
signed-in account could not sign out, switch accounts, or reach the Apple recovery
flow without deleting the app.

Me → Settings now gathers account state, your name, notification permission, Apple
linking and sign-out.

**The two decisions worth reviewing:**

Sign-out is offered **only once the account is secured**. An anonymous account that
signs out is gone — nothing else holds that uuid. Rather than ship that behind a
warning, the control is absent while anonymous and "Secure this account" stands in its
place. The consequence is deliberate and stated on the page: on Android, where Apple
sign-in does not exist, no account can be secured and so none can sign out.

Sign-out **refuses while anything is still queued**. `flushOutbox` is best-effort and
`signOutEverywhere` completes locally when offline, so without the check, signing out
in a tunnel would take unsent work off the device having never sent it. The user is
told what is unsent and asked to reconnect.

Reset app data stays behind `__DEV__` — considered promoting it and decided against:
two destructive controls as siblings is worse than one hard-to-reach one.

Deferred to their own specs: dark mode, Dynamic Type, profile photo, reporting, Terms.
Reasoning in `docs/superpowers/specs/2026-08-19-settings-page-design.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 7: Merge on green**

---

## Self-review notes

Checked against the spec:

- Account state, Your name, Notifications, Secure this account, Sign out — Task 5.
- Android line in the Account section — Task 5, `AccountSection.line()`, asserted in Task 3.
- Reset stays `__DEV__` — Task 6 explicitly does not touch `DevControls`.
- Sign-out ordering and the queue abort — Task 4.
- Disabled-with-reason when the session is unresolved — Tasks 3 and 5.
- `settingsOpen` not persisted — Task 1 adds it to `State` and `CLEARED` only, never to
  `PERSISTED_KEYS`, so no `VERSION` bump.
- `TESTING.md` — Task 8.
- Mutation targets — Task 9, with the spec's named guard as mutation 6.

Naming is consistent across tasks: `signOutVisible`, `signOutEnabled`, `canSecure`,
`attemptSignOut`, `unsentLine`, `SignOutOutcome`, `SIGN_OUT`, `OPEN_SETTINGS`,
`CLOSE_SETTINGS`, `settingsOpen`.
