# Dark mode — design

Date: 2026-08-19
Status: approved in principle, not scheduled

Deferred out of the settings-page work (`2026-08-19-settings-page-design.md`), which
established the surface a theme control would live on.

## The problem this design has to solve first

Rally is not a light-themed app that needs a dark variant. It is an app that already
uses dark **as an emphasis device**: the Me profile card, the perfect-week cards, the
points bar, the tab bar, the Plan overlay and the whole onboarding flow are dark
surfaces sitting on a paper ground. `src/theme/tokens.ts` has an entire second ramp,
`onDark`, for text on those surfaces.

So "dark mode" cannot mean "invert the palette". Invert it and the ink card — the thing
people recognise — stops being dark, and the design's signature goes with it.

## Decision: keep the palette, drop the ground

The ground moves below ink; everything that was already dark stays exactly as it is.

| Token | Light | Dark |
|---|---|---|
| `paper` (app background, sheets) | `#F1F2EC` | a near-black below `ink`, ~`#0B0E09` |
| `ink` (dark cards, tab bar fill) | `#191E16` | **unchanged** |
| `lime` (the single accent) | `#C3F53C` | **unchanged** |
| `card` (white surface on light) | `#FFFFFF` | a surface above the new ground, ~`#161B13` |
| `planBg` / `planCard` / `onboardBg` | as now | **unchanged** |

Emphasis still reads, because an ink card still sits above the ground — just by less.
That "by less" is the one real cost, and it is why the ink surfaces need a hairline in
dark mode that they do not need on paper. Without it, an ink card on a near-black ground
is a card with no edges.

What must be re-derived, because it only exists for light: `muted`, `faintInk`,
`quoteInk`, `divider`, `chip`, `askTint`, `limeTintChip`, `dash`, `exchangeTrack`,
`quietText`, `inputFill`, `dotDone`, `disabledFill`, `avatarText`, the `yearLevelColor`
levels, and `personTints`.

**`personTints` is the one to think about, not batch.** The seven avatar tints are
pastels chosen to carry dark initials (`avatarText: #3B4630`). On a near-black ground
they will glare, and dark initials on a pastel disc is now the highest-contrast thing on
the screen — louder than the lime accent, which is meant to be the loudest. They need
either a darkened set with light initials, or the same set at reduced opacity with the
initials re-derived. This is a design decision, not a token swap.

The `onDark` alpha ramp already exists and already passes contrast at its `.45` floor.
Most text on the new ground can use it directly, which is what makes this the cheap
option.

## The mechanism, which is the actual work

`src/theme/tokens.ts` exports `color` as a plain frozen const. **30 files import it and
there are 441 `color.*` reads.** Nothing is themeable today.

Three ways to make it so:

1. **A mutable module object swapped at launch.** Zero call-site edits. Rejected: module
   scope captures values. `SettingsOverlay`'s `cardBox`, `LedgerOverlay`'s `closeButton`
   and every other module-level style object would freeze whichever theme happened to be
   active at import, and the bug would appear only on a live toggle — the worst kind.
2. **A `useColors()` hook backed by context.** Every call site becomes a hook read.
   ~441 mechanical edits, and module-level style objects must become functions of the
   palette. Correct, and the edits are the kind a codemod plus a careful review handles.
3. **Two StyleSheet registries selected at the root.** Works, but this codebase writes
   inline style objects almost everywhere and has no stylesheet layer to hang it on.
   It would mean inventing one.

**Take option 2**, and ship it as **several PRs, one area at a time** — decided
2026-08-19.

The migration is the bulk of the effort and it is mechanical rather than difficult, which
is exactly the shape that goes wrong as one sweep: a 470-line diff across 31 files where
every hunk looks the same is a diff nobody can review, and a single wrong token hides in
it perfectly.

**The light palette stays byte-identical until the last PR.** Every intermediate PR is
therefore verifiable by a rule anyone can apply: *nothing may look different*. That is a
much stronger review property than "these token swaps look right to me".

Measured on `main` at 2026-08-19, after the photos work:

| | |
|---|---|
| Files importing `tokens` | 31 |
| `color.*` reads | 472 |
| `onDark.*` reads | 62 |

Concentrated: `DetailSheet` 55, `PlanOverlay` 52, `MeScreen` 48, `FeedCards` 44,
`onboard/kit` 40, and a long tail under 21.

Sequence:

1. **The mechanism** — `ThemeProvider`, `useColors()`, and the smallest leaf files
   migrated as proof. `color` keeps its current export so unmigrated files compile
   untouched; the two coexist for the whole migration.
2. **Shell and screens** — `Header`, `TabBar`, `WeekScreen`, `CircleScreen`, `MeScreen`.
3. **Overlays** — `DetailSheet`, `PlanOverlay`, `LedgerOverlay`, `NotificationsOverlay`,
   `SettingsOverlay`, `ReportSheet`, `RolloverOverlay`.
4. **Onboarding** — `kit` and its six screens.
5. **Components** — `FeedCards`, `Avatar`, the rest of the tail.
6. **The dark palette and the control** — the only PR where anything looks different, and
   the one that needs a device pass in both schemes.

The static `color` export is deleted in PR 6, or kept as the light palette if tests want
it. A lint rule forbidding raw hex outside `tokens.ts` should land in PR 1, or the 472
starts growing again while the migration is still in flight.

### Not only `color`

Three other exports in `tokens.ts` carry colour and must eventually move with it:
`yearLevelColor` (4 levels), `personTints` (7, and the one that needs real design
thought — see above), and `hairlineGradient`. PR 1 should shape the provider so these can
join without a second migration, but need not move them.

A lint rule forbidding raw hex outside `tokens.ts` should land in the same work, or the
441 will start growing again.

## Control

Follow the system by default via `useColorScheme()`, with an override in Settings —
Match system / Light / Dark. Settings now exists precisely because of the previous piece
of work, and this is the row it was designed to accept.

The override is persisted, which means a new key in `PERSISTED_KEYS`
(`src/state/persistence.ts`) and therefore a `VERSION` bump — persistence discards
rather than migrates on mismatch, so an existing install loses its state on the upgrade.
That is a real cost and should be weighed against defaulting to system-only in v1 and
adding the override later.

## Testing

- Token resolution per scheme, asserted directly: every key present in both palettes,
  no key resolving to `undefined`.
- A contrast assertion over the pairs that matter — text ramps against their grounds —
  so the `.45` floor is enforced by a test rather than by memory.
- `prefers-reduced-motion` is already honoured; nothing here changes it.
- Snapshot tests are the wrong tool. They would pass on a palette that is uniformly
  wrong.
- **Automated tests cannot tell you it looks right.** A device pass in both schemes is
  required before this ships, and `TESTING.md` should say so.

## Open

- The `personTints` question above.
- Whether the gradient hairline and glow bloom — both tuned against paper — hold on the
  new ground, or need their own dark values.

---

# Addendum — 2026-08-20, after PRs 1–5

The five mechanism PRs are merged. Every source file reads the palette from context;
the only remaining importer of the static `color` is one test that holds it on purpose
as the light-palette reference.

What was "PR 6: the dark palette and the control" turns out to be four things. A full
literal audit — every one of the 87 lint-flagged colours traced to the surface it is
actually drawn on — is what forced the split.

## The finding that reshaped the plan

**Of 87 flagged literals, 55 sit on surfaces that are dark in both schemes and need no
dark value at all.** The books close as 91 warnings = 4 in test fixtures + 87 in source,
and 87 = 55 always-dark + 28 that flip + 4 Google brand hexes. `PlanOverlay` holds 34 of them and every one is on `planBg` or
`planCard`; the file with the most colour in it needs none of it changed. Only 28
literals actually flip.

That means the work separates cleanly into "things that must be named" and "things that
must be decided", and only the second is a design change.

## Three things the audit found that were not on any list

1. **`shadows` is invisible to the linter.** Nine module-level constants built from
   `rgb(25,30,22)`, `rgb(10,14,6)` and `rgb(0,0,0)`, used 18 times across 12 components.
   The colour-literal rule exempts `src/theme/` by design, so nothing flags them. An ink
   shadow at 5% opacity does nothing on a dark ground — every card in the app silently
   loses its elevation, with no warning and no failing test. **Decided:** elevation on
   dark becomes a raised surface rather than a cast shadow, and `shadows` joins the
   `Theme` object so its dark set can go to near-zero.

2. **`ink` and `paper` each do two jobs that dark forces apart.** `ink` is primary text
   *and* the ink-card fill; `paper` is the app ground *and* `onDark.primary`, the text on
   those cards. In light both readings coincide, which is why one token has served. In
   dark they move in opposite directions. **Decided:** split into explicit surface and
   text keys. 92 `color.ink` reads and 48 `color.paper` reads have to be classified, and
   the classification is a judgement per site — the two meanings are distinguishable only
   by reading the surrounding JSX, so this cannot be a codemod.

3. **`personTints` is two palettes, not one.** The seven in `tokens.ts` are byte-identical
   to the seven demo-circle tints in `data/people.ts`, in the same order — a straight
   duplication. But `data/people.ts` carries four more for the Oz bots, and two of those
   are hues (`#D8C9E0` lilac, `#C9DCE0` pale blue) that `personTints` does not contain at
   all. Ten distinct values across two sets. A hue-agnostic luminance transform covers
   both; a hand-tuned per-swatch pass would have to be done twice. `#E0E6D3` appears a
   third time, inlined, at `kit.tsx:311`.

## Decisions taken

- **`personTints`:** darken the discs and lighten the initials. `avatarText` moves with
  them, as one decision — the tints and the text on them cannot be settled separately.
- **The control:** follow the system by default, with a System / Light / Dark override in
  Settings.
- **`ink`/`paper`:** split into surface and text tokens.
- **Elevation:** raised surfaces on dark; shadows recede.

## The remaining sequence

PRs 1–5 were all reviewable by one rule: nothing may look different. **6a is the first
step where that stops being true**, and it is worth being exact about why, because the
rule is otherwise doing a lot of work.

6b still changes nothing on screen. 6a changes a little, on purpose.

**6a — name the always-dark literals.** Extend the `onDark` ramp and fold in the 55
literals that sit on always-dark surfaces.

The reason this cannot be a pure rename is `HANDOFF.md` line 52. It authors the on-dark
alpha ramp **for text only** — `.45` tertiary, `.55` secondary, `.62` body-secondary,
`1.0` primary — and names just two paper-alpha values in the entire document. So the
literals divide by whether anyone ever designed them:

- **Text rungs are authored, and the app is off them.** Labels are drawn at `.58`, `.60`,
  `.70`, `.72` and `.75`, all invented steps between the authored `.62` and `1.0`.
  Snapping each to the nearest real rung is not a design change; it is removing a
  deviation. Six sites, one of which moves *up*.
- **Surface rungs are not authored at all.** Borders, fills and tracks span fifteen values
  from `.035` to `.25` — incidental, not designed. `PlanOverlay` gives four chip families
  four different border alphas for the same visual job. Consolidating them into a small
  set of named steps is straightforwardly correct.

So roughly forty values move, most by one or two points of alpha. **The invariant is
ordering, not identity:** wherever one thing read heavier than another, it still must.
That is the property to check, and it is checkable on a device in a way that "is this
`.07` or `.06`" is not.

Clears 55 of 87 warnings, so the palette PR's diff contains only lines that alter
appearance. The remaining 32 are the 28 that flip plus the four Google brand hexes, which
`eslint.config.js` already rules are a lockup rather than theme values and wants
suppressed at the call site.

**6b — split `ink` and `paper`.** 140 reads, each classified as surface or text. Both new
keys hold the identical value in the light palette, so this too is verifiable by nothing
looking different. Doing it *before* the palette is the point: otherwise 6c performs 140
judgements and a design change at once, which is the mixture that produces silent
wrongness.

**6c — the dark palette.** The 28 flips, the palette keys, the tints, `yearLevelColor`,
`hairlineGradient.light`, `shadows`, and the two `StatusBar` sites. The only PR where
anything is meant to look different, and the one needing a device pass in both schemes.

**6d — the Settings override.** The control and its persistence. Kept separate because
"does dark mode look right" is a design review and "does the override survive a relaunch"
is a state review, and they want different scrutiny.

## Two mechanical notes for 6c

- **`hairlineGradient`'s `light`/`dark` keys mean *surface*, not scheme** — which card the
  hairline is drawn around. Only `light` needs a dark-scheme variant; `dark` and
  `composer` sit on `ink` and `planCard`, which do not move. Its sole consumer is
  `GradientHairline` in `primitives.tsx`, which imports the gradient statically; moving it
  onto the `Theme` object changes that one file and no call site. This is exactly what
  the ThemeProvider docblock's "extra fields on that object" argument was for.
- **Three module-level data structures carry colour outside React** and so cannot use a
  hook: `hashTint`, the `tint:` fields baked into `DEMO_PEOPLE` and `OZ_PEOPLE`, and
  `NOTIF_TIERS.accent` in `fixtures.ts`. For the tiers the cleanest fix is to drop
  `accent` from the data entirely and put a key→colour lookup in the overlay, where the
  hook is available. `NOTIF_TIERS` is also imported by `persistence.ts` and `mappers.ts`,
  but both read only `.key`.

## Test blast radius for 6c

Two files, and both are legitimate to edit — this is the one PR where the tests are
supposed to change, because they currently assert that dark *is* light.

`theme/__tests__/theme.test.tsx`: one test dies outright (`resolves dark to the light
palette, because there is no dark one yet`) and should be inverted into an assertion that
the palettes genuinely differ, share a key set, and agree on the keys that must not
move — `lime`, `planBg`, `planCard`, `onboardBg`, `tabbar`. That last part is the test
that protects the invariant this whole design rests on.

`components/__tests__/themedLeaves.test.tsx` runs every case three times over
`[undefined, 'light', 'dark']` and asserts against `color.*` in all three. The fix is
structural rather than per-assertion: parameterise the expected palette alongside the
wrapping, so the claim becomes "the token the *active* scheme defines" instead of "the
same token whatever the scheme". That converts five dying assertions into five that
actually test the mechanism.

Two tests survive only because `lime` is scheme-invariant and should say so, or they
become a confusing failure the day someone tries a dark-scheme lime.
