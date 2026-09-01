# App Store listing

Final metadata, with the reasoning in `research/market-and-aso.md` and the
decision in `PLAN.md` §6. Every claim is true of the code on `main`. Nothing
promises a global community, money stakes, or Android. Character counts are
exact so you can paste without trimming.

## Metadata

**Name** (30 max, 25 used)

```
Rally: Goals with Friends
```

Why: "Rally" alone is owned in search by racing games and social-planning
apps. *Goals* and *friends* are the two words Rally can own, and "with
friends" is the pattern people already search for HabitShare-class apps.
"Habit tracker" is avoided on purpose: 248 apps compete for it.

**Subtitle** (30 max, 28 used)

```
Weekly accountability circle
```

Why: three fresh indexed words. *Weekly* is the differentiator; *accountability*
is the category word, steered toward the partner sense rather than the
content-monitoring sense that dominates the bare term; *circle* is Rally's own
noun and feeds Apple's LLM-generated tags.

**Keywords** (100 max, 94 used, no spaces after commas)

```
habit,tracker,buddy,partner,commitment,challenge,cheer,streak,planner,motivation,social,ledger
```

Why: no word repeats the name or subtitle (Apple's rule); *habit* + *tracker*
still reach "habit tracker with friends" without spending title space;
*partner* + *buddy* complete "accountability partner/buddy"; *streak* so Rally
appears for streak searches despite the pitch; *cheer* and *ledger* are
Rally's vocabulary.

**Promotional text** (170 max, not indexed, editable without a build)

October (109):
```
Fresh week, fresh start. Make a circle, share the code, and the people you actually know see what you staked.
```

January (121):
```
The week after Quitter's Day is a Monday. Stake something small, let your circle see it, and let Sunday close the week.
```

**Description** (4,000 max)

```
Rally is for the goals you would actually keep if someone were watching.

Every Monday you stake a handful of things on the week: run three times, ship the thing, be in bed by eleven. Your circle sees what you put on the line. When you close one, they cheer, and it lands on your phone with their name on it. When you close all of them, that's a perfect week, and the whole circle knows.

On Sunday the week closes and asks what carries. Nothing resets. No streak to lose. Just the next week.

A WEEK, NOT A STREAK
• Stake a few goals a week, each worth points by how hard it is
• A missed day costs you that day, not your history
• Sunday's ledger: what you did, who helped you, who you helped

FRIENDS, NOT STRANGERS OR FINES
• A circle of people you actually know. Invite by code; nobody else gets in
• Cheers that reach the other person's phone
• Pair up on a goal with a friend who's in it with you
• A ranking by follow-through, not by who stakes the most

NOTHING TO SELL YOU, NOTHING WATCHING YOU
• No subscription, no ads, no analytics
• No email, no phone number, no location
• Sign in with Apple if you want your account to survive a new phone; skip it if you don't
• Delete your account from inside the app. It's gone in fourteen days

Rally is new. It's built by one person, and the circles using it right now are the ones who found it first. If yours is one of them, the support address is on this page and a real person reads it within a day.

The week doesn't count itself.
```

**What's New, 1.0:** `First week. Stake something.`

**Category:** Productivity (primary), Health & Fitness (secondary).

**Age rating:** answer the questionnaire honestly for infrequent
user-generated content (notes, photos); expect 12+. Report and block exist
for exactly this.

**URLs:** privacy and support from `docs/legal/README.md`; marketing URL
`https://rallyweek.app`.

**App Privacy questionnaire:** `docs/legal/README.md`, step 4, verbatim.

## TestFlight: What to Test (4,000 max)

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

Reviewers reject what surprises them. Paste into *App Review Information →
Notes*.

```
Rally is a private goal-tracking app for small circles of friends. No credentials are needed: tap "Look around first" on the welcome screen for a fully populated demo account (fixture data, no network), or "Get started" for a live anonymous account.

Things you will see that are intentional:
• The "Global" scope on the Week tab shows posts from the Oz bots (Dorothy Gale, The Scarecrow, Tin Man, Cowardly Lion). They are fictional demo characters, labelled as such, and the only accounts on that feed. No real user's content is shown to strangers.
• User-generated content (goal titles, notes, photos) is visible only to a user's own circle. Every person and post has Report and Block (Guideline 1.2). Reports are reviewed within 24 hours. Goal text and images are screened server-side before they are shown to anyone.
• Account deletion is in Me → Settings → Delete my account (Guideline 5.1.1(v)). It schedules deletion and completes in 14 days; the privacy policy describes this. Sign in with Apple tokens are revoked on deletion.
• Sign in with Apple and Continue with Google are both offered, and both only link an existing anonymous account so it survives a new phone (Guideline 4.8).
• Photo library access is requested only when a user chooses to add a profile photo or attach a photo to a closed goal.
```

## Screenshots

Five, portrait, 6.9" at 1260×2736 (Apple derives 6.5"). Taken on the iPhone
16 Pro simulator via `npm run sim` on the demo account, which is populated
and pixel-identical to the design. Each carries one caption in Bricolage
Grotesque 800 on paper `#F1F2EC` above the frame. Order matters; the first
two are seen without swiping, and Apple's tag generator reads them.

| # | Screen | Caption |
|---|---|---|
| 1 | Week / Personal, three stakes, one closed | **Stake it on Monday.** |
| 2 | Week / Friends, a perfect-week card with cheers | **Your circle sees it land.** |
| 3 | Circle, podium and follow-through list | **Ranked by follow-through, not noise.** |
| 4 | Plan overlay, composer filled, "In it with me" chips | **Pair up on the hard ones.** |
| 5 | Week ledger, all three sections | **Sunday closes the week. Nothing resets.** |

Never the Global scope (fictional people). Never Notifications (clutter at
thumbnail size).

## Custom Product Pages (free, up to 70)

Four at launch, each a keyword-assigned page whose screenshot 1 is swapped:

| Page | Keywords assigned | Screenshot 1 | Linked from |
|---|---|---|---|
| Partner | accountability partner, accountability buddy | Circle screen | Discord, Reddit |
| Runners | running goals, run with friends | Personal week with "Run 5k ×2" staked | run club, Strava |
| Writers | writing goals, word count | Personal week with "Write 500 words ×4" | writing Discords, November |
| Founders | ship weekly, side project | Personal week with "Ship one small thing" | Show HN, r/SideProject |

## In-App Event (January)

Name (30): `Week 1 of the New Year`
Short (50): `Stake something small. Let your circle see it.`
Long (120): `The week after Quitter's Day is a Monday. Stake one thing, close it, and let Sunday close the week for you.`
Dates: 4–31 January 2027. Submit by 20 December.

## App preview video

Skip for 1.0. Screenshot two says more than fifteen seconds of a stranger's
demo account, and it costs a day. Revisit at the $500 tier.

## Ratings

Only store installs can rate. Ask once, after someone's first perfect week,
by message, never in exchange for anything:

> You just closed a perfect week, which about one in five people do. If Rally
> had anything to do with it, an honest rating on the App Store is the one
> thing that helps the next circle find it. If it didn't, tell me what would
> have.

Apple's native prompt is capped at three per year per user; wire it to the
first perfect week only (product ask 8 in `PLAN.md`).

## Featuring nomination

Submit in App Store Connect → Featuring Nominations by 10 September. Text in
`outreach.md` §10.
