# Settings page — design

Date: 2026-08-19
Status: approved, not yet implemented

## The problem

Account controls are scattered across four surfaces, and one of them is unreachable.

| Control | Lives at | Reachable when |
|---|---|---|
| Secure this account (Apple linking) | `src/screens/MeScreen.tsx:178` | live account, still anonymous |
| Reset app data | `src/screens/MeScreen.tsx:529` | `__DEV__` builds only |
| Start over (`signOutEverywhere`) | `src/components/SyncBanner.tsx:64` | `session.status` is `expired` or `error` |
| Continue with Apple (recovery) | `src/overlays/onboard/WelcomeScreen.tsx` | onboarding only — unreachable once complete |

The consequence: a signed-in account cannot sign out, switch accounts, or reach the
recovery path without deleting the app. That also makes recovery hard to test, since
a reinstall is the only route back to the Apple button.

**Correction.** Earlier drafts of this spec said the problem was "recorded as the
'no settings page' bullet in `TESTING.md` Known limits". No such bullet exists — the
nearest one ("On iOS an account can now be got back…") was written for a different
change and only mentions reinstall in passing. The limitation was real but undocumented,
so this work *adds* a Known-limits bullet rather than retiring one.

## Decisions

Taken in brainstorming, with the reasoning that produced them.

### Sign out is offered only once the account is secured

An anonymous account that signs out is gone permanently — nothing else holds that
uuid, so whatever it owns on the server becomes unreachable. Rather than ship a
one-tap route to that and guard it with a warning, the control simply is not there
while the account is anonymous; the slot shows "Secure this account" instead, which
is the action that makes signing out safe.

This means no irreversible-loss path exists on the settings page at all. On Android,
where `expo-apple-authentication` does not exist, no account can be secured, so no
account can sign out — which is correct rather than a gap: there is no way back, so
there must be no way out.

The Android page is therefore Account, Your name, Notifications and nothing else. The
Account section says why in one line, so the absence reads as a decision rather than a
missing feature. Google sign-in is what changes this, and it is not this spec.

### Signing out wipes the device back to pre-onboarding

Recovery deliberately refuses to restore history onto a device that already has
some (weeks are identified by an ISO week number that repeats every year, so
gap-filling would eventually fuse two different years' week 33). Leaving local state
behind would therefore make signing back in restore nothing — the account would come
back hollow. Wiping keeps the restore precondition true, and stops the departing
account's week sitting on screen for whoever holds the phone next.

The confirm copy has to carry both halves: the device is cleared, the server keeps it.

### The surface is a full-screen overlay, entered from the foot of Me

Consistent with every other secondary destination in this app — Plan, Ledger,
Notifications are all overlays behind reducer state, not routes. The entry point is a
row at the bottom of the Me screen rather than a header control, leaving the shared
`Header` untouched.

### Scope

In: account state, your name, notification permission, Secure this account, Sign out.

**Reset app data stays behind `__DEV__`.** It was going to be promoted to a shipping
row; it is not. It is data loss with no undo, and putting it one row below Sign out
made two destructive controls siblings. A real user's route out is Sign out. The
consequence is deliberate: on Android, and on any anonymous account, the settings page
carries no destructive control at all.

Deferred, each needing its own spec:

- **Dark mode** — `src/theme/tokens.ts` is a flat const module with no scheme
  awareness, and dark surfaces here are a design element (ink cards on paper), not a
  theme; there is a separate `onDark` alpha ramp for exactly that. A dark theme means
  re-deriving the whole palette, a design decision `HANDOFF.md` does not answer.
- **Text size** — `allowFontScaling` appears nowhere in `src/`, so the app currently
  ignores the OS setting outright. The fix is honoring Dynamic Type, not an in-app
  slider duplicating a control the OS owns; it means auditing every fixed-height pill,
  every 44px target, and HANDOFF's hard 10px caps floor.
- **Profile photo** and **reporting** — both need a migration, RLS, and a moderation
  destination; photos also need a storage bucket, an image picker, and upload retry
  through a sync layer that currently only speaks table rows.
- **Terms & conditions** — no policy text or URL exists in the repo. A row that opens
  nothing is worse than no row, especially among destructive ones.

The overlay's sections are a plain list, so each of these is a row addition later
rather than a restructure.

Each now has its own spec:

- `2026-08-19-dark-mode-design.md`
- `2026-08-19-dynamic-type-design.md`
- `2026-08-19-reporting-and-blocking-design.md`
- `2026-08-19-profile-photos-design.md`

Suggested order: reporting → photos (photos need the takedown path), and dark mode →
Dynamic Type (both sweep the same 30 files, and doing them at once makes review harder).
Terms & conditions still has no spec because it still has no policy text.

## Architecture

### State

Three additions to `src/state/store.tsx`:

- `settingsOpen: boolean` on `State`, initial `false`. Joins `CLEARED` so any
  `GO_PLACE` transition closes it. Not persisted — `PERSISTED_KEYS` in
  `src/state/persistence.ts` is an allowlist, so not adding it is the whole action,
  and no `VERSION` bump is needed.
- `OPEN_SETTINGS` / `CLOSE_SETTINGS` actions.
- `SIGN_OUT`, returning `{ ...initialState, week: liveWeek(), day: week.today }`.

`SIGN_OUT` cannot be expressed as `RESET`: `RESET` sets `onboardStep: null`, and the
whole point is to land on `onboardStep: 'onboarding'` — the Welcome screen, whose
`recoverWithApple` (`src/overlays/OnboardOverlay.tsx:246`) is a working recovery flow
that is merely unreachable today. Sign-out reuses it rather than rebuilding it.

`SIGN_OUT` also leaves `account: null`. `syncOn` requires `account === 'live'`, so the
sync layer stops on its own with no new flag to poll.

`onboardStep` **is** persisted, which is what makes this hold across a relaunch: a
device signed out and then force-quit reopens on Welcome rather than back inside an
account it no longer has a session for.

### Sign-out ordering, and the queue it must not drop

The one part with a real failure mode. In order:

1. `await flushOutbox()` — persists the queue to disk, then `kickSync()` starts a
   drain.
2. **Re-read `pending()`. If it is non-empty, stop and say so** — sign-out does not
   proceed. See below.
3. `await signOutEverywhere()` — deregisters this device's push token while it still
   has a session to do it with.
4. `dispatch({ type: 'SIGN_OUT' })`.

Dispatching first would change `selfId`, fire the `lastSelfId` effect
(`src/state/store.tsx:1647`), and clear the outbox before it drained.

**Correction, found during implementation.** An earlier draft of this spec said step 1
gave queued work "its last chance to land". That was wrong. `flushOutbox`
(`src/sync/outbox.ts:176`) writes the queue to **AsyncStorage** — its own comment says
"Called when the app backgrounds, alongside persistence.flush()". Sending is `drain()`,
whose only app-level handle is `kickSync()` (`src/sync/useSyncEngine.ts:23`), and that
returns `void` and cannot be awaited.

The consequence is a **known limitation, not a data-loss path**: the check fails closed,
so nothing is ever lost, but the sequence cannot wait for a send to finish. A user with
a queue that would drain fine is refused on the first tap and succeeds on a retry a few
seconds later. `kickSync()` is called before the check specifically so that retry
succeeds quickly rather than waiting on the 5-second scheduler. Closing the gap properly
means giving the engine an awaitable drain, which touches `src/sync/` and is out of
scope here.

Step 2 is the guard this feature exists to avoid needing elsewhere. `signOutEverywhere`
deliberately completes locally when it cannot reach the network — so without the check,
signing out with three staked tasks still queued drops them from the device by the wipe
having never reached the server, and signing back in restores everything except them.
Silent permanent loss, on a page whose whole premise is that no such path should exist.

Instead the confirm refuses, naming the count:

> *Three things haven't reached the server yet. Give it a moment and try again — they'd
> be lost otherwise.*

"Give it a moment" rather than "reconnect": the cause is usually simply that the drain
has not run yet, and the copy must not assert a dead network it cannot actually observe.

Counted distinct by `key`, not by entry, for the reason `unsavedCount` documents: a
task written and then deleted is two ops about one thing. `pending()` in
`src/sync/outbox.ts` returns the live queue; `unsavedCount()` is **not** the right
primitive here — it counts dead letters, which are permanently refused rather than
merely unsent.

### When there is no session

`canSignOut` needs `session.status === 'ready'` to know whether the account is
anonymous — `anonymous` is a JWT claim, not persisted state. So a secured user with no
signal has no way for the page to confirm they are secured.

The row is therefore **shown disabled with a reason** rather than hidden, so the
control does not appear and vanish with connectivity:

> *Sign out — needs a connection.*

Known imprecision, named rather than hidden: on a live account whose session has never
reached `ready`, the page cannot tell secured from anonymous, so it shows the disabled
row in both cases. If the session then resolves anonymous, the row is replaced by
"Secure this account". The disabled copy is true either way — signing out does need a
connection — so the transient state does not lie, it is merely less specific than it
would be online.

### Files

| File | Change |
|---|---|
| `src/state/store.tsx` | `settingsOpen`, `OPEN_SETTINGS`, `CLOSE_SETTINGS`, `SIGN_OUT` |
| `src/overlays/SettingsOverlay.tsx` | new |
| `src/App.tsx` | render `SettingsOverlay` when `state.settingsOpen` |
| `src/screens/MeScreen.tsx` | Settings row at the foot of the screen. `DevControls` is untouched — `Reset app data` stays there, behind `__DEV__` |
| `TESTING.md` | Add a Known-limits bullet for what sign-out does and does not do; amend the iOS-recovery bullet's reinstall clause |

### The overlay

`src/overlays/SettingsOverlay.tsx` — paper background, `zIndex: 59`, wrapped in
`Overlay` for hardware-back and Escape handling.

The number is load-bearing. The ladder is Plan 45, Sheet 50, Ledger 55, Notifications
58, **Rollover 60**, Onboard 70. Settings sits at 59: above Notifications, and below
Rollover, because a week that has already turned outranks anything on this page. Below
Onboard 70 for the same reason as ever: signing out lands on Welcome, which must cover
this.

**Correction.** An earlier draft justified 59 by claiming Settings and Rollover could be
open simultaneously — that `ROLLOVER_DETECTED` bails on `pendingRollover || onboardStep`
but not on `settingsOpen`. That is false: `ROLLOVER_DETECTED` spreads `CLEARED`, and
`CLEARED` contains `settingsOpen: false`, so the rollover closes this page on its way
up. The ordering still holds and 59 is still right — it is simply belt-and-braces rather
than the resolution of a live collision.

| Section | Shown when | Behaviour |
|---|---|---|
| Account | always | Read-only: Demo or Live, whether the account can be got back, truncated user id on live. On Android, one line saying sign-out needs an account that can be got back and Apple sign-in is iOS-only |
| Your name | live | Inline edit reusing `RENAME_SELF` + `queueProfileName` — the same pair the Me card uses |
| Notifications | always | State from `hasReminderPermission()`; `askForReminders()` when undetermined, otherwise `Linking.openSettings()` |
| Secure this account | live, anonymous, iOS | `linkApple()`; failures rendered through `appleTrouble` + `Trouble`, identical to the Me card, which stays |
| Sign out | live, and not (session ready and anonymous) | Disabled with a reason while the session is not `ready`. Enabled otherwise: destructive confirm, then the ordering above |

"Secure this account" appears in both places deliberately: the Me card version is the
prompt at the point of identity, the Settings version is where someone goes looking.
Both call the same `linkApple` and share the same copy, so they cannot drift.

`DevControls` is unchanged: Reset app data, Simulate next week, Go live, and
`DeadLetters`, all still `__DEV__`.

## Error handling

- Apple linking failures use the existing `appleTrouble` / `Trouble` pair — one line
  under the control that failed, `cancelled` rendering nothing at all.
- `signOutEverywhere` already swallows a network failure and completes locally, so a
  sign-out on a plane still clears the device. The push-token row it leaves behind is
  repaired by the next person to register on this device.
- An undrained queue **is** surfaced, as the refusal above. That is the whole of the
  offline story: the user is told what is unsent and asked to wait, rather than having
  it discarded on their behalf.

## Testing

Unit — `src/overlays/__tests__/settings.test.tsx`:

- Row visibility matrix across demo, live-anonymous, live-secured, offline-session and
  expired-session — including that Sign out renders disabled rather than absent when the
  session is not `ready`.
- Android renders no Sign out and no Secure row, and the Account section says why.
- Confirm-cancel dispatches nothing.
- `SIGN_OUT` leaves `onboardStep: 'onboarding'`, so Welcome's Apple button is reachable.
- Sign-out calls `flushOutbox`, then `signOutEverywhere`, then dispatches — in that
  order.
- **A non-empty `pending()` after the flush aborts the sign-out**: no
  `signOutEverywhere`, no dispatch, and the count is named in the message. This is the
  test that would have caught the silent-loss window.

Mutation testing targets both new guards:

```
signOutVisible = account === 'live' && !(session.status === 'ready' && session.anonymous)
signOutEnabled = session.status === 'ready' && !session.anonymous
attemptSignOut aborts when pending() is non-empty after the flush
```

The queue check is deliberately **not** part of `signOutEnabled`. Gating the rendered
button on `pending().length === 0` would grey it out for a queue that the flush is
about to empty — the button would appear broken precisely when the app is about to do
the right thing. The check belongs after the flush, where the answer is real.

Each condition must be individually killable — in particular the abort in
`attemptSignOut`, which is the one whose absence is invisible until someone loses
work.

No new integration test. Nothing here touches RLS or adds a `WireOp`, so the existing
integration suite stands as the gate rather than growing.

## Gate

`npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, mutation
test the new guard, then PR and merge on green.
