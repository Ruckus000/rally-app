# Research: market size, seasonality, ASO, benchmarks, the name

> Compiled 1 September 2026 for the Rally launch plan. The session's network
> egress proxy blocked nearly every third-party domain (AppTweak, AppFollow,
> MobileAction, Sensor Tower, Appfigures, Adjust, Statista, apps.apple.com,
> uspto.report, Justia, TechCrunch, MacRumors), and the web-search budget ran
> out mid-task. Only developer.apple.com pages could be fetched in full.
> Everything else comes from search-result snippets, so treat those figures as
> "reported by the cited page" and verify before quoting externally. Where a
> number could not be found at all it says **not found**.

## 1. Market: size, seasonality, leaders

### Size and growth

No Sensor Tower, Appfigures, or data.ai report dedicated to the
habit/goal/accountability category surfaced. What exists are syndicated
market-research estimates that disagree by an order of magnitude, which is
itself the finding: the category is not measured cleanly.

| Source | 2025 | 2026 | CAGR / horizon |
|---|---|---|---|
| Straits Research | $1.94B | $2.22B | 14.2% → $6.41B by 2034; North America 36.5% share |
| MarketReportsWorld | $1.15B | — | — |
| DataIntelo | $8.6B | — | — |
| Business Research Insights | $13.06B | $14.94B | — |
| Habit-Streak blog (secondary) | — | ~$14.9B | — |

Straits (the low, defensible end) lists the key players as Fabulous,
Habitica, Productive, Streaks, TickTick, Coach.me, HabitBull, HabitShare,
Strides, and says the top five hold ~38% of revenue and freemium subscriptions
~52% of revenue. One report claims ~118M people use habit-tracking apps.
Downloads/MAU for the category as a whole: **not found** from a first-party
analytics vendor.

### Seasonality evidence

- **January spike (strong evidence).** Adjust's health-tracker dataset:
  January 2023 installs were 36% above December and 34% above the H1 average;
  February −6%; April −20%; May −44% versus January. AppTweak's seasonality
  guide attributes late-Dec/early-Jan lifts to new devices plus resolution
  intent. A Digital Yield Group post cites ~46% January surge for fitness
  downloads (secondary).
- **Monday effect (moderate evidence, health not apps).** Healthy Monday /
  Monday Campaigns research and a PMC study on weekly Wikipedia health
  searches both find health-information seeking peaks at the start of the
  week. A 2018 TechCrunch-covered study found day-of-week effects in
  dieting-app logging were larger than seasonal ones. No app-download-by-
  weekday dataset was found.
- **September / back-to-school.** Google's own back-to-school trend posts
  show retail searches spiking around August 1; **no** habit-app-specific
  September download evidence was found. Treat September as plausible but
  unproven; Rally's October launch sits just after it.

### Category leaders and scale (all figures secondary; verify)

| App | Reported scale | Source |
|---|---|---|
| Finch: Self-Care Pet | ~400K downloads & ~$2M/mo iOS, ~300K & ~$900K/mo Google Play (Sensor Tower estimates cited by third parties); ~$30M ARR | Sensor Tower overview page, Sparrow Apps blog |
| Fabulous | 15M+ downloads by early 2025 | Analytics Insight |
| Habitica | 4.5M registered users; ~40K monthly downloads, 4.0★ on 2.3K reviews | DataIntelo / AppRundown |
| HabitNow | 7.2M downloads (Android-led) | AppBrain |
| Streaks (Crunchy Bagel) | 750K+ downloads | search snippet; source page not confirmed |
| Way of Life | ~730K downloads | AppBrain / Google Play |
| Productive | **not found** | — |
| HabitKit (indie, relevant comp) | $602K revenue 2025, #2 for "habit tracker," ~98% of revenue from search | X article by Ahmed Gagan |
| Ever Accountable (owns the "accountability" head term) | 700K+ installs, 4.6★ / 5,400+ reviews | everaccountable.com |

## 2. ASO keyword research (US App Store)

**Hard numbers: not found.** Every ASO tool's public keyword page was blocked,
and Apple does not publish search volume; the ASO industry's own guides
stress that volumes are tool-modelled proxies. What follows is the
qualitative evidence that surfaced.

**Head terms**

- **habit tracker**: the category's head term. One indie post-mortem calls it
  "one of the most difficult keywords"; HabitKit's ASO breakdown says 248
  apps compete for it in the US and HabitKit holds #2. High volume, very high
  difficulty. Rally should *not* lead with it.
- **productivity, streak, goal tracker, weekly planner**: generic head terms;
  AppFollow's guide notes generic terms score "hard with high volume" while
  long-tail scores "easy with lower volume" (their example: "habit tracker
  for adhd").
- **accountability**: the search results for this term are dominated by
  *content-monitoring* apps (Ever Accountable, Covenant Eyes, Accountable2You
  "Monitoring"), i.e. porn/screen accountability, not goal accountability.
  Ranking for the bare word would put Rally next to the wrong intent.
  Long-tail variants ("accountability partner," "goal accountability,"
  "accountability buddy") are the usable part of that intent.

**Direct social-habit competitors and their naming pattern** (title strings
as shown in search results): *HabitShare - Habit Tracker*, *HabitFriend:
Habit Tracker*, *WithPeers - Habit & Goal Tracker*, *Habit Tracker -
Goalify*, plus newer entrants Cohorty, Buddito, Habi, Be Candid. Every one
spends title real estate on "Habit Tracker." Also note *Rallly - Plans with
Friends* (a different app) already uses a "with Friends" subtitle in the
Rally namespace.

**Long-tail phrases that fit Rally and look under-served** (judgment, since
volumes are unavailable): "goals with friends," "accountability partner,"
"accountability buddy," "weekly goals," "goal buddy," "commit to goals,"
"challenge with friends," "goal circle," "no streaks." Apple combines terms
across name, subtitle and keyword field, so covering the individual words
*goals, friends, accountability, partner, weekly, buddy, challenge,
commitment* yields all of those combinations.

## 3. Apple App Store metadata rules (verified from developer.apple.com, 2026)

**Text fields:** Name 2–30 chars; Subtitle 30; Keywords 100 (comma-separated,
no spaces after commas); Promotional Text 170 (editable without a new build,
**not indexed**); Description 4,000.

**What is indexed** (Apple's App Store Search page): name, subtitle,
keywords, primary/secondary category, plus **App Store Tags generated by
LLMs from your metadata**, plus user-behavior signals (downloads, ratings,
reviews, engagement). Apple's stated keyword-field rules: don't repeat words
already in name, subtitle or category; avoid plurals of words already used;
avoid generic terms ("app," "game"), filler words, special characters; no
competitor app names, unauthorized trademarks or irrelevant terms. Apple does
*not* publish a weighting; "title > subtitle > keyword field" is industry
consensus and consistent with Apple's advice to put the strongest term in
the name.

**Screenshots** (Apple spec): 6.9" is **required** at 1260×2736 (portrait);
6.5" (1284×2778) is optional and auto-scaled from 6.9" if omitted; 1–10 per
localization; JPG/PNG, no alpha. **App previews:** up to 3 per localization,
15–30 s, ≤500 MB, 886×1920 for 6.9"/6.5", H.264 or ProRes 422 HQ.

**Custom Product Pages:** up to **70** additional pages (raised from 35 on
29 October 2025); each can vary screenshots, previews and promotional text;
since 30 July 2025 you can assign **keywords** to a CPP so it replaces the
default page in those search results; Apple cites a 2.5-pp average CVR lift
over a 1.6% baseline; deep links need iOS 18+.

**In-App Events:** up to 15 approved at a time, **10 published**
simultaneously, max 31 days each, up to 14 days pre-promotion; name 30 /
short description 50 / long description 120 chars; explicitly *not* for
repetitive daily tasks. A "New Year Week" or "Monday Reset" challenge would
qualify; a recurring weekly ledger would not.

**2025–2026 changes**

- **AI-generated App Store Tags** (WWDC, 11 June 2025): LLM-generated from
  metadata, description, category and screenshots; human-reviewed;
  developers can only *deselect* tags, not add them; tags appear in search
  results and open curated collections.
- **Apple Intelligence review summaries** (iOS 18.4, April 2025):
  server-side summaries at the top of Ratings & Reviews, refreshed weekly
  for apps with enough reviews, US English first.
- **CPP keywords (July 2025) and 70-page cap (October 2025)** as above.
- **More ads in search results from March 2026** (reported by AppTweak /
  AppFollow news roundups; Apple primary source not fetched).
- Vendors report that conversion, retention and review velocity now weigh
  comparably to metadata, and that keyword stuffing yields less lift.
  Directionally consistent with Apple's own "user behavior" language;
  magnitudes are vendor claims.

## 4. Benchmarks for a new free social/productivity app

| Metric | Range | Source (period) |
|---|---|---|
| App Store conversion (US, all apps) | ~25% avg; Business 66.7%, Utilities 33–38%, Finance 18–22%, Board Games ~1.2% | AppTweak H1 2024 / H1 2025 via Adapty & AppScreenshotStudio |
| Product-page-view → install medians | 4.5% (games) to 32.5% (music); Health & Fitness 18.5% | SplitMetrics 2025 |
| **Productivity / Social Networking CVR specifically** | **not found** | — |
| Apple's own default-page CVR reference | 1.6% (impression-based) | Apple CPP page |
| Retention, all apps | D1 ~25–28%, D7 ~11–18%, D30 ~8% | aggregate posts citing AppsFlyer 2025 / Pushwoosh |
| Retention, iOS (Pushwoosh 2025) | D7 6.9%, D30 3.1% | Pushwoosh Benchmarks 2025 |
| Social apps D1 | ~30%+ | Sendbird/Stream roundups |
| iOS push opt-in | 43.9% (Airship/Business of Apps) to 56.4% (Pushwoosh 2025, 600+ apps) | Pushwoosh, Business of Apps, Mobiloud |
| Referral click-to-install, social/messaging | 30–55%; general apps 15–35% download, 50–70% of those finish onboarding; deep links +65% | GrowSurf 2026, vmobify, Branch |
| Review prompt | Apptentive: native prompt → daily ratings ×32, 90% of apps +20% avg stars. Per-prompt "% who rate": **not found**. Max 3 prompts/365 days | Alchemer/Apptentive, Apple |

Two cautions from the sources themselves: Apple's App Store Connect CVR is
measured differently from vendor charts (impression- vs page-view-based), so
compare only like with like; and a Rally-style app with a friend-invite loop
should model D7 against the *social* row, not the productivity row, because
retention is driven by whether the circle fills.

## 5. Name check: "Rally"

**Crowding: high.** Apps found with "Rally" in the title: Rally Nation,
M.U.D. Rally, Art of Rally, Best Rally, #DRIVE Rally (racing games), Rally
Rd. – Invest, Buy & Sell (finance), Rally Sports, Rally: Voice Notes on Race
Day (running), Rally Tripmeter, Rally Racket Sports, Rally: Vote on Plans
(social decision polls), Let's Rally! (spontaneous hangouts), Rallly – Plans
with Friends, Rally: Rave Tracker & Friends, Rally Rider – Travel together,
Road & Rally. Two clusters matter: motorsport games (irrelevant intent, but
they own the bare word) and **social planning apps** ("Vote on Plans,"
"Plans with Friends," "Let's Rally!"), which are adjacent enough to Rally's
"friends" positioning to cause confusion in search results and tag
collections.

**Can a subtitle compensate?** Partly. Apple indexes name + subtitle +
keywords together, so "Rally: Goals with Friends" will rank for the
*long-tail* it owns; it will not win the bare query "rally," which is fine,
since nobody with goal intent types that. The real cost is brand recall: a
user who remembers "Rally" and searches it will see a wall of racing games.
Mitigation: make the title suffix a memorable phrase, and drive installs via
CPP deep links and invite links rather than brand search.

**Trademark signals (high level, not legal advice).** USPTO records
surfaced: **RALLY** by RedBrick Health Corp (serial 86526039), non-
downloadable software for health & wellness and *managing user participation
in health challenges*; **RALLY** marks owned by Rally Health, Inc.; **RALLY**
by Rally Network, Inc. (serial 88129498, crypto/collectibles, explicitly
excluding health/wellness); **RALLY SOFTWARE** (Class 42, now Broadcom); and
a TTAB proceeding index for "Rally LLC." The RedBrick/Rally Health "health
challenges" description is the closest overlap with a goals-with-friends
app; live/dead status could not be verified. Worth a proper clearance search
before spending on the brand.

## Recommended metadata for launch

**Title (25/30):** `Rally: Goals with Friends`
Puts the two words Rally can own, *goals* and *friends*, in the
highest-weight field, matches the "with friends" search pattern users already
use for HabitShare/Cohorty-class apps, and avoids "habit tracker," where 248
apps and HabitKit at #2 make a new entrant invisible.

**Subtitle (29/30):** `Weekly accountability partner`
Adds three distinct indexed words (*weekly, accountability, partner*) so
Rally covers "accountability partner," "weekly goals," "goals with friends,"
and "accountability app" via cross-field combination, while steering toward
the *partner* sense rather than the monitoring-app sense of "accountability."

**Keyword field (99/100):**
`habit,tracker,buddy,commitment,challenge,circle,cheer,streak,planner,productivity,motivation,social`
No words repeated from title/subtitle, no plurals, no competitor names.
*habit + tracker* still gets the long tail ("social habit tracker," "habit
tracker with friends") without title space; *buddy/commitment/challenge*
cover the accountability-adjacent phrases; *streak* is included so Rally
appears for streak searches even though the pitch is "no streaks";
*circle/cheer* reflect Rally's own vocabulary and feed the LLM tag generator.

**Promotional text (not indexed):** use it for the seasonal hook and swap it
without a build. Pair with one In-App Event per season (January is the only
proven spike) and a keyword-assigned CPP for "accountability partner" whose
screenshots lead with the circle and the weekly ledger, not with a habit grid.

**What to measure after launch:** page-view→install CVR by source, D1/D7
split by "joined a circle vs. didn't," invite click→install (target the
30–55% social band), and iOS push opt-in against ~45–55%.

## Sources

Market: https://straitsresearch.com/report/habit-tracking-apps-market · https://www.marketreportsworld.com/market-reports/habit-tracking-app-market-14722185 · https://dataintelo.com/report/habit-tracker-app-market · https://www.businessresearchinsights.com/market-reports/habit-tracking-apps-market-109438 · https://habit-streak.com/en/blog/habit-tracking/state-of-habit-tracking-2026 · https://sensortower.com/blog/state-of-mobile-health-and-fitness-in-2025 · https://www.adjust.com/blog/health-tracker-installs-and-retention-data/ · https://www.apptweak.com/en/aso-blog/app-store-seasonality · https://www.statista.com/statistics/1441103/health-app-install-change-new-year · https://digitalyieldgroup.com/blog/health-fitness-apps-the-resolutioner-churn-problem/ · https://healthymonday.com/research · https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4704932/ · https://techcrunch.com/2018/01/08/study-seasons-have-little-effect-on-dieting-app-reporting-but-the-day-of-week-does/ · https://app.sensortower.com/overview/1528595748?country=US · https://blog.sparrowapps.io/p/finch-how-a-self-care-app-hit-30m-arr-without-vc-money · https://www.analyticsinsight.net/ampstories/apps/top-rated-habit-tracker-apps-in-2025 · https://apprundown.com/best/habit-tracker-apps · https://www.appbrain.com/app/habitnow-daily-routine-planner/com.habitnow · https://x.com/ahmedgagan11/article/2086481324148404524 · https://everaccountable.com/freedom/iphone/

ASO keywords: https://foxdata.com/en/marketing-academy/a-comprehensive-guide-to-understanding-app-store-keyword-search-volume/ · https://www.gummicube.com/blog/app-store-keyword-search-volume-what-you-need-to-know-for-aso/ · https://appfollow.io/blog/aso-keywords · https://sebastianroehl.substack.com/p/my-app-store-optimization-strategy · https://lifestack.ai/blog/accountability-app · https://habi.app/insights/accountability-apps/ · https://buddito.com/blog/best-accountability-apps/ · https://becandid.io/blog/best-accountability-apps-2026 · https://apps.apple.com/us/app/accountable2you-monitoring/id1531309290 · https://apps.apple.com/us/app/habitshare-habit-tracker/id1048191045 · https://withpeers.app/ · https://www.cohorty.app/blog/best-habit-tracking-apps-with-friends · https://www.makeuseof.com/best-social-habit-tracking-apps/

Apple rules: https://developer.apple.com/app-store/search/ · https://developer.apple.com/help/app-store-connect/reference/app-information/ · https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/ · https://developer.apple.com/help/app-store-connect/reference/app-preview-specifications/ · https://developer.apple.com/app-store/custom-product-pages/ · https://developer.apple.com/app-store/in-app-events/ · https://techcrunch.com/2025/06/11/at-wwdc-apple-says-it-will-use-ai-to-tag-apps-to-improve-discoverability-on-the-app-store · https://www.apptweak.com/en/aso-blog/apple-wwdc-2025-recap · https://techcrunch.com/2025/03/05/apple-adds-ai-powered-app-review-summaries-with-ios-18-4/ · https://www.mobileaction.co/blog/apple-doubles-the-custom-product-page-limit/ · https://respectaso.com/blog/custom-product-pages-app-store-guide-2026/ · https://appfollow.io/blog/aso-news · https://foxdata.com/en/blogs/app-store-algorithm-changes-in-2026-what-you-need-to-know/ · https://asoworld.com/insight/app-store-search-algorithm-2026-what-actually-decides-your-keyword-ranking/ · https://appscreenshotstudio.com/blog/app-store-metadata-for-indie-devs-title-subtitle-keywords-2026

Benchmarks: https://adapty.io/blog/app-store-conversion-rate/ · https://appscreenshotstudio.com/blog/good-app-store-conversion-rate-benchmarks-2026 · https://www.pushwoosh.com/blog/increase-user-retention-rate/ · https://www.pushwoosh.com/blog/push-notification-benchmarks/ · https://sendbird.com/blog/app-retention-benchmarks-broken-down-by-industry · https://getstream.io/blog/app-retention-guide/ · https://www.businessofapps.com/marketplace/push-notifications/research/push-notifications-statistics/ · https://www.airship.com/resources/benchmark-report/mobile-app-push-notification-benchmarks-for-2025/ · https://growsurf.com/statistics/mobile-app-referral-statistics/ · https://www.branch.io/resources/blog/mobile-sharing-and-referral-feature-benchmarks-from-branch/ · https://phiture.com/asostack/unlocking-the-data-behind-the-ios-rating-prompt-8e942bfe9134/ · https://www.alchemer.com/resources/blog/using-rating-prompts-mobile-app/

Name / trademark: https://apps.apple.com/us/app/rally-vote-on-plans/id6767920326 · https://apps.apple.com/us/app/lets-rally/id6503183666 · https://apps.apple.com/us/app/rallly-plans-with-friends/id6741699223 · https://apps.apple.com/us/app/rally-rave-tracker-friends/id6759811445 · https://uspto.report/TM/86526039 · https://uspto.report/TM/88129498 · https://trademarks.justia.com/owners/rally-health-inc-3044762 · https://ttabvue.uspto.gov/ttabvue/v?pnam=Rally+LLC++ · https://www.gerbenlaw.com/blog/trademark-search-for-an-app-or-name-of-a-software-program/
