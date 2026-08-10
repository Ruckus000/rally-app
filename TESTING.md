# Testing Rally

## Start it

```bash
npm run sim
```

That boots the iPhone 16 Pro simulator (402×874 — the exact size the design was drawn at), installs the app and launches it. **It does not need Metro or any dev server** — the Release build has the JS bundled inside it, so it survives a reboot and keeps working if you close this terminal.

If the build is ever missing or you've changed code and want it in the standalone app:

```bash
npm run sim:build
```

Want live reload while poking at code instead? That's the normal Expo path:

```bash
npm run ios:dev
```

Other simulators work too — `RALLY_SIM="iPhone 16" npm run sim`.

**Android** is built and verified too:

```bash
npm run android
```

Same deal — boots an emulator, installs a release APK with the bundle baked in, no Metro. `npm run android:build` rebuilds it, and `RALLY_AVD=Pixel_4a npm run android` picks a different device.

## What to walk through

The app opens on the **Join** screen every launch (state is in memory, so every launch is a clean slate — that's deliberate for testing).

**Onboarding.** Join The Basement → the Plan overlay opens in first-run mode: eyebrow reads "ONE THING TO START", and a lime tooltip explains the SEEN BY control. Dismiss it with "Got it", then "Start my week" drops you on the Personal feed. "Skip for now" on either screen goes straight to the app.

**Week / Personal.** Quick-log composer at the top (tap the pill, type, hit the lime check — lands as 20 pts, category "Quick log", today). Points bar shows the running total and routes to Plan. Task rows: tap the checkbox to close one, tap the row to open its sheet. Close all six and the perfect-week card appears at the top with "Post it to the circle".

**Week / Friends.** Five moment types. The 🔥 button toggles — tap once to cheer, again to take it back, and watch the toast change. The card itself opens a sheet; the buttons on it don't.

**Week / Global.** Four posts from outside the circle, with follower-scale cheer counts.

**Circle.** Podium with progress rings, then the ranked list. The row metric is follow-through (`71% · 5 of 7 · 🔥 2w`) because that's what the sort uses. Tap anyone to open their profile sheet; tap yourself to jump to Me. Close your own tasks and watch yourself climb the ranking.

**Me.** Profile, all-time points, streak bar, the year grid (one cell per week since joining — 37 plus this week plus next), the gave/got exchange bar, who you owe a word to, personal bests, past weeks. Every past-week row opens its own ledger with that week's real data.

**Plan.** Hero staked-points number and progress toward your best week. The composer: type a title, pick a day, pick a category (Fitness 35 · Work 45 · Home 25 · Mind 25 — the button label updates), set SEEN BY, pair with friends. "PICK IT BACK UP" stakes a suggestion in one tap. The STAKED list lets you cycle audience per task, open a pair face to see that person, and unstake with the ✕.

**Editing a stake.** Open any of your own tasks → "Edit this" → Plan opens with everything loaded and the header reads "EDITING A STAKE". Change the category and the save button re-prices it. Cancel, closing Plan, or unstaking the task all abandon the edit without half-applying it.

**Notifications.** The bell badge counts only the "Needs you" tier. Three tiers with blurbs, filter chips, and per-item read state — open one and the badge drops by one. "Mark all read" clears it. Rows route individually: some to a task sheet, some to a person, some to Plan, some to the ledger.

**Ledger.** From Me ("See this week's ledger"), from a past-week row, from the Friends feed footer, or from a notification. Footer labels change with context: current week → `Not yet` / `Stake Week 34`; historical → `Close` / `Back to today`.

## Things worth poking at

- **Escape and back.** Every overlay closes on hardware back (and Escape with a keyboard attached). The sheet also has a real close button — the drag handle is decorative, as in the prototype.
- **Reduced motion.** Simulator → Settings → Accessibility → Motion → Reduce Motion. The sheet and toast animations stop.
- **VoiceOver.** Icon-only controls, avatars, rank rows and the year grid all have spoken labels.
- **Zero counts.** No bare zeros on actions — a cheer count of zero reads "Cheer", a note count of zero reads "Note".

## Config flags

The three props from the handoff are wired but not surfaced in the UI. To try them, edit `App.tsx`:

```tsx
<App config={{ showRank: false, defaultAudience: 'everyone', quietComebacks: false }} />
```

`showRank: false` hides podium badges, replaces list ranks with `·` and changes the Circle subtitle. `quietComebacks: false` drops the quiet Tomás item from the Friends feed.

## Checks

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

58 tests in three suites — reducer rules, selector maths, and render tests that drive the real screens (tap a checkbox, assert the count moves). `tsc` runs in strict mode; CI runs all three.

## Bugs found and fixed after the first pass

Driving the app on a second platform and writing render tests each turned up defects the first build hid:

- **Android:** the Plan hero glow used a text shadow, which Android clips to the glyph box — it drew a lit rectangle behind "190". Now iOS-only.
- **Android:** the year grid wrapped to 12 columns instead of 13; a fractional cell width overflowed the row by a fraction of a pixel. Widths are floored now.
- **Unstaking a suggestion left it dead.** Staking "Stretch every night" from PICK IT BACK UP and then unstaking it left the card reading "Staked ✓" forever, with no way to stake it again. The card now returns to the rail.
- **A crash in the engagement buttons** when they were invoked without a touch event. Guarded.

## Known limits

- **No persistence.** Every launch starts from the fixtures. This was your call ("full spec, mock data") and it makes each test run reproducible — but it does mean you can't leave state overnight.
- **Simulator only.** Running on a physical iPhone needs an Apple developer team for signing, which I can't set up for you. Once you add one in Xcode, `npx expo run:ios --device` will do it.
- **Android is verified but less exercised.** I built the release APK, walked Join → Plan → Week → Me on a Pixel 9 Pro emulator and fixed the two platform bugs it surfaced (above), but I didn't drive every screen there the way I did on iOS.
- **No first-run empty state for a brand-new account** beyond the written empty states on the feed, Circle and past weeks.
