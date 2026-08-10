# Handoff: Rally — Week Spine (mobile app, 5 screens + 4 overlays)

## Overview

Rally is a social goal-tracking app. A user **stakes** a small number of tasks on a week, optionally **pairs** with friends on them, and the circle **cheers** each other through. Points are earned by closing staked tasks; a leaderboard ranks the circle by follow-through, and a weekly **ledger** closes the loop by showing what you did, who helped you, and who you helped.

The product thesis, and the thing to protect in implementation: **this is not a todo app with a feed bolted on.** The social layer is the accountability mechanism. Every screen answers either "what did I put on the line?" or "who is with me?"

## About the design files

The files in this bundle are **design references created in HTML** — a running prototype showing intended look, copy, and behavior. They are **not production code to copy**.

The task is to **recreate these designs in the target codebase's own environment** (React Native, SwiftUI, Flutter, React web, etc.) using its established patterns, component library, and state management. If no environment exists yet, choose the framework appropriate to the target platform (this design is mobile-first, drawn at 402×874 — iPhone 14 Pro logical size) and implement there.

The prototype is written in a custom template runtime. **Do not port its templating.** Read it for structure, values, copy, and interaction logic only.

## Fidelity

**High-fidelity.** Colors, typography, spacing, radii, and copy are final and intentional. Recreate pixel-accurately using the codebase's own primitives. All values in this README were read directly from the prototype source.

Two deliberate exceptions, both **mock data, not spec**: (1) all people, tasks, and history are hardcoded fixtures; (2) the prototype has no persistence, no network, and no auth.

---

## Design tokens

### Color

| Token | Hex | Use |
|---|---|---|
| `ink` | `#191E16` | Primary text, dark cards, tab bar fill, primary button on light |
| `lime` | `#C3F53C` | The single accent. CTAs, active states, points, rings, badges |
| `paper` | `#F1F2EC` | App background, sheet background, text on dark |
| `muted` | `#6E7663` | Secondary text on light |
| `moss` | `#4B6A0B` | Accent text on light (links, positive points, "you got") |
| `card` | `#FFFFFF` | Card surface on light |
| `plan-bg` | `#12170F` | Plan overlay background |
| `plan-card` | `#1B2116` | Plan composer card |
| `tabbar` | `rgba(19,24,13,.94)` | Tab bar, with `backdrop-filter: blur(18px)` |
| `faint-ink` | `#A6AC9C` | Tertiary text, timestamps |
| `quote-ink` | `#5A6350` | Quote text on light |
| `divider` | `rgba(25,30,22,.12)` | Hairlines on light |
| `avatar-text` | `#3B4630` | Initials inside avatar circles |

App shell backdrop (behind the phone frame, prototype only): `radial-gradient(1100px 600px at 50% -12%, #222B14 0%, #101408 62%)`.

**Avatar tints** (per person, pastel, initials in `#3B4630`):
`you #E0E6D3` · `maya #D5E2BD` · `dre #E9E0C2` · `jordan #E8CFBE` · `sofia #C9D9CE` · `nana #EFE3AE` · `tomas #CBD6C4`

**Year-grid cell levels:** `0 #EDF0E4` (nothing) · `1 #DCE3CE` (partial) · `2 #A9D93C` (good) · `3 #C3F53C` (perfect)

Alpha ramp on dark (text over `#191E16` / `#12170F`): `.45` tertiary, `.55` secondary, `.62` body-secondary, `1.0` primary. **Never go below `.45`** — that floor was set to pass contrast on small caps labels.

### Typography

Two families, loaded from Google Fonts:

- **Bricolage Grotesque** — weights 500/600/700/800. Display only: numbers, headings, names in stat positions, badge labels. Always paired with tight tracking.
- **Instrument Sans** — weights 400/500/600/700. Everything else: body, labels, buttons, inputs.

| Role | Family | Size | Weight | Tracking |
|---|---|---|---|---|
| Screen title | Bricolage | 29px | 800 | -0.7px |
| Hero number (Me, all-time pts) | Bricolage | 48px | 800 | -2.2px, line-height .85 |
| Hero number (Plan, staked) | Bricolage | 76px | 800 | -3.5px, line-height .8 |
| Perfect-week headline | Bricolage | 26px | 800 | -0.6px |
| Card title (social) | Bricolage | 17px | 700 | -0.2px |
| Card title (big/dark) | Bricolage | 22px | 800 | -0.4px |
| Composer input | Bricolage | 23px | 800 | -0.6px |
| Sheet title | Bricolage | 21px | 700 | -0.3px |
| Stat value | Bricolage | 16–21px | 800 | — |
| Body | Instrument | 13.5–14.5px | 400–600 | — |
| Secondary | Instrument | 11.5–12.5px | 400–600 | — |
| Section label (caps) | Instrument | 10–11px | 700 | 1.4–2.2px, uppercase |
| Tab label | Instrument | 10px | 700 | — |

**Minimum readable size is 10px and only for uppercase tracked labels at ≥`.45` alpha.** Do not shrink further.

### Spacing, radius, elevation

- Spacing rhythm: 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 22 / 26px. Screen gutter **18px** (Plan overlay: 20px).
- Radii: pill `999px` · small card `14–16px` · row `18px` · card `19–22px` · large card `23–26px` · composer `26–27px` · sheet top `28px` · tab bar `26px`.
- Shadows: card `0 1px 2px rgba(25,30,22,.05)` · tab bar `0 16px 34px rgba(10,14,6,.4), 0 2px 6px rgba(10,14,6,.3)` · FAB `0 6px 18px rgba(195,245,60,.35)` · tooltip `0 14px 34px rgba(0,0,0,.45)`.
- **Gradient hairline** (the signature treatment on highlighted cards): a 1px padding wrapper filled with `linear-gradient(158deg, rgba(195,245,60,.60), rgba(195,245,60,.06) 42%, rgba(241,242,236,.05) 80%)` around an inner card 1px smaller in radius. Used on: your own task rows, the big perfect-week cards, and the Plan composer.
- **Glow bloom**: `radial-gradient(circle, rgba(195,245,60,.20–.25), transparent 68%)` on a large offset circle, clipped by the card — top-right on dark cards.

### Motion

| Name | Keyframes | Duration / easing |
|---|---|---|
| `bRise` | translateY(12px)→0, opacity 0→1 | entry, feed items |
| `bSheet` | translateY(100%)→0 | `.3s cubic-bezier(.2,.9,.2,1)` |
| `bPop` | scale .86→1.04→1, opacity 0→1 | toast, badges |
| `bPulse` | box-shadow ring `rgba(195,245,60,.5)`→transparent 8px | attention pulse |

`@media (prefers-reduced-motion: reduce)` disables all animation and transition. **Keep this.**

---

## Screens

The app is a **3-tab shell** (Week / Circle / Me) plus a raised center **compose FAB**, with four full-screen overlays (Plan, Ledger, Notifications, Join) and one bottom sheet.

### Shell

- **Header** (`padding: 60px 18px 10px`, background `paper`, `z-index: 20`): title 29px Bricolage + 12px muted subtitle on the left; 42px circular white bell button on the right with a badge (`ink` fill, `lime` text, 18px min-width pill, 2px `paper` border) when unread > 0. On Week, a scope tab row sits below.
- **Scroll body**: `flex: 1; overflow-y: auto; padding: 6px 18px 16px`. **One scroll container shared by all three tabs — scroll position resets to 0 on tab change.** Implement per-tab scroll restoration or the same reset; do not let position bleed.
- **Tab bar** (`padding: 6px 16px 26px`): pill, `rgba(19,24,13,.94)` + 18px blur, radius 26px, `padding: 9px 6px`. Three icon+label tabs (icons 20px, stroke `currentColor` 2px; active = `lime`, inactive = `rgba(241,242,236,.62)`) with a lime radial glow behind the active icon. **The center is a 54×46px lime FAB (radius 17px, `+` glyph in `ink`), not a tab** — Plan is an action, not a destination. `aria-label="Plan your week"`.

### 1. Week — `data-screen-label="Week"`

Three scopes via header tabs: **Personal · Friends · Global**.

**Personal scope** adds above the feed:
- Quick-log composer: 38px "AR" avatar + a 44px-tall white pill button "Log something for today…". Tapping opens a real input + 44px lime submit circle. Enter submits, Escape closes. Quick logs are created with **20 pts, category "Quick log", audience `friends`, no pair, today's day**.
- Points bar: `ink` row, radius 18px — `{pts} pts · {n} this week` with a `lime` "Plan →" on the right. Opens Plan.

**Feed item types** (each is a distinct component):

| Type | Surface | Notes |
|---|---|---|
| `label` | none | Section caps label, 11px/1.4px tracking, muted |
| `mine` | white, radius 19px, gradient hairline | Checkbox (tap toggles done), title + pair faces + audience chip + comment count, points on right |
| `big` | `ink`, radius 23px, glow | Someone's perfect week: avatar, name, `PERFECT` lime pill, 22px headline, 3 stats, quote with lime left rule, engagement row + CTA |
| `social` | white, radius 21px (ask variant: `#F7FBE4` + 1.5px lime border) | Avatar row, 17px title, optional quote with tinted left rule, engagement row |
| `quiet` | none | A single muted line + a text action — low-key comeback moments |
| `mineWin` | `ink`, radius 23px, glow | **Your own perfect week** (see below) |
| `empty` | none | Centered "Nothing staked yet / The week doesn't count itself." + `ink` pill CTA to Plan |

**Engagement row** — 18px gap, buttons `min-height: 40px`, `padding: 9px 4px`:
- 🔥 button. Label is the count, or the word **"Cheer"** when zero. Active state = lime. **Tapping toggles: a second tap un-cheers** ("Cheer taken back").
- 💬 button (15px outline speech icon). Label is the count, or **"Note"** when zero. Opens the task sheet.
- Optional text CTA (e.g. "I'm in").
- **All three must `stopPropagation`** — the card itself is tappable and opens the detail sheet.

### 2. Circle — `data-screen-label="Circle"`

- **Podium**: three ranked members, center largest. Each is an SVG progress ring (`r=43`, `stroke-dasharray: 270.4`, `stroke-dashoffset` = `270.4 * (1 - done/total)`, rotated -90°, track `rgba(25,30,22,.08)`) around a tinted initials circle, with a rank badge pinned bottom-center. Below: `**First** · sub`.
- Caps label "TOP PERFORMERS THIS WEEK".
- **Ranked list**: one white card, radius 24px, rows of `rank · 36px ring avatar · name + metric · trend glyph · cheers-given chip`.
  - **The row metric must be the metric the ranking uses.** Ranking is by follow-through; the row reads `71% · 5 of 7 · 🔥 2w`. Do not show points here — it implies a different sort.
- Total-cheers bar (`ink`, radius 18px) and an invite button opening the invite sheet.

### 3. Me — `data-screen-label="Me"`

Top to bottom:
1. **Profile card** (`ink`, radius 26px, glow): 60px lime-ringed avatar, name 22px Bricolage, `@handle · Circle name`, and a tappable rank chip on the right (→ Circle).
2. **Points row**: 48px all-time number + `POINTS / ALL TIME` caps, and current-week points right-aligned under `WEEK {n} SO FAR`.
3. **Streak bar**: 5 segments (7px, pill), filled lime for completed weeks; caption line + "5w record". Tappable.
4. **Year grid**: `grid-template-columns: repeat(13, 1fr); gap: 4px`, one cell per week since joining, colored by level. Header: `EVERY WEEK SINCE YOU JOINED` + `{n} of {total} finished`. **Cell count must equal weeks-since-join, not a fixed 52.**
5. **Exchange card**: two-column gave/got with a split bar, an interpretation line, and the explainer *"Every cheer lands on their phone, with your name on it."*
6. **You owe a word to** — people awaiting a reply, with an action button. Hidden when empty.
7. **Personal bests** — 2×2 stat grid.
8. **Past weeks** — rows per historical week; **each opens its own ledger with that week's real data.**
9. "See this week's ledger" button.

### 4. Plan (overlay) — `data-screen-label="Plan"`

Full-screen `#12170F`, `z-index: 45`. Back chevron closes.

- Eyebrow `WEEK {n} · {7-day} DAYS LEFT`, title.
- **Hero**: 76px lime staked-points number with `text-shadow: 0 0 44px rgba(195,245,60,.32)`, label `STAKED THIS WEEK`, a progress bar toward your best week, a caption, and a tappable "best week" chip (→ Me).
- **Composer** (gradient hairline, `#1B2116` inner, radius 26px):
  - `I WILL…` lime caps label, then a 23px Bricolage input with `caret-color: lime`. **Placeholder changes with the selected category** (Fitness → "run three times this week", Work → "ship the portfolio site by Friday", Home → "meal prep every Sunday", Mind → "read 30 minutes before bed").
  - **Day picker**: 7-column grid, each cell shows day initial + count already staked.
  - **Category chips**: Fitness / Work / Home / Mind. Category determines points: **Fitness 35 · Work 45 · Home 25 · Mind 25.**
  - **SEEN BY**: three visible chips — Friends / Everyone / Private — as a **segmented control, not a cycler**. This is a privacy control; all options stay visible. Defaults to the `defaultAudience` setting. First-run tooltip explains it.
  - **IN IT WITH ME**: friend chips, multi-select; a hint line describes the pairing.
  - Submit button: `Stake it on {Day} · +{pts} pts`, or `Write it down first` when empty (disabled look).
- **PICK IT BACK UP**: horizontal card rail of suggestions (unfinished last week / already staked by friends / streak-at-risk). One tap stakes it.
- **STAKED · {n}**: rows of `DAY · title · pair faces · audience chip · +pts · ✕ unstake`. **Unstake is required** — a staked task must be removable. Empty state: dashed-border prompt.
- Footer CTA with a gradient scrim.

### 5. Notifications (overlay) — `data-screen-label="Notifications"`

`z-index: 58`. Filter chips, then **three tiers, in this order**, each with a colored dot, count, and a blurb explaining the tier:
1. **Needs you** — someone is actually waiting (this tier drives the unread badge).
2. **Worth a look** — friends' moments.
3. **Batched** — cheers rolled up into one line.

Rows: 38px icon tile (system) or overlapping faces (person), text with the name bolded, timestamp, optional aging pill, optional CTA. Routing is per-item — some open a task sheet, some a person, some Plan, some the ledger. Footer: *"Nudges only arrive when someone is actually waiting on you. Cheers batch into one."*

### 6. Week ledger (overlay) — `data-screen-label="Week ledger"`

`z-index: 55`, `paper`. Title = the week being viewed. Three sections: **WHAT YOU DID** (task + points rows), **WHO HELPED YOU**, **WHO YOU HELPED** (avatar + name + specific detail). Two footer buttons whose labels depend on context: current week → `Not yet` / `Stake Week {n+1}`; historical week → `Close` / `Back to today`. Empty states are written, not generic ("That week didn't land. It happens.").

### 7. Detail sheet

`z-index: 50`, bottom sheet on a `rgba(16,20,8,.42)` scrim, `max-height: 86%`, radius `28px 28px 0 0`, `bSheet` animation, 38×4px drag handle. Three variants:
- **task** — author, meta, points pill, title, private note, joint-progress cards, action chips, notes thread + composer.
- **person** — profile head, their week's tasks with join/act buttons, notes thread + composer. Empty: "You could be the first voice they hear today."
- **invite** — copyable link, pending invites, suggestions.

Closes on scrim tap. **Add a close button and Escape/back handling in the build** — the prototype's drag handle is decorative.

### 8. Join circle (onboarding) — `data-screen-label="Join circle"`

`z-index: 70`. Circle name, member faces, "Join" primary + "Skip for now" secondary.

---

## Interactions & behavior

- **Cheer** — toggles on/off; fires a toast. Cheers given feed the Circle total and the Me exchange bar. **A cheer is one specific act** — do not count replies, cosigns, or joins as cheers.
- **Complete a task** — toggles done. When the toggle makes *every* staked task done, fire the celebration toast and render the `mineWin` card at the top of the Personal feed with a "Post it to the circle" CTA (which flips to "Posted to the circle ✓"), and tick the streak bar forward.
- **Stake a task** — validates non-empty; assigns day (picked or today), category points, audience, pairs.
- **Unstake** — removes it, toast "Unstaked — off the line".
- **Toast** — single-slot, `bPop` in, auto-dismiss.
- **Routing between screens is the point.** Preserve every route: Circle→Plan (pre-fill + pair), Plan→Circle (friend profile), Plan→Me (best week), Week→Plan (points bar), Ledger→Plan (re-stake), Notifications→{sheet | person | Plan | ledger}, Me rank→Circle, past week row→that week's ledger.
- Keyboard: Enter submits composers; Escape closes the quick-log.

## State

```
tab              'week' | 'circle' | 'me'
scope            'personal' | 'friends' | 'global'
day              0–6 (Monday-indexed)
myTasks[]        { id, day, title, cat, pts, done, aud, pair[], pairKind, cmts[] }
acted{}          `${id}:${kind}` → true    // cheer, in, cosign, nod, back, share
replied{}        person key → true
note, draft, composerVal                    // input buffers
draftDay, draftCat, draftPair[], draftAud   // composer selection (draftAud null = use default)
planOpen, wrapOpen, wrapWeek, notifOpen, sheet, composerOpen
onboardStep, seenTooltip, toast
```

Backend requirements this implies: week-scoped task CRUD with audience + pairing, a cheer/reaction ledger keyed by actor, threaded notes per task and per person, a per-week rollup (points, completion, helped/helped-by), a circle with ranking, and a tiered notification service with batching.

## Configuration (already modeled as props)

| Prop | Type | Default | Effect |
|---|---|---|---|
| `showRank` | boolean | `true` | Off → hides podium rank badges, replaces list ranks with `·`, and changes the Circle subtitle to "checking in on each other" |
| `defaultAudience` | `friends` \| `everyone` | `friends` | Pre-selects the composer's SEEN BY |
| `quietComebacks` | boolean | `true` | Off → suppresses quiet comeback items from the feed |

## Known gaps — decide before building

These are **not implemented** in the prototype and need product decisions:

1. **Week rollover.** There is no rollover logic. The build needs one week-context object (number, date range, current day) — every week reference must derive from it.
2. **Real calendar math.** Dates are static strings. Week start day, timezone, and "week closes tonight" boundary all need defining.
3. **Two creation paths.** Quick-log (20 pts, no pair, today) and Stake (category pts, pair, any day) both produce tasks in the same list with no visual distinction. Either differentiate them in the list or collapse to one path.
4. **Task editing.** Tasks can be created and unstaked but not edited.
5. **True empty state.** No circle / no tasks / no history is undesigned beyond the feed's empty card.
6. **Notification read state.** Currently clears permanently on first open; needs real per-item read tracking.
7. **Fixture data is not spec.** People, tasks, week history, and the year grid are hardcoded.

## Accessibility requirements

- **44px minimum hit target.** The prototype gets engagement buttons and chips to 40px within a dense card grammar; the build should reach 44px, expanding padding rather than growing type.
- `:focus-visible` = `2px solid #C3F53C`, `outline-offset: 2px`. Never remove focus without replacement.
- `prefers-reduced-motion` disables all animation.
- Icon-only controls need labels (the FAB has `aria-label="Plan your week"`; apply the same to the bell, close buttons, and unstake ✕).
- Avatar initials are decorative — the accessible name is the person's full name.
- Color is never the only signal: done state carries a check glyph, rank carries a number, audience carries a word.

## Voice & copy rules

Plain, warm, second person, slightly blunt. Stakes language, not productivity language: *staked*, *on the line*, *in it with me*, *pick it back up*, *the week doesn't count itself*.

- **Never guilt-trip.** Debt framing ("you owe a word") appears **at most once per screen**.
- **Never show a bare zero.** Zero counts become the verb ("Cheer", "Note").
- Empty states say something human, not "No items."
- Use the exact copy in the prototype — it was written, not filled in.

## Assets

No image assets. All iconography is **inline SVG, 15–22px, `stroke-width: 2` (2.2–2.6 for close/check/plus), round caps and joins**, inheriting `currentColor`. Avatars are generated initials on tinted circles. One emoji is used deliberately: 🔥 for cheers and streaks (plus 🌐/🔒 in audience labels).

Fonts: Bricolage Grotesque and Instrument Sans, both Google Fonts (SIL Open Font License) — bundle them locally in the build.

## Files in this bundle

| File | What it is |
|---|---|
| `Rally B - Week Spine.dc.html` | **The design reference.** All 5 screens + 4 overlays + sheet. Read the template for structure/copy, the script block for data + interaction logic. |
| `ios-frame.jsx` | Device bezel used to present the design. Prototype chrome only — **not part of the app**. |
| `support.js` | Runtime needed to open the reference in a browser. **Do not port.** |

To view: serve the folder over HTTP and open the `.dc.html`.
