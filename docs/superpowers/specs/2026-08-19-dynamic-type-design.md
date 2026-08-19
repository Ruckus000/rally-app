# Text size / Dynamic Type — design

Date: 2026-08-19
Status: approved in principle, not scheduled

Deferred out of the settings-page work (`2026-08-19-settings-page-design.md`).

## Correct the premise first

An earlier note in that spec said the app "ignores the OS setting outright, because
`allowFontScaling` appears nowhere in `src/`". That reasoning was backwards.

React Native's `<Text>` defaults `allowFontScaling` to **true**. Nothing in this repo
overrides it — there is no `Text.defaultProps`, no `maxFontSizeMultiplier`, no
`allowFontScaling={false}` anywhere. So **text already scales with the OS setting
today**, against 17 hardcoded pixel heights that were never designed for it.

That is worse than ignoring the setting. Ignoring it would render small and consistent.
What actually happens is that type grows inside containers that do not, so at large
accessibility sizes the app clips — silently, today, in production, untested.

This work is therefore not "add Dynamic Type support". It is **make the support that is
already switched on survive contact with the layout**.

## Decision: full support, including the accessibility sizes

Half-support produces clipped text, which is worse than either extreme. The people who
set the largest sizes are the ones who need them.

## What the design constrains

`design-reference/HANDOFF.md` is authoritative and sets, deliberately:

- Exact px sizes per role, from 9.5px tracked caps to the 76px Plan hero.
- **"Minimum readable size is 10px and only for uppercase tracked labels at ≥`.45`
  alpha. Do not shrink further."** — a floor, and scaling only ever moves up from it, so
  it is not in tension with this work.
- 44px minimum hit targets, "expanding padding rather than growing type".

The last one is the useful principle to generalise: **containers grow, type does what
the OS says.**

## The work

1. **17 fixed `height:` values become `minHeight:`** across `src/components/`,
   `src/shell/` and `src/screens/`. There are already 46 `minHeight` usages, so this is
   the established idiom rather than a new one.
2. **Rows become able to wrap.** Anything currently relying on a single line of a known
   size — feed card titles, the Circle ranked-list metric, audience chips — needs a
   per-component decision: wrap, or truncate with `numberOfLines`. Truncating a person's
   name is acceptable; truncating the metric that explains a ranking is not.
3. **The display numbers get a `maxFontSizeMultiplier`.** The 48px all-time points and
   the 76px staked hero are already enormous; scaled 3× they are not information, they
   are a wall. Cap them (~1.3–1.5) while leaving body text uncapped. This is the one
   place the design's typography wins over the OS setting, and it should be commented as
   the deliberate exception it is.
4. **Tracked caps labels need proportional tracking.** `capsLabel()` in `tokens.ts` takes
   a fixed `letterSpacing` in px. At 3× scale a fixed 1.4px tracking effectively
   disappears. Tracking should be expressed as a ratio of the font size.
5. **The tab bar and the header** are the two fixed-height chrome elements where growth
   costs the most screen. They likely want a cap of their own plus truncation, decided
   together rather than per-label.

## What is explicitly not in scope

**No in-app text-size slider.** The OS already owns this control, on both platforms, and
a second one that disagrees with it is a bug generator — two sources of truth for the
same number. Settings may link out to the system control, the way the notifications row
already does, but must not duplicate it.

## Testing, and its honest limit

- `PixelRatio.getFontScale()` can be mocked, so component tests can assert the
  *decisions*: that a capped element passes `maxFontSizeMultiplier`, that a row exposes
  `minHeight` rather than `height`, that a truncating label carries `numberOfLines`.
- A lint rule against `height:` on any container holding a `Text` would hold the line
  better than tests, and should be considered part of the work.
- **No automated test in this stack can tell you text is clipped.** `@testing-library/react-native`
  does not lay out; there is no measurement to assert against. Screenshot testing on a
  device matrix would, and this repo has no such harness.

So the verification is a **device checklist**, and it belongs in `TESTING.md`: each of
the five screens and four overlays, at default, at XXL, and at the largest accessibility
size, on both platforms. Anyone claiming this is done without having run that has not
verified it — say so in the PR rather than reporting the unit suite as proof.

## Sequencing

This should land **after** dark mode, not before. Dark mode's mechanism migration
touches every call site in `src/theme/tokens.ts`'s consumers, and doing two sweeping
mechanical migrations over the same 30 files at once makes both harder to review.
