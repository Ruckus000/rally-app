# Store listing copy

Written in the app's own voice (`HANDOFF.md`, *Voice & copy rules*): plain,
warm, second person, slightly blunt. Every claim below is true of the code on
`main`. Nothing promises a global community, money stakes, or iOS.

Character limits are Google's and Apple's as of September 2026. Counts are
given so you can paste without trimming.

## Google Play

**App name** (30 max, 22 used)

```
Rally — Stake your week
```

**Short description** (80 max, 79 used)

```
Stake a few goals on the week. Friends see them, cheer, and keep you honest.
```

**Full description** (4,000 max)

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
Rally has no ads, no analytics, no trackers. It asks for no email, no phone number, no location. You can delete your account from inside the app, and it's gone in fourteen days.

Rally is new. It's built by one person, and the circles using it right now are the ones who found it first. If yours is one of them, the support address is in the app listing and a real person reads it within a day.

The week doesn't count itself.
```

**Category:** Productivity. (Health & Fitness is more crowded and only half
true.)

**Tags:** goals, accountability, habits, friends

**Contact:** the support email and the two legal URLs from `docs/legal/README.md`.

**Data safety form** — answer from `docs/legal/README.md`, step 4: name,
photos, user content, user ID and device ID (the push token) collected and
linked to identity; nothing shared for advertising; no analytics; in-app
account deletion exists. Google compares the form to the policy.

## App Store (for when the $99 exists)

**Name** (30 max): `Rally — Stake your week`

**Subtitle** (30 max, 28 used): `Weekly goals, with friends`

**Keywords** (100 max, 99 used, no spaces after commas):

```
accountability,goals,habit,friends,weekly,buddy,circle,commitment,planner,cheer,tracker,motivation
```

"Rally" is not in the keyword field on purpose: the name is indexed already,
and the term is owned by unrelated apps.

**Promotional text** (170 max, editable without a release):

```
New: circles. Make one, share the code, and the people you actually know are the only ones who see what you staked.
```

**Description:** the Play full description, as written.

**What's New, 1.0:** `First week. Stake something.`

## Screenshots

Five, portrait, taken on the iPhone 16 Pro simulator via `npm run sim` on the
demo account, which is populated and pixel-identical to the design. Google
accepts phone screenshots at any 16:9 to 9:16 ratio; Apple wants 6.9" and
6.5" sets, which the simulator produces.

Each carries one caption, set in Bricolage Grotesque 800 on paper `#F1F2EC`
above the frame. Order matters; the first two are the ones people see without
swiping.

| # | Screen | Caption |
|---|---|---|
| 1 | Week / Personal, three stakes, one closed | **Stake it on Monday.** |
| 2 | Week / Friends, a perfect-week card with cheers | **Your circle sees it land.** |
| 3 | Plan overlay, composer filled, "In it with me" chips | **Pair up on the hard ones.** |
| 4 | Circle, podium and follow-through list | **Ranked by follow-through, not noise.** |
| 5 | Week ledger, all three sections | **Sunday closes the week. Nothing resets.** |

Do not use the Global scope in any screenshot; the people on it are the Oz
bots. Do not use Notifications; it reads as clutter at thumbnail size.

## Feature graphic (Play, 1024×500)

Ink `#191E16` ground. The Gather mark in lime at left, 220px. Right of it, in
Bricolage 800, paper text: `Stake your week.` on one line, `Your friends keep
you honest.` in Instrument Sans 500 at 60% alpha beneath. No device frame, no
screenshots; Play shows those separately.

## Review request (compliant on both stores)

Ask once, after someone's first perfect week, by message, never in exchange
for anything:

> You just closed a perfect week, which about one in five people do. If Rally
> had anything to do with it, an honest rating on the store is the one thing
> that helps the next circle find it. If it didn't, tell me what would have.
