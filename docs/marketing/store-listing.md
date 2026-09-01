# App Store listing copy

Written in the app's own voice (`HANDOFF.md`, *Voice & copy rules*): plain,
warm, second person, slightly blunt. Every claim below is true of the code on
`main`. Nothing promises a global community, money stakes, or Android.

Character limits are Apple's as of September 2026. Counts are given so you
can paste without trimming.

## App Store Connect fields

**Name** (30 max, 25 used)

```
Rally — Stake your week
```

**Subtitle** (30 max, 26 used)

```
Weekly goals, with friends
```

**Keywords** (100 max, 98 used, no spaces after commas)

```
accountability,goals,habit,friends,weekly,buddy,circle,commitment,planner,cheer,tracker,motivation
```

"Rally" is not in the keyword field on purpose: the name is indexed already,
and the term is owned by unrelated apps.

**Promotional text** (170 max, editable without a release; 115 used)

```
New: circles. Make one, share the code, and the people you actually know are the only ones who see what you staked.
```

**Description** (4,000 max)

```
Rally is for the goals you would actually keep if someone were watching.

Every Monday you stake a handful of things on the week: run three times, ship the thing, be in bed by eleven. Your circle sees what you put on the line. When you close one, they cheer, and it lands on your phone with their name on it. When you close all of them, that's a perfect week, and the whole circle knows.

On Sunday the week closes and asks what carries. Nothing resets. No streak to lose. Just the next week.

WHAT IT IS
• Stake up to a few goals a week, each worth points by how hard it is
• A circle of people you actually know — invite by code, nobody else gets in
• Cheers that reach the other person's phone
• A ranking by follow-through, not by who stakes the most
• A weekly ledger: what you did, who helped you, who you helped
• Pair up on a goal with a friend who's in it with you

WHAT IT ISN'T
• Not a streak counter. A missed day costs you that day, not your history.
• Not a public feed. Your goals are seen by your circle unless you choose otherwise.
• Not a money-stakes app. The stake is your word, and the people who heard it.

PRIVATE BY DEFAULT
Rally has no ads, no analytics, no trackers. It asks for no email, no phone number, no location. Sign in with Apple if you want your account to survive a new phone; skip it if you don't. You can delete your account from inside the app, and it's gone in fourteen days.

Rally is new. It's built by one person, and the circles using it right now are the ones who found it first. If yours is one of them, the support address is on this page and a real person reads it within a day.

The week doesn't count itself.
```

**What's New, 1.0:** `First week. Stake something.`

**Category:** Productivity (primary), Health & Fitness (secondary).

**Age rating:** 4+ is not honest with user-generated notes and photos; answer
the questionnaire for infrequent user-generated content and let Apple assign
12+. The report and block controls exist for exactly this.

**URLs:** privacy and support from `docs/legal/README.md`, marketing URL
`https://rallyweek.app` once it is live.

**App Privacy questionnaire:** `docs/legal/README.md`, step 4, verbatim. Name,
photos, other user content, user ID and device ID (the push token) collected
and linked to identity; nothing used for tracking; no analytics, no
advertising, no crash reporting.

## TestFlight — What to Test (4,000 max)

Shown to every tester who opens the public link.

```
Rally is a weekly goals app for a circle of friends. Thanks for being in the first one.

THIS WEEK
1. Tap "Get started" and give yourself a name. (Or "Look around first" to see a populated demo; you can reset from the bottom of Me.)
2. On the Circle tab, enter the code your captain sent you.
3. Stake two or three real things on the week from the + button. Pick a day, pick a category, choose who sees it.
4. Close one when you actually do it. Cheer someone else's.
5. On Sunday, look at the ledger, and let the week roll over on Monday.

WHAT I'M WATCHING FOR
• Did a cheer reach your lock screen? (If not, tell me what phone and iOS version.)
• Anything that made you unsure what to tap.
• Any moment the app said something that wasn't true of your week.

The bug channel is the support address on this page. I reply within a day.
```

## App Review notes

Paste into *App Review Information → Notes*. Reviewers reject what surprises
them; nothing here should.

```
Rally is a private goal-tracking app for small circles of friends. No account credentials are needed: tap "Look around first" on the welcome screen for a fully populated demo account (fixture data, no network), or "Get started" for a live anonymous account.

Things you will see that are intentional:
• The "Global" scope on the Week tab shows posts from the Oz bots (Dorothy Gale, The Scarecrow, Tin Man, Cowardly Lion). They are fictional demo characters, labelled as such in the app, and are the only accounts on that feed. No real user's content is shown to strangers.
• User-generated content (goal titles, notes, photos) is visible only to a user's own circle. Report and Block are on every person and every post (Guideline 1.2). Reports are reviewed within 24 hours.
• Account deletion is in Me → Settings → Delete my account (Guideline 5.1.1(v)). It schedules deletion and completes in 14 days; the privacy policy describes this.
• Sign in with Apple is optional and only links an existing anonymous account so it survives a new phone.
• Photo library access is requested only when a user chooses to add a profile photo or attach a photo to a closed goal.
```

## Screenshots

Five, portrait, from the iPhone 16 Pro simulator via `npm run sim` on the
demo account, which is populated and pixel-identical to the design. Apple
wants the 6.9" set; it derives 6.5" from it. Each carries one caption, set in
Bricolage Grotesque 800 on paper `#F1F2EC` above the frame. Order matters;
the first two are seen without swiping.

| # | Screen | Caption |
|---|---|---|
| 1 | Week / Personal, three stakes, one closed | **Stake it on Monday.** |
| 2 | Week / Friends, a perfect-week card with cheers | **Your circle sees it land.** |
| 3 | Plan overlay, composer filled, "In it with me" chips | **Pair up on the hard ones.** |
| 4 | Circle, podium and follow-through list | **Ranked by follow-through, not noise.** |
| 5 | Week ledger, all three sections | **Sunday closes the week. Nothing resets.** |

Do not use the Global scope in any screenshot; the people on it are the Oz
bots. Do not use Notifications; it reads as clutter at thumbnail size.

## App preview video

Skip it for 1.0. Fifteen seconds of a stranger's demo account tells less than
screenshot two, and it costs a day.

## Review request (compliant)

Ask once, after someone's first perfect week, by message, never in exchange
for anything. Only store installs can rate; TestFlight installs cannot.

> You just closed a perfect week, which about one in five people do. If Rally
> had anything to do with it, an honest rating on the App Store is the one
> thing that helps the next circle find it. If it didn't, tell me what would
> have.

## Later, for Android

The description above is the Play full description as written. Play's short
description (80 max, 76 used): `Stake a few goals on the week. Friends see
them, cheer, and keep you honest.` Nothing else changes.
