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
a reinstall is the only route back to the Apple button. Recorded as the "no settings
page" bullet in `TESTING.md` Known limits.

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

In: account state, your name, notification permission, Secure this account, Sign out,
Reset app data.

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

## Architecture

### State

Three additions to `src/state/store.tsx`:

- `settingsOpen: boolean` on `State`, initial `false`. Joins `CLEARED` so any
  `GO_PLACE` transition closes it, and is excluded from persistence like the other
  overlay flags.
- `OPEN_SETTINGS` / `CLOSE_SETTINGS` actions.
- `SIGN_OUT`, returning `{ ...initialState, week: liveWeek(), day: week.today }`.

`SIGN_OUT` cannot be expressed as `RESET`: `RESET` sets `onboardStep: null`, and the
whole point is to land on `onboardStep: 'onboarding'` — the Welcome screen, whose
`recoverWithApple` (`src/overlays/OnboardOverlay.tsx:246`) is a working recovery flow
that is merely unreachable today. Sign-out reuses it rather than rebuilding it.

`SIGN_OUT` also leaves `account: null`. `syncOn` requires `account === 'live'`, so the
sync layer stops on its own with no new flag to poll.

### Sign-out ordering

The one part with a real failure mode. In order:

1. `flushOutbox()` — best-effort, so work already staked reaches the server.
2. `await signOutEverywhere()` — deregisters this device's push token while it still
   has a session to do it with.
3. `dispatch({ type: 'SIGN_OUT' })`.

Dispatching first would change `selfId`, fire the `lastSelfId` effect
(`src/state/store.tsx:1647`), and clear the outbox before it drained.

### Files

| File | Change |
|---|---|
| `src/state/store.tsx` | `settingsOpen`, `OPEN_SETTINGS`, `CLOSE_SETTINGS`, `SIGN_OUT` |
| `src/overlays/SettingsOverlay.tsx` | new |
| `src/App.tsx` | render `SettingsOverlay` when `state.settingsOpen` |
| `src/screens/MeScreen.tsx` | Settings row; `Reset app data` moves out of `DevControls` |

### The overlay

`src/overlays/SettingsOverlay.tsx` — paper background, `zIndex: 60` (above
Notifications' 58, below Onboarding's 70 so Welcome covers it after sign-out),
wrapped in `Overlay` for hardware-back and Escape handling.

| Section | Shown when | Behaviour |
|---|---|---|
| Account | always | Read-only: Demo or Live, whether the account can be got back, truncated user id on live |
| Your name | live | Inline edit reusing `RENAME_SELF` + `queueProfileName` — the same pair the Me card uses |
| Notifications | always | State from `hasReminderPermission()`; `askForReminders()` when undetermined, otherwise `Linking.openSettings()` |
| Secure this account | live, anonymous, iOS | `linkApple()`; failures rendered through `appleTrouble` + `Trouble`, identical to the Me card, which stays |
| Sign out | live, session ready, not anonymous | Destructive confirm, then the ordering above |
| Reset app data | always | Moves out of `DevControls`; Fresh start / Reload demo unchanged |

"Secure this account" appears in both places deliberately: the Me card version is the
prompt at the point of identity, the Settings version is where someone goes looking.
Both call the same `linkApple` and share the same copy, so they cannot drift.

`DevControls` keeps only what is genuinely dev-only: Simulate next week, Go live, and
`DeadLetters`.

## Error handling

- Apple linking failures use the existing `appleTrouble` / `Trouble` pair — one line
  under the control that failed, `cancelled` rendering nothing at all.
- `signOutEverywhere` already swallows a network failure and completes locally, so a
  sign-out on a plane still clears the device. The push-token row it leaves behind is
  repaired by the next person to register on this device.
- `flushOutbox` failing is not surfaced. It is best-effort by construction, and the
  user has already asked to leave.

## Testing

Unit — `src/overlays/__tests__/settings.test.tsx`:

- Row visibility matrix across demo, live-anonymous, live-secured, and expired-session.
- Confirm-cancel dispatches nothing.
- `SIGN_OUT` leaves `onboardStep: 'onboarding'`, so Welcome's Apple button is reachable.
- Sign-out calls `flushOutbox` and `signOutEverywhere` before the dispatch.

Mutation testing targets the new guard:

```
canSignOut = account === 'live' && session.status === 'ready' && !session.anonymous
```

Three independent conditions; each must be individually killable.

No new integration test. Nothing here touches RLS or adds a `WireOp`, so the existing
integration suite stands as the gate rather than growing.

## Gate

`npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, mutation
test the new guard, then PR and merge on green.
