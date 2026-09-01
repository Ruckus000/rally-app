# Research: earned media, Apple's free channels, creators, App Review

> Compiled 1 September 2026 for the Rally launch plan. About 200 web searches
> plus fetches of Apple's developer pages. Most third-party sites (9to5Mac,
> MacStories, TechCrunch, Substack, Medium, HN) were blocked at the fetch layer,
> so details for those come from search snippets; where a fact could not be
> verified it says "not found". Snippets from SEO-style blogs are flagged as
> lower-confidence.

## 1. Apple's free promotion channels

**Featuring Nominations (the "promote your app" form).** Lives in App Store
Connect under *Featuring Nominations* (introduced 12 November 2024). Official
help page:
https://developer.apple.com/help/app-store-connect/manage-featuring-nominations/nominate-your-app-for-featuring/.
The form asks for: nomination name; type (App Launch / App Enhancements / New
Content); a description stating purpose, priority and objectives; publish date
or date range; related apps (up to 10); platforms; countries/regions;
localizations (auto); attached In-App Events (must already be approved); up to
5 supplemental URLs (docs, assets, **TestFlight links**); and a "helpful
details" field for accessibility/inclusivity/what's unique. Requires Account
Holder/Admin/App Manager/Marketing role. You can edit after submission except
type and related apps. Lead time: the help page says minimum 3 weeks; the
marketing page (https://developer.apple.com/app-store/getting-featured/) says
"minimum 2 weeks, 3 months in advance for wider consideration". For an October
launch, submit now. Editors score seven criteria: UX, UI design, innovation,
uniqueness, accessibility, localization, product-page quality. Apple states
explicitly there is no checklist and "new apps and decade-old apps are equally
eligible for App of the Day".

**Realistic for an unknown 1.0:** Apple never publishes acceptance rates. The
practical signal from indie post-mortems is that featuring is rare at launch
and more common for a polished update or a seasonal hook. Habitify sold
nothing for months until an Apple feature turned "millions of impressions into
thousands of downloads per day"
(https://habitify.me/blog/from-0-in-6-months-to-1m-downloads-and-21-000-month-the-story-of-habitify-the-habit-tracker-app).
Codakuma's Personal Best was featured for the iOS 26 launch and used in
Apple's internal developer-workshop slides (https://codakuma.com/2025-in-review/).
A third-party estimate (unverified) puts App of the Day for a niche
productivity app at 5k–20k downloads in 24 hours and notes a week-long
category placement compounds better
(https://appdrift.co/blog/how-to-get-featured-app-store-google-play). Nominate
for (a) the October launch, (b) a "New Year / fresh start" January update, and
(c) accessibility work. The "helpful details" field is where a no-ads,
no-analytics, no-streaks positioning fits Apple's privacy narrative.

**Custom Product Pages (CPPs):** limit doubled from 35 to 70 on 29 October
2025 (https://www.mobileaction.co/blog/apple-doubles-the-custom-product-page-limit/).
Useful as deep-link targets: one CPP for "runners," one for "writers," one for
"students," each linked from the matching creator/press placement.

**Product Page Optimization (A/B):** up to 3 treatments vs. the default page,
testing icon, screenshots and previews; app must be Ready for Distribution;
iOS 15+; not available on CPPs
(https://developer.apple.com/help/app-store-connect/create-product-page-optimization-tests/overview-of-product-page-optimization).
Third-party sources say 90-day max. Realistic only after a few hundred daily
impressions; otherwise no statistical result.

**In-App Events:** appear on product page, in search results as separate
cards, and in editorial modules; iOS 15+; must be submitted for review
(https://developer.apple.com/help/app-store-connect/offer-in-app-events/overview-of-in-app-events).
Third-party guides: up to 10 published/15 approved, publish at most 14 days
before start, 31-day max, review usually within 24h; "repetitive daily
activities" are poor candidates
(https://www.applaunchflow.com/blog/app-store-in-app-events-guide-2026,
https://appradar.com/blog/apple-in-app-events-iae). A "New Year Week 1 stake"
or "Back-to-school circle challenge" event is a plausible fit; a recurring
weekly ledger is not.

**Marketing tools:** badge/QR/short-link generator at
https://toolbox.marketingtools.apple.com/en-us/app-store/us; badge rules at
https://developer.apple.com/app-store/marketing/guidelines/ (black badge
preferred, 50 localizations, never modify; Apple-provided bezels only). Since
November 2024 App Store Connect also generates Apple-designed shareable assets
for launches and featuring placements and notifies you in the ASC app when
you're featured on Today (https://developer.apple.com/news/?id=nx3eotat).

**Context:** App Store submissions rose 24% in 2025 to ~557,000 (Appfigures
via https://mjtsai.com/blog/2026/03/02/mac-app-store-review-times-increasing/),
so editorial and press are more crowded than any year since 2016.

## 2. Press and newsletters that cover small indie iOS apps

| Outlet | What / how | Pitch | Odds for a 1.0 |
|---|---|---|---|
| **9to5Mac Indie App Spotlight** | Weekly Saturday column, Michael Burkhardt; 2025 examples: Dimewise, Remind Me Faster, Cannot Ignore, Dumb Weather, Grano, Headlines, all small solo apps | Email michaelb@9to5mac.com with app name, App Store link, what's new (https://9to5mac.com/guides/indie-app-spotlight/) | Best in class. Explicitly solicits unknown devs. Moderate-to-good. |
| **MacStories** | Reviews, "MacStories Selects" year-end awards; Federico Viticci/John Voorhees | Emails on https://www.macstories.net/about/. Voorhees' pitching Q&A: name the app in the pitch (people forget), email is safest, follow-ups are welcome, don't expect feedback, keep TestFlight open post-launch (https://www.macstories.net/linked/app-marketing-my-extended-qa-for-paul-hudsons-everything-but-the-code/) | Low. "Hundreds of pitches weekly"; they like novelty and newcomers but skew Mac/power-user. |
| **Cult of Mac "Awesome Apps"** | Weekly roundup (https://www.cultofmac.com/awesome-apps) | tips@cultofmac.com (https://www.cultofmac.com/about) | Low-moderate. |
| **MacRumors** | Rarely covers indie iPhone apps; did "10 Mac Apps Worth Trying in 2026" | tips@macrumors.com / https://www.macrumors.com/share.php | Low. |
| **AppAdvice** | Two sources say AppAdvice's "Apps Gone Free" campaigns shut down early 2026 after Apple enforcement (https://revenueflo.com/blog/best-appadvice-alternatives-for-iOS-app-deals) | Skip; irrelevant to a free app anyway. | — |
| **iMore** | Recent indie-app coverage not found beyond 2017–18 pieces. | Not found | Skip. |
| **TechCrunch** | Has an "indie apps" tag (https://techcrunch.com/tag/indie-apps/); Sarah Perez (sarahp@techcrunch.com) and Ivan Mehta (im@ivanmehta.com) cover consumer apps | Short email: what, why now, who's using it | Low (1–3%). Better after a traction number or a trend hook ("no-streak apps"). |
| **The Verge** | tips@theverge.com; no bylined pitches; warm leads via journalists' socials (https://muckrack.com/media-outlet/theverge) | — | Very low for a 1.0. |
| **Lifehacker** | Productivity how-tos; pitches to mwalbert@lifehacker.com per one source (unverified) | Angle: "accountability without streaks/money" explainer | Low. |
| **Indie App Catalog** | ~2,150 apps / 1,526 devs; run by Miká Kruschel since Nov 2024; posts to X and iosdev.space | Submit at https://indiecatalog.app/submit-app; must be on the US App Store; "very basic" apps rejected (https://indieappcatalog.com/about) | High (it's a directory). Do it on launch day. |
| **Indie Dev Monday** | Weekly newsletter spotlighting indie devs; welcomes new releases and build-in-public threads | Form at https://indiedevmonday.com/look-at-me | High. |
| **Indie App Santa** | Free feature only if you offer a paid→free promo; otherwise $140 (https://x.com/indieappsanta/status/1801562011903332635) | DM on X | Not a fit for an always-free app. |
| **AppRaven** | One developer says it was acquired and is "filled with AI slop" (https://developer.apple.com/forums/thread/803716 context). | Skip. | — |
| **Indie App Sales** | Matt Corey's quarterly event, 200–250 apps; requires a discount or free-for-a-day (https://indieappsales.com/) | Not applicable to a free app. | — |
| **Product Hunt** | Self-hunting fine since 2025; drives desktop web clicks more than installs; "amplifies an audience rather than creating one" (https://getlaunchlist.com/blog/how-to-launch-on-product-hunt-2026, https://screenfast.app/blog/how-to-launch-ios-app-product-hunt) | Tue/Wed 12:01 PT; need a pre-built list | Low ROI without a list. |
| **Show HN** | Rules: must be tryable now, no landing pages/waitlists, lower the barrier to try, title "Show HN: Name – plain description", post a personal backstory comment, no marketing language, no booster comments from friends (https://gist.github.com/tzmartin/88abb7ef63e41e27c2ec9a5ce5d9b5f9) | An App Store link qualifies; a link-only iOS post with no web demo does worse. Lean on the technical angle (no-nav reducer routing, offline sync, RLS) | Moderate for the dev-story angle, low for downloads. |
| **Mastodon iosdev.space / indieapps.space; Bluesky** | iosdev.space is the main Swift-dev instance; indieapps.space hosts app accounts; 6+ iOS-dev and 20–31 indie-dev Bluesky starter packs (https://iosdev.space/about, https://blueskystarterpack.com/ios-dev) | Post build-in-public; ask for TestFlight testers; these communities boost launch posts freely | Good for testers/feedback; small for end users. |
| **MacStories Selects / App Store Awards** | Year-end; Drafts won 2025 MacStories App of the Year (https://www.macstories.net/stories/macstories-selects-2025-recognizing-the-best-apps-of-the-year/) | Not pitchable; becomes possible only after coverage. | — |

**What a good pitch looks like** (synthesised from the MacStories Q&A and the
9to5Mac series): subject line "[App name] — one-line what it does"; 3–5
sentences; the one thing that's different (private circle + weekly stake, no
streaks, no money, no ads/analytics); App Store link + TestFlight link; 3
screenshots or a 20-second video; a press-kit URL; the launch date; a real
human sign-off. Follow up once a week later.

## 3. Creators

**Rates (2026):** Nano (1–10k) TikTok video $20–$100 per Influencer Marketing
Hub, $25–$200 per others; micro (10–100k) $200–$800 (IMH) up to $1,500
(https://influencermarketinghub.com/influencer-rates/tiktok-influencer-rates/,
https://influencermarketinghub.com/influencer-rates/micro-influencer-rates/,
https://influee.co/blog/tiktok-influencer-rates). Usage rights and Spark Ads
double or triple that. $50 buys, at most, one nano video, so gifting is the
only model.

**Does gifting work?** Social Cat's 2026 report says 83% of creators will
work for gifting alone if they genuinely like the product; gifted
partnerships average 2.19% engagement vs 1.94% for paid
(https://thesocialcat.com/blog/influencer-marketing-report). Personalized
outreach emails see 25–40% replies vs 5–10% for templates
(https://www.janney.ai/blog/influencer-benchmark-2025/). Caveat: a free app is
a weak "gift"; what you can offer is early/founder access, a named circle in
the app, a feature built for them, or a co-created challenge.

**Finding them for free:** hashtag search on the platform (#studytok,
#studywithme, #writertok, #authortok, #couchto5k, #accountabilitypartner,
#75hard), then vet engagement by hand: roughly 10 hours per 50 creators
(https://megadonkey.com.au/blog/free-tools-to-find-micro-influencers,
https://www.modash.io/blog/how-to-find-micro-influencers). TikTok Creator
Marketplace requires creators ≥10k followers and 100k likes/28 days; brands
need only a TikTok Ads Manager login
(https://stackinfluence.com/blog/tiktok-marketplace-requirements). Instagram
Creator Marketplace: ≥1k followers
(https://fluxnote.io/guides/instagram-creator-marketplace-eligibility).

**Specific creators:** StudyTok handles that surfaced: @alemenezo (med-school
"study with me"), @salosalosa (memorization tips), @aiihnhoa.cg, @luciamrts,
@caarly_hall (https://www.tiktok.com/discover/tiktok-study-accounts-to-follow).
Follower counts and verified URLs: **not found**; the search layer cannot
read TikTok profiles. Running: Matt Choi is cited but is macro, not micro
(https://theribbonbox.com/wellbeing/running-influencers/). A vetted 5k–100k
list in these niches has to be built by hand in-app.

**Formats that fit a weekly social stake:** 2026 trend reports emphasise
"Reali-TEA": honest routine/accountability content over polish
(https://md-eksperiment.org/en/post/20260116-mastering-viral-tiktok-trends-in-2026-full-breakdown-participation-hacks-and-creation-strategies).
Stitches that add value perform ~40% better than agreement stitches
(https://www.influencers-time.com/tiktok-stitch-and-duet-challenges-a-brand-playbook/).
Practical shapes: "Monday stake / Sunday ledger" two-part video; a creator
stakes a goal and invites followers to stitch their own; "75 Hard for
writers" style challenges already exist on WriterTok
(https://www.tiktok.com/discover/75-hard-for-filming-and-writing). Remix
challenges build in waves over 3–4 weeks; a 24-hour push doesn't work.

**Documented cases of creator-led growth for focus/accountability apps:**
Focus Friend (Hank Green) launched quietly in July 2025, then hit #1 on the
US App Store in August 2025 solely via the Greens' own TikTok/X/Bluesky posts,
no paid media, and became Google Play App of the Year
(https://www.tubefilter.com/2025/08/20/hank-green-tops-app-store-charts-focus-friend/,
https://techcrunch.com/2025/11/18/hank-greens-focus-friend-is-google-plays-app-of-the-year).
Lesson: a *creator* owning the distribution beats a brand renting it; the
equivalent for Rally is finding one mid-size creator who wants their own
"circle". Opal built a persona account, "Olivia Unplugged", whose bio reads
"Powered by Opal" and whose stories weave the app in
(https://www.milkkarten.net/p/creator-brand-olivia-unplugged-opal). Finch's
engine is paid Meta/TikTok plus an ambassador program
(https://blog.sparrowapps.io/p/finch-how-a-self-care-app-hit-30m-arr-without-vc-money).
Small-habit-app TikTok case study with hard numbers: **not found**.

## 4. Comparable near-zero-budget launches

- **HabitKit (Sebastian Röhl):** fewer than a dozen downloads in the first 6
  months; a Twitter screenshot got 800 likes; $1.5k first month post-launch;
  120k downloads/$51k by end 2023; then an unexplained ASO ranking jump for
  "habit tracker"; MKBHD video mention in Dec 2024 was the best month ever;
  $112k in Jan 2025
  (https://www.revenuecat.com/blog/growth/sebastian-rohl-habitkit-launched-podcast-2026,
  https://sebastianroehl.substack.com/p/2025-the-year-that-changed-everything).
  Tactics: build in public on X, obsess over one keyword, ship monthly.
- **Habitify:** zero sales for months; one Apple feature → thousands of
  downloads/day → 1M downloads, $21k/mo. Tactic: keep nominating.
- **Structured (Leo Mehlig):** launched April 2020 as a side project; ranked
  for key search terms "from the beginning"; multiple App Store features; App
  Store Foundations Program; 1.7M downloads by April 2022
  (https://indie.watch/issue-17-structured-by-leo-mehlig/,
  https://www.starterstory.com/structured-breakdown).
- **Focusmate:** first 300 users from guerrilla posting on Facebook groups and
  Reddit, then word of mouth and community
  (https://www.starterstory.com/businesses/focusmate/growth-channels,
  https://www.focusmate.com/blog/focusmate-story/). Most relevant analog:
  social accountability spreads through communities that already gather
  around a goal.
- **Streaks (Crunchy Bagel):** 2-person team; 2016 Apple Design Award led to
  Apple Store demo placement and press
  (https://crunchybagel.com/apple-design-awards-2016/).
- **Sunsama:** invite-only, 2,000 users, 10–15%/mo growth, PH "Hot Product of
  the Month" (https://www.mongodb.com/company/blog/innovation/built-mongodb-sunsama).
- **Opal / Amie / Bevel:** VC-funded; Opal used paid acquisition early
  (https://www.speedinvest.com/knowledge/scaling-smart-how-opal-built-a-10m-arr-business-in-just-2-years),
  Amie used a waitlist of "thousands" (https://techcrunch.com/2020/07/09/amie/),
  Bevel prototyped on Reddit before an Aug 2024 launch. Not zero-budget
  comparables.
- **Counter-example:** Roman Koch shipped 8 products in 2025 for $1,464 total
  and wrote about "why most indie apps fail silently"
  (https://medium.com/@romankoch/my-2025-recap-as-an-indie-developer-6846593eaad6).

Common thread: nobody's launch day mattered; ASO on one keyword, one editorial
feature, one creator mention, and existing communities did.

## 5. App Review, rejection risk, TestFlight (2026)

- Apple's stated norm: "on average, 90% of submissions are reviewed in less
  than 24 hours"; 40% of rejections are Guideline 2.1 completeness
  (https://developer.apple.com/distribute/app-review/). Reality in early 2026:
  Runway data showed Jan–Feb averages well above late 2025; developers
  reporting 2–3 days "Waiting for Review" on iOS, 5–7 on macOS, attributed to
  a 24% submission surge
  (https://mjtsai.com/blog/2026/03/02/mac-app-store-review-times-increasing/,
  https://www.runway.team/appreviewtimes). Budget a week for the 1.0 and don't
  schedule press for a fixed day until "Pending Developer Release".
- **TestFlight Beta App Review:** first build of each version needs review;
  historically ~24h; 2026 reports of 2–7 days, subsequent builds of the same
  version auto-approve in minutes
  (https://ptkd.com/journal/testflight-external-testing-approved-2026-backlog,
  https://techconcepts.org/blog/testflight-guide). Start external TestFlight
  at least 3 weeks before you want press testers in.
- **UGC (Guideline 1.2):** must have a filter for objectionable content, a
  report mechanism with timely response, block-user, and published contact
  info; "random or anonymous chat" is flagged as removable
  (https://developer.apple.com/app-store/review/guidelines/). Rally's
  cheers/notes between invited friends are UGC: ship report + block + a
  filter, and describe them in App Review notes with a demo circle.
- **Anonymous accounts / 5.1.1:** "If your app doesn't include significant
  account-based features, let people use it without a login"; anonymous
  sign-in satisfies this. Any account creation triggers in-app **account
  deletion** (5.1.1(v)); if you offer Sign in with Apple, deletion must revoke
  tokens via the SIWA REST API.
- **4.8 Login Services:** bites if you add Google/Facebook login; SIWA plus an
  anonymous system is exempt. (Rally's Welcome screen offers "Continue with
  Google", so Sign in with Apple must stay alongside it.)
- Provide a demo account/circle with pre-seeded content; reviewers reject
  when they cannot exercise social features
  (https://developer.apple.com/forums/thread/791387).

## Ranked shortlist: 12 earned-media targets for Rally

1. **App Store Featuring Nomination**: free, highest ceiling; submit now for
   October and again for New Year. Odds low but nonzero; the privacy/no-streak
   story fits Apple's editorial themes.
2. **9to5Mac Indie App Spotlight** (michaelb@9to5mac.com): actively solicits
   unknown solo devs weekly. Odds moderate-good.
3. **Indie Dev Monday** (indiedevmonday.com/look-at-me): will run a new
   release; also follows build-in-public threads. Odds high.
4. **Indie App Catalog** (indiecatalog.app/submit-app): directory plus
   X/Mastodon amplification. Odds high; must be on US store.
5. **iosdev.space + Bluesky iOS-dev starter packs**: for TestFlight testers
   and launch-day reposts. Odds high, reach small.
6. **Show HN**: pitch the engineering story (no-nav reducer router,
   offline-first WireOp sync, no analytics). Odds moderate for discussion.
7. **Reddit goal communities** (Focusmate's channel): r/getdisciplined,
   r/productivity, writing groups, C25K groups; participate first, post the
   ledger idea second. Odds moderate; rules vary.
8. **Cult of Mac Awesome Apps** (tips@cultofmac.com): weekly roundup. Odds
   low-moderate.
9. **One mid-size creator as a co-owner**: a StudyTok or WriterTok creator
   who runs a public circle; the Focus Friend lesson. Odds low per pitch,
   high impact if one lands.
10. **TechCrunch (Sarah Perez)**: after a traction stat or a trend hook. Odds
    low.
11. **MacStories**: pitch with TestFlight, follow up once. Odds low.
12. **Product Hunt**: cheap, but only once a waitlist of 200+ exists. Odds
    low for installs.

Skip for this app: AppAdvice (shut down early 2026 per two sources), Indie App
Santa/Indie App Sales (require a paid app), AppRaven, iMore, The Verge.

## Sources

- https://developer.apple.com/help/app-store-connect/manage-featuring-nominations/nominate-your-app-for-featuring/
- https://developer.apple.com/app-store/getting-featured/
- https://developer.apple.com/news/?id=nx3eotat
- https://techcrunch.com/2024/06/13/apple-gives-developers-a-way-to-nominate-their-apps-for-editorial-consideration-on-the-app-store
- https://appdrift.co/blog/how-to-get-featured-app-store-google-play
- https://www.mobileaction.co/blog/apple-doubles-the-custom-product-page-limit/
- https://developer.apple.com/help/app-store-connect/create-product-page-optimization-tests/overview-of-product-page-optimization
- https://developer.apple.com/help/app-store-connect/offer-in-app-events/overview-of-in-app-events
- https://www.applaunchflow.com/blog/app-store-in-app-events-guide-2026
- https://appradar.com/blog/apple-in-app-events-iae
- https://toolbox.marketingtools.apple.com/en-us/app-store/us
- https://developer.apple.com/app-store/marketing/guidelines/
- https://mjtsai.com/blog/2026/03/02/mac-app-store-review-times-increasing/
- https://developer.apple.com/forums/thread/803716
- https://9to5mac.com/guides/indie-app-spotlight/
- https://9to5mac.com/2025/11/15/indie-app-spotlight-dimewise-budgeting-app-liquid-glass-iphone/
- https://www.macstories.net/about/
- https://www.macstories.net/linked/app-marketing-my-extended-qa-for-paul-hudsons-everything-but-the-code/
- https://www.macstories.net/stories/macstories-selects-2025-recognizing-the-best-apps-of-the-year/
- https://www.cultofmac.com/about
- https://www.cultofmac.com/awesome-apps
- https://www.macrumors.com/share.php
- https://appadvice.com/apps-gone-free
- https://revenueflo.com/blog/best-appadvice-alternatives-for-iOS-app-deals
- https://techcrunch.com/tag/indie-apps/
- https://techcrunch.com/author/sarah-perez/
- https://techcrunch.com/author/ivan-mehta/
- https://muckrack.com/media-outlet/theverge
- https://indieappcatalog.com/about
- https://indiecatalog.app/submit-app
- https://indiedevmonday.com/look-at-me
- https://x.com/indieappsanta/status/1801562011903332635
- https://indieappsanta.com/2025/10/14/indie-app-santa-vs-appadvice-vs-appraven-which-promo-fits-your-app/
- https://indieappsales.com/
- https://gist.github.com/tzmartin/88abb7ef63e41e27c2ec9a5ce5d9b5f9
- https://favors.dev/blog/show-hn-launch-guide
- https://getlaunchlist.com/blog/how-to-launch-on-product-hunt-2026
- https://screenfast.app/blog/how-to-launch-ios-app-product-hunt
- https://iosdev.space/about
- https://blueskystarterpack.com/ios-dev
- https://blueskystarterpack.com/indie-dev
- https://influencermarketinghub.com/influencer-rates/tiktok-influencer-rates/
- https://influencermarketinghub.com/influencer-rates/micro-influencer-rates/
- https://influee.co/blog/tiktok-influencer-rates
- https://thesocialcat.com/blog/influencer-marketing-report
- https://www.janney.ai/blog/influencer-benchmark-2025/
- https://megadonkey.com.au/blog/free-tools-to-find-micro-influencers
- https://www.modash.io/blog/how-to-find-micro-influencers
- https://stackinfluence.com/blog/tiktok-marketplace-requirements
- https://fluxnote.io/guides/instagram-creator-marketplace-eligibility
- https://www.tiktok.com/discover/tiktok-study-accounts-to-follow
- https://www.tiktok.com/discover/75-hard-for-filming-and-writing
- https://theribbonbox.com/wellbeing/running-influencers/
- https://md-eksperiment.org/en/post/20260116-mastering-viral-tiktok-trends-in-2026-full-breakdown-participation-hacks-and-creation-strategies
- https://www.influencers-time.com/tiktok-stitch-and-duet-challenges-a-brand-playbook/
- https://www.tubefilter.com/2025/08/20/hank-green-tops-app-store-charts-focus-friend/
- https://techcrunch.com/2025/11/18/hank-greens-focus-friend-is-google-plays-app-of-the-year
- https://www.milkkarten.net/p/creator-brand-olivia-unplugged-opal
- https://blog.sparrowapps.io/p/finch-how-a-self-care-app-hit-30m-arr-without-vc-money
- https://www.revenuecat.com/blog/growth/sebastian-rohl-habitkit-launched-podcast-2026
- https://sebastianroehl.substack.com/p/2025-the-year-that-changed-everything
- https://habitify.me/blog/from-0-in-6-months-to-1m-downloads-and-21-000-month-the-story-of-habitify-the-habit-tracker-app
- https://indie.watch/issue-17-structured-by-leo-mehlig/
- https://www.starterstory.com/structured-breakdown
- https://www.starterstory.com/businesses/focusmate/growth-channels
- https://www.focusmate.com/blog/focusmate-story/
- https://crunchybagel.com/apple-design-awards-2016/
- https://www.mongodb.com/company/blog/innovation/built-mongodb-sunsama
- https://www.speedinvest.com/knowledge/scaling-smart-how-opal-built-a-10m-arr-business-in-just-2-years
- https://techcrunch.com/2020/07/09/amie/
- https://insider.fitt.co/press-release/bevel-launches-a-health-companion-to-improve-longevity-and-performance/
- https://codakuma.com/2025-in-review/
- https://medium.com/@romankoch/my-2025-recap-as-an-indie-developer-6846593eaad6
- https://developer.apple.com/distribute/app-review/
- https://developer.apple.com/app-store/review/guidelines/
- https://www.runway.team/appreviewtimes
- https://ptkd.com/journal/testflight-external-testing-approved-2026-backlog
- https://techconcepts.org/blog/testflight-guide
- https://developer.apple.com/forums/thread/791387
- https://ptkd.com/journal/app-store-rejection-4-8-sign-in-with-apple-requirement-fix
- https://www.termsfeed.com/blog/apple-requirement-in-app-deletion-accounts/
