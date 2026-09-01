# Marketing Rally on $50

> Written 1 September 2026, against the code as it stands on `main` (#125). Every
> price below was checked on that date; every product claim was read from the
> repo, not assumed. Where the plan depends on something only you can confirm,
> it says so.

## The honest assessment first

You asked for a marketing plan. The objective read is that Rally is not yet in a
position where marketing is the constraint, and a $50 plan that pretends
otherwise would waste the $50. Five things a skeptical board member would put
on the table before approving any spend:

1. **$50 does not buy an iOS launch.** The Apple Developer Program is $99/year.
   `eas.json` has an empty `submit` block and `TESTING.md` says the Apple
   account is "the missing piece, which only you can supply", so this plan
   assumes you are not enrolled. Without it there is no TestFlight, no App
   Store, and no push on iPhones. A free Apple ID sideloads to your own phone
   for seven days. That is not distribution. If you *are* enrolled, skip to
   *If you already pay Apple* below, because it changes the plan for the better.
2. **The unit of acquisition is a circle, not a user.** Rally's own thesis
   (`HANDOFF.md`: "the social layer is the accountability mechanism") means a
   single install lands on "A circle of one" and has nothing to do. Every
   channel that delivers individuals (Reddit ads, Product Hunt, Search Ads)
   delivers churn. Bottom-up here means recruiting groups that already exist:
   a run club, a writing group, a founder Discord, four friends in a group chat.
3. **The invite loop has no link in it.** The share message is
   `Join {circle} on Rally with the code {code}` (`DetailSheet.tsx:784`).
   The recipient gets a code and nowhere to tap. Wave C rejected deep links
   because "rally.app/join implies a website that does not exist". This plan
   makes the website exist for $0, which is the single highest-leverage thing
   in it. The one-line app change that uses it is in *Product asks* below.
4. **You cannot measure anything.** The privacy policy promises no analytics,
   and that is a real asset with users. It also means the marketing funnel has
   to be read out of Postgres. `metrics.sql` in this folder is that dashboard.
   Without it you will be guessing whether any of this worked.
5. **Android-only cripples the circle thesis in the US.** Roughly six in ten
   US phones are iPhones. A circle that cannot include the iPhone friends is a
   circle missing its members. The plan below is the best $50 plan available.
   The best plan is $49 more than you gave me, and I would be failing you not
   to say it once, plainly, here.

Two smaller ones: the Global feed is the Oz bots, who are openly fictional
(`docs/backend.md`, *Humans on the global feed*). Nothing in this plan
promises a global community, and nothing you post should either. And "Rally"
is an unwinnable search term (Rally Health, rally racing games), so store
search will bring near zero installs; word of mouth has to carry the name,
which is fine for a bottom-up plan but rules out any ASO fantasy.

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
| Google Play developer account | $25.00 | The only store $50 reaches. One-time. Personal accounts must run a closed test with 12 testers opted in for 14 continuous days before production access; that requirement *is* the launch campaign below. | Day 1 |
| `rallyweek.app` domain, 1 year | $9.99 | The invite link. `rally.app`, `getrally.app`, `joinrally.app` are taken; `weekspine.app` is also $9.99 if you prefer the codename. Hosted on the same free Vercel setup as the legal pages. | Day 1 |
| Reserve | $15.01 | Held. Do not spend on ads: Reddit's $5/day floor buys three clicks and no signal, and Apple Ads is out of reach without the program. Release trigger: if the closed test is short of 12 opted-in testers on day 5, spend it as a perfect-week prize for the first cohort. | Day 5 or never |
| **Total** | **$50.00** | | |

What is deliberately $0: the landing page (Vercel free tier, already used for
`rally-app-legal`), the Play listing assets, every message template, Discord
and Reddit presence, the build-in-public thread, and the metrics dashboard.
Your time is the real budget. This plan costs roughly 25 hours over six weeks.

## The plan, bottom up

### Week 0 — 1 to 6 September: make the store possible

- Pay Google the $25. Identity verification takes up to two business days.
- Buy `rallyweek.app`. Point it at a new Vercel project deployed from
  `docs/marketing/landing/` (no build step; same shape as `docs/legal`).
  Check `https://rallyweek.app/join?code=TEST` shows the code.
- Build the release bundle (`eas build -p android --profile production`, or a
  local `bundleRelease`). Create the Play app, upload to a **closed testing**
  track, paste the store listing from `store-listing.md`, and take the five
  screenshots listed there on the simulator (`npm run sim`).
- Recruit **five circle captains** from your own contacts using the captain
  message in `outreach.md`. A captain is someone who will bring three to five
  people they already talk to. You need at least 12 opted-in testers; aim for
  20 so that drop-off does not break the 14-day clock.
- Post the tester call in `r/AndroidClosedTesting` and `r/TestMyApp`, which
  exist for exactly this rule and allow it. Expect strangers; they count toward
  the 12 but not toward the product. Put them in one circle together with you
  as captain so they are not solo.

### Weeks 1 and 2 — 7 to 20 September: the founding circles

Monday 7 September is the first week that counts, because Rally's week starts
Monday. Every captain stakes on Monday, and you cheer every stake in every
circle yourself, every day. Cheers are the product's whole thesis; in week one
you are the supply.

- Run the "Sunday ledger" ritual: Sunday evening, each captain posts their
  circle's ledger screenshot back to you. Those screenshots are your first
  marketing assets, with permission.
- Collect one sentence from anyone who closes a perfect week. Those are the
  review quotes for the listing and the landing page.
- Ship fixes fast; testers on a 14-day clock forgive bugs and remember
  responsiveness.
- Read `metrics.sql` on Monday 14 September. The numbers that matter: how many
  testers staked at least once, how many circles have three or more members,
  cheers per member, and how many accounts stake again in week two.

### Week 3 — 21 to 27 September: apply for production

The 14 days complete on 21 September. Apply for production access the same
day (Google's review can take up to a week). Meanwhile:

- Start the build-in-public thread (template in `outreach.md`) with the real
  week-two numbers, whatever they are. Honest small numbers are the story;
  nobody believes big ones from a new app.
- Ask the founding circles to keep going. A circle that survives three
  rollovers is your first retention proof.

### Week 4 — 28 September to 4 October: listing goes live

- Promote to production. Do not announce yet; let the listing settle and get
  the first organic ratings from founding members, asked the compliant way
  (the template asks for an honest rating, offers nothing for it).
- Send the "it's live" message to every tester with the Play link and their
  circle's code.

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
3. **`r/SideProject` and `r/androidapps`** with the launch post. These allow
   maker posts. `r/getdisciplined` and `r/GetMotivatedBuddies` do not allow
   promotion; participate there as a person, and only mention Rally if someone
   asks what you use.
4. **Build-in-public** on X, Threads, or Bluesky, whichever you already use.
   Weekly, on Mondays, with the ledger.

Skip Product Hunt. The research is unambiguous: it rewards makers who already
have a list, and it delivers individuals, not circles. Revisit when iOS exists
and you have 200 people to bring.

### November — writers

NaNoWriMo shut down in 2025 and nothing has fully replaced it. Writers are
forming informal Discord and group-chat Novembers, and "Write 500 words ×4
this week" is already one of Rally's suggested stakes. From mid-October, pitch
writing groups with the writers' template. It is the one seasonal moment
where a weekly-stakes-with-friends app is exactly the shape of the need.

### January

The category peaks in January. Being listed with eight weeks of real circles,
a handful of honest ratings, and a working invite link by then is worth more
than anything you could buy now. Plan to have the Apple program by December if
the Android numbers earn it; see below.

## What "worked" means

Read from `metrics.sql` every Monday. Targets for the founding cohort:

| Metric | Target | Why this number |
|---|---|---|
| Opted-in testers, 14 days continuous | 12 minimum, 20 planned | Google's gate |
| Circles with 3+ members | 3 | Below three, one absence kills the room |
| Accounts that stake in their first week | 60% | Onboarding stakes for you; below this, onboarding is broken, not marketing |
| Cheers per member per week | 2 | The thesis. If nobody cheers, nothing else matters |
| Stake again in week 2 | 40% | The first honest retention number |
| Circles that survive 3 rollovers | 2 of 3 | The proof that earns the $99 |

If the cohort clears these, the next dollar goes to Apple, not to ads. If it
does not, no marketing spend would have helped, and the money was saved.

## Product asks

Marketing found these; they are product work and are not in this branch.

1. **Put the link in the share message.** With the landing page live, the
   share string should read
   `Join {name} on Rally: https://rallyweek.app/join?code={code}`. One line in
   `DetailSheet.tsx`. Wave C's objection (no website) no longer holds.
2. **A link in the app to the support page.** `docs/legal/README.md` notes the
   app has no contact route at all. Testers will hit bugs and have nowhere to
   say so except the store review.
3. **Onboarding should not let a live account leave without a name.** Wave C
   flagged it. "Someone" cheering you is a worse first impression than any ad.
4. **Firebase Cloud Messaging credentials** for Android push, so a cheer lands
   on a lock screen for the founding cohort. Free.

## If you already pay Apple

Then the plan improves and the budget shifts. TestFlight's public link takes up
to 10,000 external testers at $0, builds last 90 days, and iPhone friends can
join circles. Do both stores in parallel, lead the tester call with the
TestFlight link, keep the Play closed test on the same 12-tester clock, and
move the $15 reserve to a second year of the domain. Everything else stands.

## Files

| File | What it is |
|---|---|
| `store-listing.md` | Google Play and App Store copy, keywords, screenshot plan |
| `outreach.md` | Every message in the plan, ready to send |
| `metrics.sql` | The funnel, readable in the Supabase SQL editor |
| `landing/` | The landing page and invite-code resolver, deployable as-is |

## Sources checked on 1 September 2026

- Apple Developer Program fee, $99/year: https://magora-systems.com/apple-developer-fee/
- Google Play $25 one-time and the 12-tester, 14-day rule for personal accounts: https://support.google.com/googleplay/android-developer/answer/14151465 and https://www.iconikai.com/blog/google-play-developer-account-fee-2026
- TestFlight limits (10,000 external, 90-day builds): https://developer.apple.com/testflight/
- Reddit Ads floor ($5/day, ~3 clicks): https://www.stackmatix.com/blog/reddit-ads-minimum-budget-requirements-2026
- Apple Ads costs and delivery throttling below ~$30/day: https://www.businessofapps.com/marketplace/apple-search-ads/research/apple-search-ads-costs/
- Product Hunt in 2026: https://www.puthusu.com/blog/is-product-hunt-worth-it
- Competitor landscape (stickK, Beeminder, Focusmate, HabitShare, Finch): https://www.accountablo.com/blog/best-accountability-apps
- Accountability subreddits and their promotion rules: https://dev.to/sh20raj/reddit-self-promotion-framework-how-to-post-smart-and-stay-unbanned-1kfg
- Accountability Discord servers: https://thehiveindex.com/topics/accountability/platform/discord/ and https://disboard.org/servers/tag/accountability
- NaNoWriMo's shutdown and the November gap: https://prowritingaid.com/nanowrimo-alternatives
- Domain prices, checked through Vercel's registrar on the day
