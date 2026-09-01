# Marketing Rally on $50

> Written 1 September 2026, against the code as it stands on `main` (#125),
> for an **iOS-only launch on an Apple Developer account that is already
> paid for**. Every price below was checked on that date; every product claim
> was read from the repo, not assumed.

## The honest assessment first

You asked for a marketing plan. The objective read is that Rally's constraint
is not yet marketing, and a $50 plan that pretends otherwise wastes the $50.
Five things a skeptical board member would put on the table before approving
any spend:

1. **$50 buys a link, not attention.** Apple Ads Advanced has a $1/day
   minimum, but delivery throttles below roughly $30/day and the US median
   cost per tap is near $2. Fifty dollars is twenty-five taps. Reddit Ads'
   $5/day floor buys three clicks. No paid channel exists at this budget, so
   the plan spends almost nothing and treats your hours as the real budget.
2. **The unit of acquisition is a circle, not a user.** Rally's own thesis
   (`HANDOFF.md`: "the social layer is the accountability mechanism") means a
   single install lands on "A circle of one" and has nothing to do. Every
   channel that delivers individuals (ads, Product Hunt, App Store search)
   delivers churn. Bottom-up here means recruiting groups that already exist:
   a run club, a writing group, a founder Discord, four friends in a group chat.
3. **The invite loop has no link in it.** The share message is
   `Join {circle} on Rally with the code {code}` (`DetailSheet.tsx:784`).
   The recipient gets a code and nowhere to tap. Wave C rejected deep links
   because "rally.app/join implies a website that does not exist". This plan
   makes the website exist for $9.99, which is the single highest-leverage
   thing in it. The one-line app change that uses it is in *Product asks*.
4. **The thesis is untested on a real phone.** `TESTING.md`: "a simulator can
   never receive a remote push", and the APNs key is the one missing piece.
   A cheer landing on a lock screen is the product. If the founding cohort
   runs without push, you are testing a to-do list with a feed, and the
   numbers will say so. The APNs key is set up before a single tester is
   invited, or the cohort is wasted.
5. **You cannot measure anything.** The privacy policy promises no analytics,
   and that is a real asset with users. It also means the marketing funnel has
   to be read out of Postgres. `metrics.sql` in this folder is that dashboard.
   Without it you will be guessing whether any of this worked.

Three smaller ones. The Global feed is the Oz bots, who are openly fictional
(`docs/backend.md`, *Humans on the global feed*); nothing you post should
promise a global community, and App Review should be told about them up front
(the note is in `store-listing.md`). "Rally" is an unwinnable search term
(Rally Health, rally racing games), so App Store search brings near zero and
word of mouth has to carry the name, which suits a bottom-up plan and rules
out any ASO fantasy. And iOS-only excludes the Android friend in roughly four
US circles out of ten; it is the smaller half of the problem, and the $25
Play account is the eventual fix, so the reserve below is sized to cover it.

## Positioning

**One line:** *Stake a few goals on the week. Your friends see them, cheer, and
keep you honest.*

**Who it is for:** small groups of friends who already talk about their goals
and want the talk to count. Not solo habit-trackers, not people who want to
lose money (stickK, Beeminder, Forfeit own that), not strangers matching for
body-doubling (Focusmate owns that).

**Against the category:** every listed competitor is either *money stakes* or
*streaks*. Rally is *friends, not strangers* and *a week, not a streak*. A
week closes on Sunday and asks what carries. A missed day does not reset
anything. That is the differentiator to lead with, and it is true of the code.

**Voice:** the handoff's rules apply to marketing copy too. Plain, warm,
second person, slightly blunt. Stakes language, never productivity language.
Never guilt-trip. Never a bare zero.

## Budget

| Item | Cost | Why | When |
|---|---:|---|---|
| Apple Developer Program | paid | Already yours. TestFlight's public link takes up to 10,000 external testers at no cost, builds last 90 days, and the App Store follows. | done |
| `rallyweek.app` domain, 1 year | $9.99 | The invite link. `rally.app`, `getrally.app`, `joinrally.app` are taken; `weekspine.app` is also $9.99 if you prefer the codename. Hosted on the same free Vercel setup as the legal pages. | Day 1 |
| Reserve | $40.01 | Held, with two named triggers. **A.** The founding cohort clears the targets below: spend $25 on a Google Play account the day an Android friend blocks a circle, and hold the rest. **B.** The cohort is short of three live circles on day 5: spend up to $15 as a perfect-week prize for cohort one. Never on ads; see objection 1. | Trigger or never |
| **Total** | **$50.00** | | |

What is deliberately $0: the landing page (Vercel free tier, already used for
`rally-app-legal`), the App Store assets, every message template, Discord
and Reddit presence, the build-in-public thread, and the metrics dashboard.
This plan costs roughly 25 hours of your time over six weeks.

## The plan, bottom up

### Week 0 — 1 to 6 September: make the store possible

- Buy `rallyweek.app`. Point it at a new Vercel project deployed from
  `docs/marketing/landing/` (no build step; same shape as `docs/legal`).
  Check `https://rallyweek.app/join?code=TEST` shows the code.
- **Set up push.** Generate the APNs key in the developer portal, attach it
  to the EAS project, and prove a cheer buzzes a real phone before anyone else
  is invited. This is objection 4 and it is the first task, not the last.
- Finish App Store Connect: privacy and support URLs, the App Privacy
  questionnaire (answers in `docs/legal/README.md`, step 4), the four
  `APPLE_*` secrets and `link-apple` (step 6). Paste the listing from
  `store-listing.md` and take the five screenshots on the simulator.
- Upload the build (`eas build -p ios --profile production`), add it to an
  external TestFlight group, submit for Beta App Review (usually a day),
  enable the **public link** with a tester limit of 100, and write the
  *What to Test* text from `store-listing.md`.
- Recruit **five circle captains** from your own contacts using the captain
  message in `outreach.md`. A captain brings three to five people they
  already talk to. Aim for 20 testers across at least three circles.
- Post the tester call in `r/TestFlight`, which exists for public links and
  allows it. Expect strangers; put everyone from that thread into one circle
  with you as captain so nobody is solo.

### Weeks 1 and 2 — 7 to 20 September: the founding circles

Monday 7 September is the first week that counts, because Rally's week starts
Monday. Every captain stakes on Monday, and you cheer every stake in every
circle yourself, every day. Cheers are the product's whole thesis; in week one
you are the supply.

- Run the "Sunday ledger" ritual: Sunday evening, each captain posts their
  circle's ledger screenshot back to you. Those screenshots are your first
  marketing assets, with permission.
- Collect one sentence from anyone who closes a perfect week. Those are the
  quotes for the landing page and the promotional text.
- Ship fixes fast. TestFlight testers forgive bugs and remember
  responsiveness; a new build reaches them without a review.
- Read `metrics.sql` on Monday 14 September. The numbers that matter: how many
  testers staked at least once, how many circles have three or more members,
  cheers per member, and how many accounts stake again in week two.

### Week 3 — 21 to 27 September: submit for review

Two rollovers have happened. Submit the build for App Store review with the
review notes from `store-listing.md` (the demo account, the fictional Global
feed, where report and block and account deletion live). First reviews take
one to three days; choose **manual release** so the date is yours.

- Start the build-in-public thread (template in `outreach.md`) with the real
  week-two numbers, whatever they are. Honest small numbers are the story;
  nobody believes big ones from a new app.
- Ask the founding circles to keep going. A circle that survives three
  rollovers is your first retention proof.

### Week 4 — 28 September to 4 October: release quietly

- Release on Monday 28 September without announcing. TestFlight users cannot
  leave ratings; the store version can, so the founding members move over
  now and the first honest ratings land before anyone else looks. Ask the
  compliant way (the template asks for an honest rating and offers nothing).
- Send the "it's live" message to every tester with the App Store link and
  their circle's code.

### Week 5 — Monday 5 October: public launch

Launch on a Monday because that is when a Rally week starts, and every post
can end with "stake your first week today". Channels, in order of expected
yield:

1. **Circles you can walk into.** One gym, run club, coworking space, or
   study group where you can pitch in person and set up the circle on the
   spot. One physical circle of eight beats a hundred strangers.
2. **Discord accountability servers** (Focus Lab, Studio, and the servers
   tagged *accountability* on Disboard). Message a moderator first with the
   mod template; offer to run a "Rally week" where the server's existing weekly
   check-in thread becomes a circle. Never post the link without permission.
3. **`r/SideProject` and `r/iosapps`** with the launch post. Both allow maker
   posts. `r/getdisciplined` and `r/GetMotivatedBuddies` do not allow
   promotion; participate there as a person, and only mention Rally if
   someone asks what you use.
4. **Build-in-public** on X, Threads, or Bluesky, whichever you already use.
   Weekly, on Mondays, with the ledger.

Skip Product Hunt. The research is unambiguous: it rewards makers who already
have a list, and it delivers individuals, not circles. Revisit when you have
200 people to bring on the day.

### November — writers

NaNoWriMo shut down in 2025 and nothing has fully replaced it. Writers are
forming informal Discord and group-chat Novembers, and "Write 500 words ×4
this week" is already one of Rally's suggested stakes. From mid-October, pitch
writing groups with the writers' template. It is the one seasonal moment
where a weekly-stakes-with-friends app is exactly the shape of the need.

### January

The category peaks in January. Being listed with eight weeks of real circles,
a handful of honest ratings, and a working invite link by then is worth more
than anything you could buy now.

## What "worked" means

Read from `metrics.sql` every Monday. Targets for the founding cohort:

| Metric | Target | Why this number |
|---|---|---|
| Testers who install and stake in week 1 | 12 | Enough for three real circles |
| Circles with 3+ members | 3 | Below three, one absence kills the room |
| Accounts that stake in their first week | 60% | Onboarding stakes for you; below this, onboarding is broken, not marketing |
| Cheers per member per week | 2 | The thesis. If nobody cheers, nothing else matters |
| Stake again in week 2 | 40% | The first honest retention number |
| Circles that survive 3 rollovers | 2 of 3 | The proof that earns wider outreach |

If the cohort clears these, the next dollar goes to Android, not to ads. If it
does not, no marketing spend would have helped, and the money was saved.

## Product asks

Marketing found these; they are product work and are not in this branch.

1. **Put the link in the share message.** With the landing page live, the
   share string should read
   `Join {name} on Rally: https://rallyweek.app/join?code={code}`. One line in
   `DetailSheet.tsx`. Wave C's objection (no website) no longer holds.
2. **The APNs key**, so the thesis is real for the cohort. See objection 4.
3. **A link in the app to the support page.** `docs/legal/README.md` notes the
   app has no contact route at all. Testers will hit bugs and have nowhere to
   say so except the store review.
4. **Onboarding should not let a live account leave without a name.** Wave C
   flagged it. "Someone" cheering you is a worse first impression than any ad.

## Files

| File | What it is |
|---|---|
| `store-listing.md` | App Store copy, keywords, TestFlight *What to Test*, App Review notes, screenshot plan |
| `outreach.md` | Every message in the plan, ready to send |
| `metrics.sql` | The funnel, readable in the Supabase SQL editor |
| `landing/` | The landing page and invite-code resolver, deployable as-is |

## Sources checked on 1 September 2026

- TestFlight limits (10,000 external testers, 90-day builds, public links): https://developer.apple.com/testflight/
- Apple Ads costs, $1/day minimum and throttling below ~$30/day: https://www.businessofapps.com/marketplace/apple-search-ads/research/apple-search-ads-costs/ and https://adapty.io/blog/apple-search-ads/
- Reddit Ads floor ($5/day, ~3 clicks): https://www.stackmatix.com/blog/reddit-ads-minimum-budget-requirements-2026
- Google Play $25 one-time and the 12-tester rule, for the Android trigger: https://support.google.com/googleplay/android-developer/answer/14151465
- Product Hunt in 2026: https://www.puthusu.com/blog/is-product-hunt-worth-it
- Competitor landscape (stickK, Beeminder, Focusmate, HabitShare, Finch): https://www.accountablo.com/blog/best-accountability-apps
- Accountability subreddits and their promotion rules: https://dev.to/sh20raj/reddit-self-promotion-framework-how-to-post-smart-and-stay-unbanned-1kfg
- Accountability Discord servers: https://thehiveindex.com/topics/accountability/platform/discord/ and https://disboard.org/servers/tag/accountability
- NaNoWriMo's shutdown and the November gap: https://prowritingaid.com/nanowrimo-alternatives
- Domain prices, checked through Vercel's registrar on the day
