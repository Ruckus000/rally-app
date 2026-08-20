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

The app opens on **onboarding** the first time only. After that your state is restored — including which tab and scope you were on. **Reset app data** at the bottom of Me gets you back.

**Onboarding** is seven screens: welcome, what you're here to move, your name, your first stake, a circle, notifications, and the STAKED celebration. Back steps one screen at a time — including hardware back on Android — and only leaves from the welcome screen. Skip appears on intents, circle and notifications, and moves you forward rather than out. What you tick on the stake screen becomes real tasks on today when you hit "Enter your week".

**The three accounts.** "Get started" goes **live**: an anonymous sign-in and real syncing (circles aren't wired to the server yet, so that step says so). "Look around first" grants the **demo** — the circle, the history and the week you've been testing. **"Ride solo for now"** on the circle screen drops the demo circle for a genuinely empty account — no circle, no tasks, no history, no notifications, a zeroed profile — as does closing the welcome screen without choosing. The reset control at the bottom of Me switches between all three.

**Week / Personal.** Quick-log composer at the top (tap the pill, type, hit the lime check — lands as 20 pts, category "Quick log", today). Points bar shows the running total and routes to Plan. Task rows: tap the checkbox to close one, tap the row to open its sheet. Close all six and the perfect-week card appears at the top with "Post it to the circle".

**Week / Friends.** Five moment types. The 🔥 button toggles — tap once to cheer, again to take it back, and watch the toast change. The card itself opens a sheet; the buttons on it don't.

**Week / Global.** Four posts from outside the circle, with follower-scale cheer counts. Cheering one counts toward YOU GAVE on Me but deliberately *not* toward "cheers exchanged in the circle" on Circle — that bar means the circle. On a fresh account the feed ends with a nudge to build one.

**Circle.** Podium with progress rings, then the ranked list. The row metric is follow-through (`71% · 5 of 7 · 🔥 2w`) because that's what the sort uses. Tap anyone to open their profile sheet; tap yourself to jump to Me. Close your own tasks and watch yourself climb the ranking.

**Me.** Profile, all-time points, streak bar, the year grid (one cell per week since joining — 37 plus this week plus next), the gave/got exchange bar, who you owe a word to, personal bests, past weeks. Every past-week row opens its own ledger with that week's real data.

**Plan.** Hero staked-points number and progress toward your best week. The composer: type a title, pick a day, pick a category (Fitness 35 · Work 45 · Home 25 · Mind 25 — the button label updates), set SEEN BY, pair with friends. "PICK IT BACK UP" stakes a suggestion in one tap. The STAKED list lets you cycle audience per task, open a pair face to see that person, and unstake with the ✕.

**Editing a stake.** Open any of your own tasks → "Edit this" → Plan opens with everything loaded and the header reads "EDITING A STAKE". Change the category and the save button re-prices it. Cancel, closing Plan, or unstaking the task all abandon the edit without half-applying it.

**Notifications.** The bell badge counts only the "Needs you" tier. Three tiers with blurbs, filter chips, and per-item read state — open one and the badge drops by one. "Mark all read" clears it. Rows route individually: some to a task sheet, some to a person, some to Plan, some to the ledger.

**Ledger.** From Me ("See this week's ledger"), from a past-week row, from the Friends feed footer, or from a notification. Footer labels change with context: current week → `Not yet` / `Stake Week n+1`; historical → `Close` / `Back to today`.

**Week rollover.** The week now comes from the real clock, so it turns over on Monday. **"Simulate next week"** at the bottom of Me triggers it on demand. You get the closed week, a checklist of unfinished stakes to carry, and a confirm — nothing is rewritten until you answer. Committing archives the week into Past weeks, adds a year-grid cell, and moves your all-time points and streak. A week holds the streak if you closed at least one stake. Try force-quitting while the prompt is open: it comes back waiting.

## Running on a real iPhone

Everything is configured — bundle id `app.rally.weekspine`, scheme set, both native projects generate. The missing piece is an Apple account, which only you can supply.

1. `open ios/Rally.xcworkspace`
2. Select the **Rally** target → **Signing & Capabilities** → pick your Team. Xcode will provision automatically.
3. Plug the phone in, then on the device: **Settings → General → VPN & Device Management** → trust your certificate.
4. `npm run ios:dev -- --device`

With a **free Apple ID** the build expires after seven days and needs re-signing; you also can't have push notifications or Sign in with Apple. With the **paid programme** ($99/yr) the build lasts a year, and push becomes possible. Everything on this side of that is built: `expo-notifications` is configured in `app.json`, `src/lib/push.ts` mints the token, `device_tokens` stores it, and the `push_on_notification` trigger carries a notification row to the deployed `push` edge function. **Test it with a cheer from a real person**, not a bot: `20260817112928_bot_cheers_do_not_push` writes the row and rings the bell for an Oz bot's cheer but deliberately skips the last hop, so a bot cheer is the one case that correctly produces no buzz. What is missing is the APNs key, which the paid programme is a prerequisite for. **A simulator can never receive a remote push**, so none of that chain can be seen working until it runs on a plugged-in phone.

Android needs none of this: the release APK from `npm run android:build` sideloads onto any device with developer mode on.

## Persistence and the empty account

- **State survives.** Stake something, close a task, then force-quit (`xcrun simctl terminate 2A856B32-BA15-407A-BC1C-851FFA42AC8F app.rally.weekspine`) and run `npm run sim`. Everything comes back, including your tab and scope. Overlays and sheets always start closed.
- **Reset app data** — bottom of Me. *Fresh start* for the empty account, *Reload demo* for the populated one.
- **On a fresh account**, check: Week/Personal is the empty card, Week/Friends asks you to invite someone, Circle is "A circle of one", Notifications says "Nothing needs you" with no badge, Me is zeroed with em-dash bests and a "Starts here" grid, and Plan has no best week to beat, no pair chips and no suggestion rail.

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

`npm test` is the unit suite — 38 files, 682 tests, a few seconds: reducer rules, selector maths, persistence round-trips, the sync engine and its outbox, and render tests that drive the real screens (tap a checkbox, assert the count moves). Supabase is mocked there, so it needs no Docker and no database. `tsc` runs in strict mode. CI runs typecheck, lint and this suite in one job, and the integration suite below in a second — on pushes to `main` and on every pull request, so a feature branch with no PR open gets no CI at all.

The database tests are separate:

```bash
npm run test:integration
```

That needs Docker running. It starts a local Supabase stack for you if one isn't up, and **reuses one that already is** — which also means it won't stop a stack it didn't start, so a second run begins in seconds rather than a minute. Then it resets the database once, and each test truncates the mutable tables rather than paying for another reset. Everything currently lives in `integration/rls/`, which walks the policies person by person — what maya can see of dre, of sofia, of a stranger — and covers the write paths alongside them: joining a circle by code, pairing on a task, reacting, accepting an invite. There is still **no** integration coverage of the sync layer itself: `src/sync/` is exercised entirely by unit tests against the fake in `src/__mocks__/@supabase/supabase-js.ts`, which `mock.test.ts` keeps honest by pinning the fake's refusals to the real constraints in `supabase/migrations/`. A fake that agrees with the schema is not the same as the schema, and that gap is deliberate rather than forgotten. They run serially on purpose: `aud = 'everyone'` rows are visible to everyone by definition, so parallel workers sharing one database would leak into each other's negative assertions.

To drive the stack yourself:

```bash
npm run db:start
```

```bash
npm run db:reset
```

`db:start` brings the containers up; `db:reset` reapplies every migration and `supabase/seed.sql`, which is how you get back to a known world after poking at rows by hand.

Rally's local stack uses ports in the **553xx** range rather than Supabase's default 543xx — 55321 for the API, 55322 for Postgres, 55323 for Studio. That's so it can run at the same time as another local Supabase project on the same machine without either of them refusing to start. Nothing reads those numbers from a hardcoded constant; the test harness asks `supabase status` for the real URLs, so changing `supabase/config.toml` is enough.

## Bugs found and fixed after the first pass

Driving the app on a second platform and writing render tests each turned up defects the first build hid:

- **Android:** the Plan hero glow used a text shadow, which Android clips to the glyph box — it drew a lit rectangle behind "190". Now iOS-only.
- **Android:** the year grid wrapped to 12 columns instead of 13; a fractional cell width overflowed the row by a fraction of a pixel. Widths are floored now.
- **Unstaking a suggestion left it dead.** Staking "Stretch every night" from PICK IT BACK UP and then unstaking it left the card reading "Staked ✓" forever, with no way to stake it again. The card now returns to the rail.
- **A crash in the engagement buttons** when they were invoked without a touch event. Guarded.

## Known limits

- **Simulator only.** Running on a physical iPhone needs an Apple developer team for signing, which I can't set up for you. Once you add one in Xcode, `npx expo run:ios --device` will do it.
- **The two-device test has not been run.** One person, one simulator, is the whole of the testing so far. Two accounts on two devices over a real network — the thing the sync layer exists for — is untested outside `integration/`, and is the last box to tick before handing anyone a build.
- **On iOS an account can now be got back; on Android it still cannot.** Me offers "Secure this account" on a live iOS account, which attaches an Apple identity and keeps the same user id. "Continue with Apple" on the Welcome screen then signs that account back in — and a reinstall is no longer the only way to reach it, see below. `expo-apple-authentication` is iOS-only, so an Android account has no way back until Google sign-in lands, and there both buttons stay inert under the coming-soon line.
- **A signed-in account can now sign out — once it's secured.** Settings, off the foot of Me, holds the account's state, your name, notification permission, Apple linking, and sign-out. Sign-out only works on a secured (non-anonymous) account: an anonymous account's uuid lives nowhere else, so leaving it would strand everything it owns on the server for good. Because `expo-apple-authentication` is iOS-only, no Android account can be secured, and so none can sign out either — the Account section says so in as many words rather than just omitting the row. Signing out clears the device and lands back on the Welcome screen's onboarding flow, which means the "Continue with Apple" recovery path can now be exercised on the same install, without a reinstall. Sign-out itself refuses while anything is still unsent, naming the count — and, worth knowing rather than papering over, `flushOutbox` persists the queue but does not send it, and the send it kicks off (`kickSync`) returns void and can't be awaited, so a device with a drainable queue is refused on the first tap and goes through on a retry a moment later.
- **Recovery restores history too, but only onto a device that has none.** Signing back in brings identity, name, circle, invite code, the current week, notes, reactions, notifications — and now the closed weeks, the year grid and the Me screen's totals. The restore deliberately does nothing if the device already has any history: weeks are identified by an ISO week number that repeats every year, so gap-filling would eventually fuse two different years' week 33. A reinstall has no history, which is the case that matters.
- **A restored week shows no "what you did" list.** `did` is empty on weeks that came back from the server. The titles are on the server, in `tasks`, but the engine only pulls the current week — so the numbers return and the list does not. `helpedBy` and `helped` are empty on a locally-closed week too, so a restored week reads exactly like one this device closed.
- **Securing an account needs the paid Apple programme.** Linking requires the `com.apple.developer.applesignin` entitlement, so the flow cannot be exercised on a build signed with a free Apple ID — the button is there and Apple refuses. Everything below that line is unit-tested; the flow itself is not verified on device.
- **Nothing reports crashes.** There is no Sentry or equivalent, so a crash on someone else's phone is a crash you never hear about.
- **Android is verified but less exercised.** I built the release APK, walked Join → Plan → Week → Me on a Pixel 9 Pro emulator and fixed the two platform bugs it surfaced (above), but I didn't drive every screen there the way I did on iOS.
- **The Feed tab stays populated on a fresh account** — it is where a new account lands, and it holds your circle and the public feed in one list, each card labelled Friends or Follow. The public half is the four Oz bots: openly fictional, readable by everyone, and real rows rather than a fixture on a live account. With no circle it closes with a line saying the Follow accounts are not real, and an invite CTA.
- **Not encrypted at rest** beyond what iOS and Android do themselves. It is kept out of both platforms' backups. See the README for what to do before this holds real content.
- **Reports go into a queue nobody reads.** `report_content` files a row and that's the end of it — there is no moderation team, and `reports` is unreadable even by the person who filed it (RLS on, no policy, no grant to any role but the table's owner; see `docs/backend.md`). The queue exists so a moderation job could exist later; today, filing a report changes only what your own device chooses to hide.
- **A blocked circle member still shows up in the ranked list and still counts toward circle totals.** Deliberate, not a gap: a rollup is a number the circle's shared arithmetic is made of, and filtering it would make "how did we do this week" answer differently depending who's asking. See `week_rollups_select` in `docs/backend.md`.
- **Blocking is inferable.** Nothing in the app names a block — no screen, no toast, no notification — but a blocked person's cheers stop landing and their name stops turning up, and an attentive person can work out what happened.
- **Content hidden by a report is device-local and does not sync; content hidden by a block does.** `reports` is unreadable even by its own author, so there is nothing for another device to pull — the same account signed in on a second device still sees the reported content. Blocking is enforced server-side by RLS, so it follows you: block someone on one device and their content is gone on the other the next time it syncs.
- **Reporting and blocking have not been run on a physical device**, same as everything else in this list.
- **Nothing verifies either image screener is any good.** What's tested is the plumbing and the fail-closed verdict shape (`imageVerdict.mjs`, pinned in `src/lib/__tests__/imageVerdict.test.ts`) — not whether the model's judgement on an actual photo is right. That needs a corpus of real images and a human looking at the results, which this pass did not build. The goal-photo prompt (`GOAL_IMAGE_SCREENING`) is a harder case than the avatar one and less exercised: most goal photos have no face in them, so the "answer no to everything else" list is doing more work than usual.
- **The real Gemini API was never called for image screening during development.** The wire shape of both `screen-image` and `screen-task-media` was exercised against a stub `LLM_BASE_URL` (see `supabase/functions/README.md`) and documented-verified against Gemini's published response shape, not hit live. The first real upload against a deployed function with `GEMINI_API_KEY` set is genuinely untested. `screen-task-media` has additionally never been run through the Deno runtime at all — `npm run typecheck` excludes `supabase/functions`, so it has had no compiler over it either.
- **Screening shares `rate-goal`'s 200/day cap** — one counter (`bump_llm_usage`) across all three functions, not a separate budget for photos. Over the cap both screeners refuse rather than leaving an upload stranded; a burst of photos can now spend the quota `rate-goal` needs for pricing goals from two directions instead of one.
- **If the app is killed between upload and screening**, the row is left `pending` over an object nobody ever asks about again on that device. A resume runs once per session, the next time the app opens signed in (`src/sync/engine.ts`'s `resumeAvatar`), and finishes the screening. If the user never opens the app again on any device, the object stays in the bucket — there is no server-side sweep for it.
- **Goal photos are screened too, and the gate is stricter than the avatar one.** `task_media.state` starts `pending`, and both the row policy and the storage policy refuse a `pending` photo to everybody except its owner — so an unscreened image cannot be signed for, not merely not-rendered. `screen-task-media` is the only route to `ready`. The owner is exempt on purpose: they chose the picture and their own card draws it off local disk. Pinned in `integration/rls/task_media.test.ts` (`until a model has looked at it`).
- **Nothing reads anybody else's goal photo yet.** `pull_world` returns no media, so today the gate is protecting a road nobody drives. That is why it landed before the read path rather than after — there is no ungated fetch for that increment to forget.
- **A goal photo refused after the app is killed is retried, not lost track of.** The media lane persists its `phase`, so an entry that uploaded but never got a verdict asks again on the next drain. But if the app is never opened again on that device, the row stays `pending` and the object stays in the bucket — the same absent server-side sweep as avatars.
- **EXIF stripping was verified by reading the native encoder's behavior, not by inspecting an encoded file.** `expo-image-manipulator`'s re-encode is the only thing that removes metadata — there's no explicit strip step — and the claim that iOS's `UIImage.jpegData` and Android's `Bitmap.compress` drop it rests on how those APIs are documented to work, not on running a tool like `exiftool` against a real uploaded photo and confirming an empty result.
- **Avatar upload, screening, and the resume path have not been run on a physical device.** Same limit as everything else in this list — one simulator, one account, is the whole of the testing so far.
