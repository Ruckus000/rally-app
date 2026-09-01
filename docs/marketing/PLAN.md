# Rally: the marketing plan

> Version 2, 1 September 2026. iOS-only launch on a paid Apple Developer
> account, no Google Play account, $50 cash budget. Every product claim was
> read from the repo at `main` (#125). Every market claim is sourced in
> `research/` and carries the caveats written there; several numbers are
> secondary estimates and are marked as such. Where this plan disagrees with
> what you might want to hear, it says so, once, and moves on.

## 0. Executive summary

Rally sits in a real gap: every accountability app the research found is
either **money stakes** (stickK, Beeminder, Forfeit, Accountablo) or **daily
streaks** (HabitShare, Habitica, Streaks, Finch, Habitat, Daily Pact). Nobody
found occupies **friends + no money + weekly cadence + free**. The customers
we listened to describe the category's failures in three phrases Rally's
design answers directly: "it fizzled out," "nobody is really watching yours,"
and "when life interrupts the streak the whole thing falls over."

The plan is bottom-up because the product is. Rally's unit of value is a
**circle**, not a user; a single install lands on "A circle of one" and
churns. So every dollar and hour goes to acquiring *circles*: five founding
captains from your own network in September, one physical group and two
Discord servers in October, writers' groups in November, and the January
peak with eight weeks of real ledgers behind you. Paid acquisition is off the
table at $50, and the research says it is off the table at $500 too: Apple
Ads throttles below about $30 a day, and Reddit's $5 floor buys three clicks.

The $50 buys one thing that matters, the invite link (`rallyweek.app`, $9.99),
and holds the rest against two named triggers. The real budget is about 30
hours of your time over six weeks. The plan's success metric is not installs.
It is **circles that stake in three consecutive weeks**. Three of those by
mid-October earns wider outreach; zero means no marketing spend would have
helped, and the money was saved.

Three things marketing cannot fix and product must, before 5 October: the
share message needs a tappable link; push needs the APNs key or the thesis is
untested; and nothing in the app ever suggests starting a second circle,
which is the only loop that grows the app. Details in §11.

## 1. Situation analysis

### 1.1 The market

The habit and goal category is large, badly measured, and seasonal. Syndicated
estimates range from $1.9B (Straits, 2025) to $13B (Business Research
Insights); the disagreement is the finding. What is solid: freemium
subscriptions are about half the category's revenue; Finch alone is estimated
at ~$2M/month on iOS; HabitKit, a solo-developer habit tracker, made $602K in
2025 with ~98% of revenue from App Store search on one keyword. (Sources and
caveats: `research/market-and-aso.md` §1.)

Seasonality is the one thing the data agrees on. Adjust's health-tracker set
shows January installs 36% above December and 34% above the first-half
average, decaying to −44% by May. The "Fresh Start Effect" literature (Dai,
Milkman, Riis) shows the same jump at Mondays, first-of-month and new terms.
Rally's Monday-stake, Sunday-ledger design sits exactly on the weekly
landmark, and the plan is timed to be established before the January one.

### 1.2 The competition

Seventeen products were torn down (`research/competitors.md`). The map:

| | Strangers / solo | Friends |
|---|---|---|
| **Money stakes** | stickK, Beeminder, Forfeit, Accountablo, GoalsWon, all daily | Goals: Fitness Accountability (weekly, fitness-only, paid) |
| **Social / points stakes** | Focusmate, Cohorty, Habit Huddle (daily) | HabitShare, Habitat, Daily Pact, BuddyUp, Habitica parties (daily streaks); **Rally (weekly, points)** |
| **No external stakes** | Finch, Streaks, Habi (daily streaks, solo) | — |

The five complaints that recur across the category's reviews, and Rally's
answer to each:

1. **Billing surprises and paywalls** (Finch's trial-to-annual, Forfeit's "$8
   monthly," Habitat Premium). Answered: no IAP, and the listing says so.
2. **Sync bugs that corrupt the record** (Habitica "resetting streaks… damage
   to party members," HabitShare "server sync issues every time you open
   it"). Partly answered: a weekly ledger tolerates a late sync better than a
   midnight streak, and Rally's outbox design was built for this. Still has
   to be proven in public.
3. **Unescapable money consequences** (stickK "can't get released"). Answered
   by design.
4. **Streak anxiety** (Habitica overnight damage, Streaks resets). Answered:
   no streaks, a week that closes and reopens.
5. **Unresponsive support** (stickK "zero reply," Habitica "5–10 days"). Not
   answered, and this is how free-with-friends apps earn their 3.3 stars. The
   24-hour promise on the legal pages is a marketing asset only if kept.

The skeptic's case, from the same research: cold start is brutal (HabitShare
admits it "works best when you add friends"); no revenue and no analytics
means no leverage; and points without consequences may be too soft next to
Forfeit's claimed 94% completion on money stakes. §3 takes these seriously.

### 1.3 The customer

Thirty-one verbatim quotes, mostly from Hacker News and long-form blogs since
Reddit was unreachable (`research/voice-of-customer.md`). Four personas fall
out of them:

- **Dev the Solo Builder**: "It feels like nobody cares." Tried Discords
  ("too noisy and easy to disappear from"). Wants one person watching him
  specifically.
- **Priya the Streak Refugee**: kept an 800-day streak "on the days I
  couldn't," lost it, quit for two years. Wants a system where "a few missed
  days will not completely destroy your progress."
- **Marcus the Beeminder Skeptic**: "there's something stopping me." Wants
  accountability "with an actual human being," not a fine.
- **Jo the Group-Chat Organizer**: started the January goals chat; "it
  fizzled out." Wants to not be the nag.

The jobs, in their words: "someone waiting for me"; "one person watching you
specifically" because "when everyone is posting goals, nobody is really
watching yours"; a place to "stick with it long enough to do any meaningful
progress"; a reason to talk to friends weekly. Where they gather: r/
getdisciplined and r/productivity (promotion banned outside weekly threads),
r/GetMotivatedBuddies (partner matching), Discord servers tagged
*accountability* (Study Together, Studio, Accountability Buddies), Show HN,
university accountability programs, Strava clubs.

**Primary segment for launch: Jo.** Jo already has the circle; Rally only has
to be the place it doesn't fizzle. Dev and Priya are the November and January
segments respectively (writers' Novembers; streak refugees after Quitter's
Day, the second Friday of January). Marcus is the Show HN audience.

## 2. Objectives

| Horizon | Objective | Number |
|---|---|---|
| 20 Sep | Founding cohort proves the thesis on real phones | 3 circles of 3+, cheers ≥2 per member per week |
| 5 Oct | Public on the App Store with proof | 5+ honest ratings, 1 quotable perfect-week story per circle |
| 30 Nov | Circles that survive | 6 alive circles (3 straight weeks), 1 writers' circle, first second-circle created by a non-captain |
| 4 Jan 2027 | Established before the peak | listed 3 months, featuring nomination in for New Year, In-App Event live, invite link in the app |

## 3. The honest assessment

A skeptical board member's five objections, and what the plan does about each.

1. **$50 buys a link, not attention.** Apple Ads Advanced has a $1/day
   minimum but throttles delivery below roughly $30/day; the US median cost
   per tap is near $2. Reddit's $5/day floor yields about three clicks. No
   paid channel exists at this budget. The plan therefore spends $9.99 and
   treats your hours as the budget. This is not a compromise; the comparable
   launches in `research/earned-media.md` §4 (HabitKit, Habitify, Structured,
   Focusmate) all grew on one keyword, one feature, one creator, or existing
   communities. Nobody's launch-day spend mattered.
2. **The unit is a circle, not a user.** Every individual-delivering channel
   delivers churn. So the plan recruits groups, and the north-star metric is
   alive circles.
3. **The invite loop has no link.** The share message is a code with nowhere
   to tap. Referral benchmarks put deep-linked invites at +65% conversion
   over plain ones. `rallyweek.app/join?code=` exists in this branch; the
   one-line app change is §11.
4. **Push is untested on a real phone.** The APNs key is the missing piece
   and "a cheer landing on someone's phone is the product's whole thesis"
   (`docs/backend.md`). Founding cohort does not start until a cheer has
   buzzed your own phone.
5. **Nothing is measured.** No analytics by policy. `metrics.sql` is the
   dashboard; §9 defines what to read from it and when.

Three smaller ones: the Global feed is fictional (the Oz bots), so never
market a global community and tell App Review up front; "Rally" is an
unwinnable search term crowded by racing games and, worse, by social-planning
apps ("Rallly – Plans with Friends," "Let's Rally!"), so brand search is not a
channel and there is a trademark clearance question (RedBrick Health's RALLY
covers "health challenges"; not legal advice, worth a real search before
spending on the brand); and iPhone-only excludes the Android friend in
roughly four US circles in ten.

## 4. Positioning and messaging

**Positioning statement.** For small groups of friends who already talk about
their goals and want the talk to count, Rally is the weekly accountability
circle that turns "I'll do it this week" into something your friends can see,
cheer, and hold you to. Unlike money-stakes apps (stickK, Beeminder, Forfeit)
and streak trackers (HabitShare, Habitica, Streaks), Rally stakes a week, not
a day, with people you know, not strangers or fines. Free, no ads, no
analytics.

**One line:** *Stake your week. Your friends keep you honest.*

**Three pillars, each with a proof point from the code:**

| Pillar | Customer phrase it answers | Proof in the product |
|---|---|---|
| **A week, not a streak** | "when life interrupts the streak the whole thing falls over" | Sunday closes the week and asks what carries; nothing resets; a week holds the streak bar if one stake closed |
| **Friends, not strangers or fines** | "with an actual human being"; "nobody is really watching yours" | Private circles by invite code; cheers land on the other person's phone with your name; "in it with me" pairing |
| **Nothing to sell you, nothing watching you** | "one more tab you'll forget to open"; billing-surprise reviews | No IAP, no ads, no analytics, no email; in-app deletion; anonymous sign-in |

**Tone** (from `HANDOFF.md`): plain, warm, second person, slightly blunt.
Stakes language: *staked, on the line, in it with me, pick it back up, the
week doesn't count itself.* Never guilt-trip. Never a bare zero.

The full framework, tagline options, objection handling and a copy bank are
in `messaging.md`.

## 5. Brand and the name

Keep the name; fix the surface. "Rally" is generic in search, so the App
Store title carries the meaning: **Rally: Goals with Friends**. The spoken
name in outreach is "Rally" and the written first mention is always
"Rally, a weekly goals app for a circle of friends," so nobody googles a
racing game. The Gather mark is strong and one-colour on lime; the landing
page and every asset use it as generated from `src/theme/mark.ts`. Bricolage
Grotesque headlines, Instrument Sans body, ink and lime, across the store
listing, the landing page, and social images, so a screenshot from any of
them is recognisably the same thing.

## 6. App Store strategy

The store is the one channel where Rally can rank for something it owns.
The research's conclusion (`research/market-and-aso.md` §2, §6) is to avoid
"habit tracker" (248 competitors, HabitKit at #2) and to avoid the bare word
"accountability" (dominated by content-monitoring apps), and instead own the
long tail: *goals with friends, accountability partner, weekly goals,
accountability buddy, goal circle.*

| Field | Decision | Why |
|---|---|---|
| Title (30) | `Rally: Goals with Friends` (25) | The two words Rally can own, in the highest-weight field; matches the "with friends" pattern users already search |
| Subtitle (30) | `Weekly accountability circle` (28) | Three fresh indexed words; steers "accountability" toward the partner sense; "circle" is Rally's own noun and feeds Apple's LLM tags |
| Keywords (100) | `habit,tracker,buddy,partner,commitment,challenge,cheer,streak,planner,motivation,social,ledger` (94) | No repeats of title/subtitle words; covers "habit tracker with friends" and "accountability partner/buddy" by cross-field combination; "streak" so Rally shows for streak searches despite the pitch |
| Category | Productivity primary, Health & Fitness secondary | Less crowded than H&F; secondary keeps the fitness circles findable |
| Promotional text (170) | seasonal, swapped without a build | "Fresh week, fresh start" in October; "The week after Quitter's Day" in January |

**Featuring nomination: submit by 10 September.** Apple's form (App Store
Connect → Featuring Nominations) wants three weeks' notice minimum; it takes
TestFlight links, so the app need not be live. Nominate three times: the
October launch, a January "fresh start" update, and the accessibility work
already in the build (44px targets, reduced motion, labelled controls). The
"helpful details" field is where no-ads, no-analytics, no-streaks fits
Apple's editorial narrative. Text in `outreach.md` §10.

**Custom Product Pages** (up to 70, free): one each for runners, writers,
students and founders, with screenshots leading on the circle and the ledger,
linked from the matching community post or creator placement. Since July
2025 a CPP can be assigned keywords, so the "accountability partner" page
can replace the default in those results.

**In-App Events**: one per season, submitted for review. "Week 1 of the New
Year" (1–31 January) qualifies; the recurring weekly ledger does not.

**Product Page Optimization**: not before a few hundred daily impressions;
revisit in December.

**Ratings**: only store installs can rate (TestFlight cannot), so founding
members move to the store version in week 4 before anyone else looks. Ask
once, after a perfect week, by message, offering nothing. Apple's native
prompt is capped at three per year; wire it to fire after the first perfect
week only (product ask).

## 7. Go-to-market: four phases

### Phase 0, Foundation: 1 to 6 September

- Buy `rallyweek.app` ($9.99). Deploy `docs/marketing/landing/` to Vercel
  (free). Confirm `/join?code=TEST` shows the code.
- **APNs key, then a real cheer on a real phone.** Nothing else starts until
  this is proven.
- App Store Connect: privacy and support URLs, App Privacy questionnaire
  (answers in `docs/legal/README.md` step 4), Sign in with Apple secrets and
  `link-apple` deployed, listing pasted from `store-listing.md`, five
  screenshots shot on the simulator.
- Upload the build to TestFlight external testing and submit for Beta App
  Review the same day: 2026 reports put first-build review at 2 to 7 days.
  Enable the public link, tester limit 100, *What to Test* from
  `store-listing.md`.
- Submit the featuring nomination.
- Recruit five circle captains (message in `outreach.md` §1). Post the
  tester call in r/TestFlight and on iosdev.space / Bluesky iOS-dev packs.

### Phase 1, Founding circles: 7 to 20 September

Monday 7 September is week one. Every captain stakes Monday; you cheer every
stake in every circle every day, because in week one you are the supply.
Sunday evening, captains send the ledger screenshot back (with permission,
these become the launch assets). One sentence from every perfect week. Ship
fixes daily; TestFlight builds of the same version need no review. Read
`metrics.sql` on 14 September.

### Phase 2, Store and proof: 21 September to 4 October

Submit for App Review on 21 September with the notes in `store-listing.md`
(demo account, the fictional Global feed, where report, block and deletion
live). Budget a week: early-2026 review times ran 2 to 3 days for iOS with
a 24% submission surge. Choose manual release. Release quietly on Monday 28
September; founding members reinstall from the store and leave the first
honest ratings. Start the weekly build-in-public post on 21 September with
real week-two numbers.

### Phase 3, Public and compounding: from 5 October

Launch on a Monday because that is when a Rally week starts. Every channel
in §8, in priority order, with §12's calendar. Writers from mid-October for
November. January prepared through December.

## 8. Channel strategy

Ranked by expected circles per hour, with the evidence behind each.

| # | Channel | Effort | Expected yield | Why, and the rule |
|---|---|---|---|---|
| 1 | **Your own network, five captains** | 3 h | 3–5 circles | Focusmate's first 300 users came from guerrilla community posting and word of mouth; the founding cohort is the only guaranteed circles you will ever get |
| 2 | **One physical group** (gym, run club, coworking, study group) | 3 h | 1 circle of 6–10 | Set it up on their phones while they stand there; the person who installs later never does |
| 3 | **Discord accountability servers** (Study Together, Studio, Accountability Buddies, Happy Routine) | 4 h / server | 1 circle per server that says yes | Moderator first, always. In-server promotion is banned by default; a "Rally week" that turns their existing check-in thread into a circle is a contribution, not an ad |
| 4 | **App Store: featuring nomination, CPPs, In-App Event** | 4 h | zero to thousands; unpredictable | Habitify went from months of zero to thousands of downloads a day on one feature; free; nominate three times |
| 5 | **Indie directories and newsletters** (Indie App Catalog, Indie Dev Monday) | 1 h | small, reliable | Both accept submissions and amplify on X/Mastodon; do it on launch day |
| 6 | **9to5Mac Indie App Spotlight** | 1 h | one column, moderate odds | Weekly Saturday column that explicitly solicits unknown solo devs; pitch in `outreach.md` §9 |
| 7 | **Show HN** | 2 h | discussion, Marcus-type users, low installs | Lead with the engineering story: no navigation library, reducer routing, offline outbox, RLS-tested sync, no analytics. Rules: tryable now, personal backstory comment, no booster comments |
| 8 | **Reddit maker posts** (r/SideProject, r/iosapps) | 1 h | a few installs, some testers | r/getdisciplined and r/productivity ban promotion; be a person there and answer "what do you use" honestly |
| 9 | **Build in public, weekly** (X, Threads or Bluesky, whichever you already use) | 30 min / week | compounding, slow | HabitKit's first real traction was one screenshot post; never round a number up |
| 10 | **Writers' groups, November** | 4 h | 2–3 circles | NaNoWriMo is gone; informal Novembers are forming; "Write 500 words ×4" is already a suggested stake |
| 11 | **One mid-size creator as co-owner** (StudyTok, WriterTok, couch-to-5k) | 6 h to find and pitch | low odds, high impact | Focus Friend hit #1 on Hank Green's own posts; a creator who runs *their own* public circle beats any rented post. Gifting works for 83% of creators who like the product, but a free app is a weak gift: offer a named circle, a feature, or a co-designed challenge |
| — | **Product Hunt** | 20+ h | poor without a list | Skip until 200 people can be brought on the day |
| — | **Paid ads** | — | zero information at $50 | Revisit at $5,000 (§10) |

## 9. Growth loops, lifecycle, and measurement

### 9.1 Two loops, one that grows

**Inside a circle** (fills rooms): a captain invites n friends, a fraction a
accept. Members after week one = 1 + n·a. With n = 4, a = 0.5, a circle is 3
people. This loop saturates; it decides whether rooms are alive, not how many
rooms exist.

**Across circles** (grows the app): a member starts a second circle with
different people. Multi-circle shipped in #118–#125, so this is real. Let c
be the share of members who start a circle within 8 weeks. New circles per
circle per generation: K = (1 + n·a) · c · (n·a).

| Friends who join (n·a) | c | K | Verdict |
|---|---|---|---|
| 2 | 0.10 | 0.6 | decays |
| 2 | 0.20 | 1.2 | grows slowly |
| 3 | 0.10 | 1.2 | grows slowly |
| 3 | 0.20 | 2.4 | compounds |
| 1 | 0.20 | 0.4 | dies |

Only two levers exist. Invite conversion (n·a) is the link problem; social
apps with deep links see 30–55% click-to-install versus 15–35% without. The
captain rate (c) is a product moment that does not exist yet: nothing in the
app ever suggests "start a circle for your other friends." Both are §11 asks.

**The external loop** (reaches strangers-of-friends): a perfect week produces
a card that is only postable *into* the circle (`week_shares`, #124). A
rendered image shareable to Stories or iMessage with the invite code on it
is the only zero-cost loop that leaves the circle. Every social fitness app
that grew, grew on a shareable artifact.

### 9.2 Lifecycle: the week is the retention loop

Everything is push and in-app; there is no email address to send anything to.

| Moment | Exists | Mechanism | Copy |
|---|---|---|---|
| Monday 08:00 local | yes | local notification `rally.week-opens` | "Week 37 opens today. You staked 35 pts." |
| A cheer lands | built, needs APNs key | remote push | "🔥 Maya cheered you: Run 5k" |
| Someone is waiting on you | yes | Needs-you tier and badge | in-app |
| Sunday 18:00 local | **no** | local notification | "The week closes tonight. 2 of 4 closed. Sunday's the day." |
| Thursday, nothing closed | **no** | local notification, once | "Half the week left. The circle can't cheer what it can't see." |
| Rollover | yes | in-app prompt on first Monday open | carry or archive |
| 14 days silent | **no** | nothing | "Your circle staked without you this week." |

The Sunday and Thursday reminders are local notifications, need no server
work, and are the highest-value retention items in this plan. They cost the
same as the Monday one that already exists. iOS push opt-in benchmarks run
44–56%; the onboarding notifications screen already asks at the right moment.

**The captain is the single point of failure.** A circle survives its captain
going quiet for one week, not two. Captains are the customer: they get the
direct messages, the Sunday ritual, and the first ask for help.

### 9.3 Measurement

North star: **alive circles**, circles whose members staked in three
consecutive weeks. Read weekly from `metrics.sql` (queries 2, 6, 8) and App
Store Connect.

| Step | Metric | Target | Benchmark |
|---|---|---|---|
| 1 | Product page view → install | 20% | H&F median 18.5%; productivity not published |
| 2 | Install → in a circle | 70% | the invite-link number; solo accounts are the leak (query 3) |
| 3 | In a circle → staked in week one | 60% | activation (query 4) |
| 4 | Staked → cheered someone in week one | 50% | the thesis (query 5) |
| 5 | Week N staked → week N+1 staked | 40% | social D7 ~30%; ours is weekly so the bar is higher |
| 6 | Members → started a second circle in 8 weeks | 10% | the growth lever c |
| 7 | Push opt-in | 50% | iOS 44–56% |

Leading indicators are 4 and 6. If 4 is low nothing else matters. If 6 is
zero the app cannot grow without paid acquisition it cannot afford.

## 10. Budget

| Item | Cost | When |
|---|---|---|
| Apple Developer Program | paid | done |
| `rallyweek.app`, one year | $9.99 | day 1 |
| Reserve, trigger A | up to $25 | the day an Android friend blocks a live circle and the cohort has cleared §9.3: Google Play account |
| Reserve, trigger B | up to $15 | fewer than three live circles on 12 September: a perfect-week prize for cohort one |
| **Total** | **$50.00** | |

Never on ads. What more money would change, so the next conversation is
short:

| Budget | Adds | Buys |
|---|---|---|
| $500 | Play account, one paid nano-creator video ($20–100), a $100 Apple Ads exact-match test on "accountability partner", $100 for a 20-second preview video | Android circles, first creator content, a real cost-per-tap number |
| $5,000 | Apple Ads at $30/day for 60 days on 10 exact-match terms, five micro-creators ($200–800 each), PPO screenshot tests | a measured CAC and the answer to "does paid ever work for this" |

## 11. Product asks marketing cannot work around

In priority order. None is in this branch; each is small.

1. **Link in the share message.** `Join {name} on Rally: https://rallyweek.app/join?code={code}`. One line in `DetailSheet.tsx`. Wave C's objection (no website) no longer holds.
2. **APNs key** attached to the EAS project and proven on a phone.
3. **Sunday 18:00 and Thursday local reminders**, same mechanism as the Monday one in `src/lib/reminders.ts`.
4. **A "start another circle" moment** after a member's second week, so lever c exists.
5. **A shareable perfect-week image** with the circle code, from the card that already posts to the circle.
6. **Support reachable from inside the app** (`docs/legal/README.md` notes there is no route to a person).
7. **Onboarding refuses to leave without a name**; "Someone cheered you" is the worst first impression.
8. **Native rating prompt** after the first perfect week only.

## 12. Calendar

Weeks start Monday, as Rally's do. Details per post in `content-calendar.md`.

| Week of | Marketing | Product / store |
|---|---|---|
| 1 Sep | Buy domain, deploy landing. Recruit 5 captains. Tester call in r/TestFlight and iOS-dev packs. | APNs key proven. ASC complete. TestFlight build in Beta App Review. Featuring nomination. |
| 7 Sep | Cohort week 1. Cheer everything. Sunday ledger ritual. | Daily fixes to TestFlight. Share-link change. |
| 14 Sep | Cohort week 2. Funnel read #1. Collect quotes. | Sunday/Thursday reminders. |
| 21 Sep | Build-in-public post #1. Press list warmed (follow on socials, no pitch yet). | Submit 1.0 for App Review, manual release. |
| 28 Sep | Quiet release Monday. "It's live" to every tester. First ratings. | Release. CPPs drafted. |
| 5 Oct | **Launch.** Indie App Catalog, Indie Dev Monday, r/SideProject, r/iosapps, in-person circle set up. | |
| 12 Oct | 9to5Mac pitch with one week of store data. Show HN Tuesday. Discord mod messages ×3. | |
| 19 Oct | Discord "Rally week" #1. Writers' outreach begins. Creator shortlist (10 names) built by hand. | Second-circle prompt. |
| 26 Oct | Creator pitches ×10. Discord week #2. | Shareable perfect-week image. |
| 2 Nov | Writers' November circles start. Funnel read; Android trigger decision. | |
| 9 Nov | Cult of Mac / TechCrunch pitch only if a number is worth telling. | |
| 16 Nov | Second in-person circle. | |
| 23 Nov | Quiet (Thanksgiving). Content bank for January. | |
| 30 Nov | January prep: listing refresh, In-App Event submitted, "fresh start" featuring nomination. | 1.1 with the January In-App Event. |
| Dec | Weekly build-in-public; December recap post. | PPO test if impressions allow. |
| 4 Jan 2027 | The peak. Everything above, with numbers. Quitter's Day post 8 January. | |

## 13. Risks

| Risk | Signal | Response |
|---|---|---|
| App Review rejection (UGC, anonymous accounts, Google login present) | rejection notice | Notes prepared; report, block, filter, deletion exist; demo account for the reviewer; Sign in with Apple stays alongside Google (Guideline 4.8); resubmit within 24h |
| Push never proven | no buzz on your phone by 5 Sep | Do not invite anyone; slip a week |
| Captains recruit, circles don't stake | activation < 40% | Onboarding, not marketing: watch three people onboard in person |
| Circles stake, don't cheer | cheers/member < 1 | You are the supply for two weeks; then the Thursday nudge |
| Loop 2 is zero | no second circles by week 6 | Product ask 4; marketing cannot fix it |
| A reportable post | report row | The 24-hour promise on the legal pages; act on it |
| Trademark letter | any | Not legal advice: run a clearance search now, before the brand has equity |
| The name in search | "Rally" confusion | Never fight it; brand search is not a channel; title carries the meaning |

## 14. Files

| File | What it is |
|---|---|
| `PLAN.md` | This document |
| `messaging.md` | Positioning, pillars, taglines, objection handling, copy bank |
| `store-listing.md` | Final metadata, TestFlight text, App Review notes, screenshots, CPPs, In-App Event |
| `outreach.md` | Every message: captains, testers, Discord, in-person, press, Show HN, creators, featuring nomination |
| `content-calendar.md` | Eight weeks of posts, written |
| `metrics.sql` | The funnel in nine queries |
| `landing/` | The landing page and `/join?code=` resolver |
| `research/competitors.md` | Seventeen-product teardown with sources |
| `research/voice-of-customer.md` | Thirty-one quotes, four personas, objections, communities, seasons |
| `research/earned-media.md` | Apple's channels, press list, creators, comparable launches, App Review |
| `research/market-and-aso.md` | Market size, seasonality, keyword strategy, Apple rules, benchmarks, the name |
