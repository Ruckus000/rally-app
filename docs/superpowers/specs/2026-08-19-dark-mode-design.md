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

**Take option 2.** Note the migration is the bulk of the effort, and it is
mechanical rather than difficult — which makes it a good candidate for splitting across
several PRs, one per screen, with the light palette unchanged throughout so nothing
visibly moves until the last one.

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
