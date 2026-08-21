/**
 * Design tokens, read directly from the design reference.
 * Nothing in the app hardcodes a colour or a type size — it comes from here.
 */
import { Platform, TextStyle, useWindowDimensions, ViewStyle } from 'react-native';

/**
 * How far the OS text-size setting may inflate this app's type.
 *
 * Scaling is left on — turning it off is the wrong answer to a dense layout —
 * but this app draws a lot of fixed-height chrome: 44pt pills, a 46pt input,
 * the 54pt CTA. Past about a third larger, the label stops fitting the control
 * it names and starts being clipped by it, which is worse for the person who
 * turned the setting on than a slightly smaller label. Every face here shares
 * the cap so one number governs the whole scale.
 *
 * It lives here rather than beside the faces in `primitives.tsx` because
 * `displayLeading` below has to apply the identical cap, and that file already
 * imports from this one.
 */
export const MAX_FONT_SCALE = 1.35;

/**
 * The light palette. `ThemeProvider` serves it through context, and `darkColors`
 * below is the other answer that context can now give.
 *
 * This one is the shape: `Palette` is derived from its key set, so a token added
 * here fails to compile until the dark palette answers for it. Its values are
 * pinned exactly, by an inline snapshot in `theme/__tests__/theme.test.tsx` —
 * dark mode was five PRs of "nothing may look different", and light is still
 * byte-for-byte what it was before any of it started.
 */
export const lightColors = {
  /**
   * A surface, and only a surface: the dark card fill, the tab bar, a primary
   * button on light. The handoff has this token doing text as well, which the
   * light scheme lets it get away with because the two jobs happen to share a
   * value — but the dark card stays dark in both schemes while text on the
   * ground has to invert, so they are separate tokens now. `ink` is the half
   * that does not move in the dark palette; `textPrimary` is the half that does.
   */
  ink: '#191E16',
  lime: '#C3F53C',
  /**
   * The ground that flips: the app background and the sheets drawn on it. Not
   * "text on dark" — that is `onDark.primary`, and not the light fill of a pill
   * sitting on a dark screen, which is also `onDark.primary`. Anything that
   * followed `paper` for one of those two reasons would go dark-on-dark the
   * moment this value inverts.
   */
  paper: '#F1F2EC',
  /**
   * Primary text, icons and borders drawn on a surface that flips — the ground,
   * `card`, `chip`, `askTint`, `inputFill`, `limeTintChip`. Identical to `ink`
   * today and light in the dark palette. The question that sorts a read into
   * this token rather than `ink`: if the ground went dark, would this have to
   * change colour to stay visible?
   */
  textPrimary: '#191E16',
  muted: '#6E7663',
  moss: '#4B6A0B',
  card: '#FFFFFF',
  planBg: '#12170F',
  planCard: '#1B2116',
  tabbar: 'rgba(19,24,13,.94)',
  faintInk: '#A6AC9C',
  quoteInk: '#5A6350',
  divider: 'rgba(25,30,22,.12)',
  avatarText: '#3B4630',

  /** Surfaces that recur but aren't named tokens in the handoff. */
  chip: '#EAEDE2',
  askTint: '#F7FBE4',
  limeTintChip: '#EDF7D2',
  dash: '#C6CDB8',
  exchangeTrack: '#E3E8D8',
  /**
   * The quiet-comeback line. Was `#9AA28D` — about 2.4:1 on paper, which is
   * under the 4.5:1 floor for 13px body copy: the row meant to be gentle was
   * actually the one some people could not read. `muted` clears the floor,
   * and the de-emphasis was never the colour's job anyway — the row has no
   * card, no avatar and a smaller size, which is what makes it recede.
   */
  quietText: '#6E7663',

  /**
   * Onboarding. `onboardBg` is a shade above `planBg` — the first and last
   * screens sit slightly warmer than the Plan sheet so the flow reads as its
   * own place rather than as Plan with the chrome removed.
   */
  onboardBg: '#101408',
  /** Inset field inside an already-white card, where `card` would disappear. */
  inputFill: '#F7F8F3',
  /** A step already behind you, on light. `onDark.limeEdgeSoft` does it on dark. */
  dotDone: '#B9C2A8',
  /**
   * A control that is present but not yet earned — fill under `faintInk`, and
   * the unrun part of a `ProgressRing`. Those are the same idea drawn twice:
   * the shape of something that exists and has not happened yet.
   */
  disabledFill: 'rgba(25,30,22,.08)',

  // ── The last twelve, inline literals in seven files until 6d. Every one
  //    of them draws on a surface that flips, which is why none of them could
  //    stay where it was: a literal is a colour the palette cannot answer for.
  /** An unticked checkbox inside a `card`: inset, the way `inputFill` is. */
  checkboxFill: '#FAFBF7',
  /** The wash under a modal sheet. Sheet and app are both `paper` beneath it. */
  scrim: 'rgba(16,20,8,.42)',
  /** The drag handle at the top of a sheet. */
  sheetGrip: 'rgba(25,30,22,.18)',
  /** The edge of an outline control whose fill is `card` — a chip, a button. */
  outline: 'rgba(25,30,22,.14)',
  /** The note composer's own bar, floating over the sheet it is docked in. */
  composerBar: 'rgba(255,255,255,.96)',
  /** The hairline along its top edge — quieter than `divider`, on purpose. */
  composerEdge: 'rgba(25,30,22,.07)',
  /** A rule between rows *inside* one card, quieter still. */
  rowDivider: 'rgba(25,30,22,.06)',
  /** The lime edge on an unread "needs you" row, drawn on `askTint`. */
  needsEdge: 'rgba(195,245,60,.75)',
  /** The "waiting {n}" pill. Fill and text are one decision, not two. */
  waitingChip: '#F6E6C8',
  waitingText: '#8A6218',
  /** The "R" app-icon tile in the simulated push notification onboarding shows. */
  previewTile: '#E0E6D3',
  /**
   * The follow-through ring on the second and third podium places. Quieter
   * than `lime`, which is what makes first place read as first.
   */
  ringQuiet: '#C6DDA0',

  // ── And one that was never a literal, only the wrong token. ─────────────
  /**
   * The rounded tile behind a system notification's glyph, which carries
   * `onDark.primary` and so has to be dark in **both** schemes — a seventh
   * non-moving token, alongside the six the emphasis grammar rests on.
   *
   * It was spelled `avatarText` until 6d, and that was fine while `avatarText`
   * was `#3B4630`. It is a light colour in the dark palette, because the discs
   * under those initials went dark — which would have made this tile a bright
   * white square carrying a near-white icon. Same hex, its own name, and now
   * nothing can move it by accident.
   */
  systemTile: '#3B4630',
} as const;

/**
 * The dark palette.
 *
 * ## Why this is not an inversion
 *
 * Rally already uses dark as an *emphasis device*. The perfect-week cards, the
 * points bar, the profile card, the Plan sheet, the tab bar and four of the
 * seven onboarding steps are dark surfaces sitting on a paper ground, and
 * `onDark` is a whole second ramp for the text on them. Invert the palette and
 * the ink card — the thing people recognise — stops being dark, and the
 * design's signature goes with it.
 *
 * So the ground drops *below* ink, and everything that was already dark stays
 * exactly where it was. `ink`, `planBg`, `planCard`, `onboardBg` and `tabbar`
 * are byte-identical to the light palette on purpose, and a test holds them
 * there.
 *
 * ## What replaces "darkest means important"
 *
 * On paper an ink card is the most extreme thing on screen, and that is what
 * makes it read as emphasis. On a near-black ground that mechanism is gone —
 * the ground owns "darkest" now. So the ladder inverts: an ink card becomes
 * the most *elevated* surface rather than the deepest one.
 *
 *     paper #070A06  →  card #12170F  →  ink #191E16
 *
 * Ground, then an ordinary card, then the emphasis card on top. Same role,
 * opposite mechanism, and it agrees with the decision that elevation on dark
 * is carried by a lighter surface rather than a cast shadow — see `darkShadows`.
 *
 * The steps are small: about 1.07:1 between ink and card. That is not slack in
 * these values, it is the medium — there is no room for large ratios between
 * near-blacks. It is also why the ink cards need the hairline they never
 * needed on paper, which they already have: `GradientHairline variant="dark"`
 * is lime-based and survives the flip untouched.
 *
 * ## Two keys whose dark values were written down years ago
 *
 * `dotDone`'s own docblock in the light palette says "Lime at .45 does this on
 * dark", and `kit.tsx` has been drawing exactly that literal in its dark
 * branch. `disabledFill` is ink at 8%, and `kit.tsx` documents `onDark.fill`
 * as its dark-ground equivalent. Both are transcribed here rather than
 * invented.
 *
 * ## What could not be flipped, only replaced
 *
 * `moss` is a dark green — accent text, positive points, "you got". Lightening
 * it yields a muddy olive that fails against the ground, so it becomes the
 * mid-lime the year grid already uses for a good week. `inputFill` inverts
 * direction rather than lightness: an inset field inside a card is *darker*
 * than its card on dark, where on paper it was lighter.
 *
 * The twelve tokens 6d moved in from inline literals are the same story at
 * smaller scale, and four of them could not be flipped either — the scrim, the
 * "waiting" pill's cream-and-amber pair, the podium's second-place ring and the
 * lime edge on an unread row. Each says why beside its own value below.
 */
/**
 * The shape every scheme must supply: the exact key set of `lightColors`, with
 * the values widened to `string`.
 *
 * It has to be a mapped type rather than `typeof lightColors`. That object is
 * `as const`, so its type says `paper` is the literal `'#F1F2EC'` — a promise
 * only the light palette can keep, and one that made a second palette
 * impossible to declare. Widening the values keeps the half that matters: add
 * a key to `lightColors` and every other scheme fails to compile until it
 * answers for it.
 */
export type Palette = { readonly [K in keyof typeof lightColors]: string };

export const darkColors: Palette = {
  // ── Fixed. The ink-card system and the accent do not move. ──────────────
  ink: '#191E16',
  lime: '#C3F53C',
  planBg: '#12170F',
  planCard: '#1B2116',
  onboardBg: '#101408',
  tabbar: 'rgba(19,24,13,.94)',

  // ── The ground, and the surfaces that step up from it. ──────────────────
  paper: '#070A06',
  card: '#12170F',
  /** A pill on a card, so it answers to `card` rather than to the ground. */
  chip: '#1D231A',
  /** Inset in a card. Darker than its card here; lighter than it on paper. */
  inputFill: '#0C1009',
  exchangeTrack: '#1D231A',
  /** The lime-tinted pair. The tint direction inverts; the hue must not. */
  askTint: '#131A0C',
  limeTintChip: '#1B2610',

  // ── Text. Every pair below clears 4.5:1 against both `paper` and `card`. ─
  textPrimary: '#EEF0E8',
  muted: '#99A28B',
  quietText: '#99A28B',
  faintInk: '#848C79',
  quoteInk: '#B0B8A2',
  moss: '#A9D93C',
  /** Light initials, now that the discs beneath them are dark. */
  avatarText: '#EEF0E8',

  // ── Edges and fills, which change side: ink-alpha becomes paper-alpha. ──
  divider: 'rgba(241,242,236,.10)',
  dash: 'rgba(241,242,236,.22)',
  disabledFill: 'rgba(241,242,236,.06)',
  dotDone: 'rgba(195,245,60,.45)',
  sheetGrip: 'rgba(241,242,236,.22)',
  outline: 'rgba(241,242,236,.16)',
  composerEdge: 'rgba(241,242,236,.10)',
  /** Below `divider`, as on paper: a rule inside a card, not between cards. */
  rowDivider: 'rgba(241,242,236,.08)',
  /** Inset in a card, so it goes the same way `inputFill` does — down. */
  checkboxFill: '#0C1009',

  // ── The four that could not be flipped, only re-decided. ────────────────
  /**
   * Deeper, because it has more to do. On paper a 42% wash separates a light
   * sheet from a light app. On dark the sheet is `paper` over `paper` and the
   * only thing telling them apart is how much darker the ground behind has
   * gone, so the wash carries the whole separation rather than half of it.
   */
  scrim: 'rgba(4,6,2,.74)',
  /**
   * The composer bar is `card` at the same 96%, not white at 96% — it is a
   * raised bar over the sheet, and raised on dark means lighter.
   */
  composerBar: 'rgba(18,23,15,.96)',
  /**
   * Down from .75. On `askTint` a three-quarter lime edge is a soft outline;
   * on a near-black one it is the brightest thing on the screen, competing
   * with the lime CTA it is meant to point at. `.50` is `onDark.limeEdge` —
   * the edge on the thing that is current — which is exactly what this row is.
   */
  needsEdge: 'rgba(195,245,60,.50)',
  /**
   * The pair inverts together or not at all: a cream chip with amber text
   * becomes an amber chip with cream text. Flipping one alone leaves either
   * dark-on-dark or a cream slab brighter than anything around it. 8.1:1.
   */
  waitingChip: '#3A2E12',
  waitingText: '#E8C77A',
  /**
   * Index 0 of `darkPersonTints` by value, and a separate key by intent. This
   * is Rally's own mark in a fake iOS notification, not a person — but it does
   * share the constraint that decided that array, because it carries
   * `avatarText` on it and has to hold that text on a dark ground. Its own key
   * so that re-ordering `personTints`, which that array's docblock warns costs
   * nothing to do accidentally, cannot re-tint the app icon.
   */
  previewTile: '#2C3325',
  /**
   * Not a pale green. `#C6DDA0` was chosen to be *quieter* than `lime` on
   * paper; the same hue on a near-black ground is louder than `lime`, and
   * ranks two and three would out-shout first place. So it goes the other way:
   * this is `onDark.limeDeep`'s value — lime at roughly two-fifths of its
   * luminance — written out rather than referenced, because `onDark` is
   * declared below this object.
   */
  ringQuiet: '#6E9418',
  /** Unmoved, for the reason in its light docblock: it carries light content. */
  systemTile: '#3B4630',
};

/**
 * The static export, unchanged. The files still reading `color.*` directly get
 * the light palette whatever the device says — which was invisible while dark
 * resolved to light and is a bug from this PR onwards. Deleted in the last PR
 * of the sequence; until then, a `color.` in a component is a thing to migrate.
 */
export const color = lightColors;

/**
 * Everything drawn on a ground that is dark in both schemes.
 *
 * `planBg`, `planCard`, `onboardBg`, the tab bar and every `ink` card stay
 * near-black whichever palette is in force, so nothing in here has a light
 * counterpart and nothing in here comes through a hook. That is the whole
 * reason this is a plain module export sitting outside the palette: there is
 * no second value for a scheme to choose between.
 *
 * **Text is the handoff's, verbatim.** `.45` tertiary, `.55` secondary, `.62`
 * body-secondary, `1.0` primary, and never below `.45` — that floor was set to
 * pass contrast on small caps labels. `bodyStrong` at `.85` is the one rung
 * that is ours, filling the gap the handoff leaves between body copy and a
 * heading. Type belongs on one of those five and nowhere between them. The app
 * had drifted to `.58`, `.60`, `.70`, `.72` and `.75` as well — five invented
 * steps that made five labels look like five different intentions when all of
 * them mean the same thing, "quieter than what is beside me".
 *
 * **Surfaces are ours.** The handoff names two paper alphas in the whole
 * document and authors no border, fill, track or rule at all, so this ramp is
 * a decision rather than a transcription — and the decision it replaces was
 * fifteen alphas between `.035` and `.25`, most of them within a percentage
 * point of a neighbour and none of them meaning anything the one beside it did
 * not. Six do that work now: three edges at `.10 / .16 / .24`, each about half
 * again the last, and four fills at `.04 / .06 / .10 / .16`, plus `dot`.
 *
 * The two ladders share their middle rungs deliberately. At equal alpha a 1px
 * edge and a filled pill read as completely different weights, because weight
 * on dark is alpha times area; holding them to the same numbers is what keeps
 * a pill and the chip it sits inside from drifting apart the way `.08` and
 * `.12` had, when both were drawing the same audience pill in two files.
 *
 * `dot` is named rather than numbered because it is not a surface — it is the
 * 3px bullet between two runs of text in the points bar, and at 3px it needs
 * about twice the strongest fill just to be visible. Reading it as text and
 * snapping it to `.45` would be the opposite mistake: the contrast floor
 * governs glyphs, and this is punctuation drawn as a box.
 *
 * **Lime is ours too**, and had eleven alphas from `.08` to `.75` for what is
 * really five jobs: a wash over something already spent, the fill of a control
 * in its after state, and an edge on something at rest, something current, or
 * something selected right now.
 *
 * Every rung below is within two or three points of the values it replaced, so
 * this is a tightening rather than a re-colouring — but it is a visual change,
 * and the ordering is what was actually protected: wherever one thing was
 * heavier than another before, it still is.
 */
export const onDark = {
  /**
   * Written out rather than `color.paper`, which is what it used to be. The two
   * agree today and mean opposite things: `paper` is a ground that inverts,
   * this is the brightest ink you can put *on* a ground that never does. Left
   * as a reference it would follow `paper` down in the dark palette and quietly
   * become dark-on-dark. It has no consumers yet, which is the only reason that
   * was not already a bug.
   */
  primary: '#F1F2EC',
  /** Body copy that has to hold its own against `primary` beside it. */
  bodyStrong: 'rgba(241,242,236,.85)',
  bodySecondary: 'rgba(241,242,236,.62)',
  secondary: 'rgba(241,242,236,.55)',
  tertiary: 'rgba(241,242,236,.45)',

  /** An edge you feel rather than see: a rule, a divider, a chip at rest. */
  hairline: 'rgba(241,242,236,.10)',
  /** An edge that has to be seen: buttons, inputs, the empty-state dash. */
  hairlineStrong: 'rgba(241,242,236,.16)',
  /** The loudest edge on dark — an outline button, an unticked checkbox. */
  hairlineBold: 'rgba(241,242,236,.24)',

  /** An unselected chip, which must not compete with its selected sibling. */
  fillFaint: 'rgba(241,242,236,.04)',
  /** A control at rest: chip, icon button, list row, a disabled CTA. */
  fill: 'rgba(241,242,236,.06)',
  /** A fill that has to read on top of another fill — a small pill, a track. */
  fillStrong: 'rgba(241,242,236,.10)',
  /** A fill carrying an element on its own: a wide track, a pill on `ink`. */
  fillBold: 'rgba(241,242,236,.16)',
  /** The 3px bullet between two runs of text. Punctuation, not a surface. */
  dot: 'rgba(241,242,236,.30)',

  /** Lime already spent: a used suggestion, a row you have already picked. */
  limeWash: 'rgba(195,245,60,.10)',
  /** A lime control in its after state — posted, staked, chosen. */
  limeFill: 'rgba(195,245,60,.16)',
  /** A lime edge at rest: available to press, or done and behind you. */
  limeEdgeSoft: 'rgba(195,245,60,.40)',
  /** A lime edge on the thing that is current. */
  limeEdge: 'rgba(195,245,60,.50)',
  /** A lime edge on the thing selected right now. */
  limeEdgeStrong: 'rgba(195,245,60,.72)',
  /**
   * The dark end of the Plan hero's progress gradient, whose other stop is
   * `lime` itself. It is a real design value that never had a name: lime taken
   * down to roughly two-fifths of its luminance so a bar with one goal on it
   * still reads as a bar rather than as a lit sliver, while the full lime at
   * the far end is what a full week arrives at.
   */
  limeDeep: '#6E9418',
} as const;

/**
 * `onDark`'s mirror: everything drawn on a ground that is *light* in both
 * schemes.
 *
 * There are only two of those, and neither is the app background. `lime` is a
 * brand colour, not a surface that belongs to a scheme — a lime CTA is the same
 * green whichever palette is in force, so its label is the same near-black. The
 * other is the paper pill on the onboarding welcome screen, a light chip
 * deliberately sitting on a dark ground, whose own fill is `onDark.primary`.
 *
 * So this is a plain module export for the same reason `onDark` is: there is no
 * second value for a scheme to choose between. One rung is enough — nothing
 * light-on-light in this app is quieter than primary.
 *
 * The distinction that matters is against `textPrimary`, which looks identical
 * today. That one is text on a surface that flips and has to invert with it;
 * this one is text on a surface that stays put and must not.
 */
export const onLight = '#191E16';

/**
 * The same colour at zero alpha — the stop a scrim has to start from.
 *
 * `'transparent'` is not that colour. React Native resolves it to black at
 * zero alpha, so a gradient running from it to a coloured ground darkens
 * through the middle. A scrim therefore has to name its ground twice, once
 * solid and once invisible, and the Plan footer did the invisible half by
 * hand-copying `planBg`'s channels into an `rgba(…)` triplet: two literals
 * obliged to agree, one of which the palette could not reach. Nudge `planBg`
 * and the footer silently grows a coloured fringe. This derives the fade from
 * whatever the ground actually is, so there is only one value to change.
 */
export const fadeOut = (hex: string): string => {
  const h = hex.replace('#', '');
  const full = h.length < 6 ? h.slice(0, 3).replace(/./g, (c) => c + c) : h.slice(0, 6);
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0)`;
};

/**
 * Avatar tints — every circle any face is drawn on, in one array.
 *
 * A person no longer carries a hex; they carry an **index into this**, and
 * `Avatar` resolves it through `usePersonTints()`. That is what lets the dark
 * palette restyle every avatar in the app by editing this one array, which a
 * hex baked into `DEMO_PEOPLE` could never do.
 *
 * The array has two regions and they are not interchangeable:
 *
 * - **0–6, the palette proper.** These seven are what the demo circle was
 *   assigned against the design reference, in this order, and they are also
 *   the only slots an id nobody has a designed tint for can land on — see
 *   `HASHED_TINTS` in `data/people.ts`, which is the modulus and is seven
 *   rather than `personTints.length` on purpose. Every live circle member gets
 *   their colour this way, so widening the modulus would re-tint them all.
 * - **7–9, three hues nothing else in the app uses.** The Oz bots are
 *   deliberately not coloured like people you might know; lilac, pale blue and
 *   warm beige are outside the palette proper for that reason. Reachable by
 *   index only. (The Scarecrow is the exception that proves it — he sits on
 *   slot 2, the same warm sand Dre has.)
 *
 * Insertions therefore go at the end. Putting one in the middle silently
 * re-tints whoever was after it, which is a thing no type can catch — the
 * test in `theme/__tests__/personTints.test.ts` can, and does.
 */
export const personTints = [
  '#E0E6D3',
  '#D5E2BD',
  '#E9E0C2',
  '#E8CFBE',
  '#C9D9CE',
  '#EFE3AE',
  '#CBD6C4',
  '#D8C9E0',
  '#C9DCE0',
  '#E0D8C9',
] as const;

/**
 * The shape a scheme has to supply. Ten today, and a scheme is free to bring a
 * different number — with one floor: at least `HASHED_TINTS` of them, or the
 * hash indexes past the end and a stranger's avatar is a transparent disc.
 */
export type PersonTints = readonly string[];

/**
 * The same ten hues, taken down to sit on a dark ground.
 *
 * A pastel disc is a *quiet* mark on paper. Put it on near-black and it is the
 * brightest thing on screen — louder than the lime accent, which is supposed
 * to be the loudest thing in this app — and the dark initials on it become the
 * highest-contrast text anywhere. Circle draws seven of these at once.
 *
 * So the discs come down and the initials go up: `avatarText` flips with this
 * array, and neither can be decided without the other. Hue is what survives,
 * because hue is the whole job — it is how you tell one faceless person from
 * another at 20pt.
 *
 * Index for index with the light set. Slots 0-6 are what `hashTint` can reach;
 * 7-9 are the three Oz hues, two of which (lilac, pale blue) exist nowhere
 * else in this palette.
 */
export const darkPersonTints: PersonTints = [
  '#2C3325',
  '#2A3520',
  '#35301E',
  '#372A21',
  '#24302A',
  '#393016',
  '#272F23',
  '#2F2837',
  '#233135',
  '#312B21',
];



/** Year-grid cell levels: 0 nothing · 1 partial · 2 good · 3 perfect */
export const yearLevelColor: Record<number, string> = {
  0: '#EDF0E4',
  1: '#DCE3CE',
  2: '#A9D93C',
  3: '#C3F53C',
};

export type YearLevelColor = typeof yearLevelColor;

/**
 * The year grid on dark.
 *
 * Levels 2 and 3 hold: a saturated mid-lime and `lime` itself read on either
 * ground. Levels 0 and 1 cannot, and not because they are the wrong lightness
 * — because their *direction* is wrong. On paper an empty week is an off-white
 * a shade below the ground, so "nothing happened" reads as slightly recessed.
 * There is no room below a near-black ground to recess into, so on dark an
 * empty week becomes a faint raised slot instead: the cell you can see is
 * empty, rather than the cell you cannot see at all.
 *
 * Judge all four together — the ramp has to stay monotonic, and 0 and 1 are
 * four percent of lightness apart on paper, which cannot simply be mirrored.
 */
export const darkYearLevelColor: YearLevelColor = {
  0: '#12170F',
  1: '#2A3520',
  2: '#A9D93C',
  3: '#C3F53C',
};



export const font = {
  /** Display only: numbers, headings, names in stat positions, badge labels. */
  bri: {
    500: 'BricolageGrotesque_500Medium',
    600: 'BricolageGrotesque_600SemiBold',
    700: 'BricolageGrotesque_700Bold',
    800: 'BricolageGrotesque_800ExtraBold',
  },
  /** Everything else: body, labels, buttons, inputs. */
  sans: {
    400: 'InstrumentSans_400Regular',
    500: 'InstrumentSans_500Medium',
    600: 'InstrumentSans_600SemiBold',
    700: 'InstrumentSans_700Bold',
  },
} as const;

export const radius = {
  smallCard: 14,
  chip: 16,
  row: 18,
  largeCard: 26,
  sheet: 28,
  tabbar: 26,
} as const;

/** Screen gutter. Plan overlay uses its own 20px. */
export const gutter = 18;
export const planGutter = 20;

type Shadow = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'
>;

const shadow = (c: string, y: number, blur: number, opacity: number, elevation: number): Shadow => ({
  shadowColor: c,
  shadowOffset: { width: 0, height: y },
  shadowOpacity: opacity,
  shadowRadius: blur / 2,
  elevation,
});

/**
 * Every drop shadow in the app, and the last colour-carrying structure that
 * was still an import rather than a context read.
 *
 * Components take these from `useShadows()`, not from here. A shadow is a
 * colour at an opacity, and both halves have to move in the dark palette — a
 * near-black `card` shadow under a near-black card is invisible work, and the
 * lime blooms need a different opacity against a dark ground. Nothing about
 * that can happen through a module import fixed at load time.
 */
export const shadows = {
  card: shadow('rgb(25,30,22)', 1, 2, 0.05, 1),
  cardStrong: shadow('rgb(25,30,22)', 1, 2, 0.08, 2),
  tabbar: shadow('rgb(10,14,6)', 16, 34, 0.4, 18),
  fab: shadow('rgb(195,245,60)', 6, 18, 0.35, 8),
  tooltip: shadow('rgb(0,0,0)', 14, 34, 0.45, 20),
  toast: shadow('rgb(16,20,8)', 10, 30, 0.35, 14),
  needsRow: shadow('rgb(143,191,35)', 4, 14, 0.14, 3),
  addCta: shadow('rgb(195,245,60)', 8, 26, 0.22, 6),
  doneCta: shadow('rgb(195,245,60)', 10, 30, 0.2, 8),
} satisfies Record<string, Shadow>;

export type Shadows = typeof shadows;

/**
 * Elevation on dark is a lighter surface, not a darker shadow.
 *
 * Every ink-coloured shadow here is doing nothing on a near-black ground —
 * `shadows.card` is ink at five percent, which is invisible over `#070A06`,
 * and stacking black on black reads as smudge rather than lift. The card
 * grammar keeps its separation from `card` sitting above `paper` instead, and
 * the ink cards from the hairline they already carry.
 *
 * The four lime entries stay exactly as they are. They were never elevation —
 * they are the accent glowing, on surfaces (`ink`, `planBg`) that do not move
 * between schemes, and they get *better* as the ground drops. `tabbar`,
 * `tooltip` and `toast` also stay: each sits under a floating element that
 * overlaps whatever is behind it, where a dark shadow is still doing the
 * separating.
 */
export const darkShadows: Shadows = {
  ...shadows,
  card: shadow('rgb(25,30,22)', 1, 2, 0, 0),
  cardStrong: shadow('rgb(25,30,22)', 1, 2, 0, 0),
};



/**
 * The handoff asks for 44px hit targets while keeping the dense card grammar.
 * Padding grows, type does not.
 */
export const HIT_TARGET = 44;

/** Uppercase tracked section label. 10px floor, only at >= .45 alpha. */
export const capsLabel = (size = 11, tracking = 1.4): TextStyle => ({
  fontFamily: font.sans[700],
  fontSize: size,
  letterSpacing: tracking,
  textTransform: 'uppercase',
});

/**
 * The signature gradient hairline, expressed as expo-linear-gradient props.
 * CSS `linear-gradient(Adeg, …)` points A degrees clockwise from screen-up.
 */
export const gradientAngle = (deg: number) => {
  const rad = (deg * Math.PI) / 180;
  const dx = Math.sin(rad) / 2;
  const dy = -Math.cos(rad) / 2;
  return { start: { x: 0.5 - dx, y: 0.5 - dy }, end: { x: 0.5 + dx, y: 0.5 + dy } };
};

/** Read through `useTheme().hairlineGradient` — `GradientHairline` is the only consumer. */
export const hairlineGradient = {
  light: ['rgba(195,245,60,.45)', 'rgba(255,255,255,.75)', 'rgba(255,255,255,0)'],
  lightLocations: [0, 0.35, 0.7],
  dark: ['rgba(195,245,60,.55)', 'rgba(195,245,60,0)'],
  darkLocations: [0, 0.55],
  composer: ['rgba(195,245,60,.60)', 'rgba(195,245,60,.06)', 'rgba(241,242,236,.05)'],
  composerLocations: [0, 0.42, 0.8],
} as const;

/**
 * Widened for the same reason as `Palette`: `as const` types the light stops as
 * the literal strings they happen to be today, which no second scheme can
 * satisfy. Colours and locations stay separate rather than collapsing into
 * `(string | number)[]` — a stop list and an offset list are not the same
 * thing, and `LinearGradient` will not tell you if they are swapped.
 */
export type HairlineGradient = {
  readonly light: readonly string[];
  readonly lightLocations: readonly number[];
  readonly dark: readonly string[];
  readonly darkLocations: readonly number[];
  readonly composer: readonly string[];
  readonly composerLocations: readonly number[];
};

/**
 * Only `light` moves, and its name says why: these keys are about the *surface*
 * the hairline is drawn around, not about the scheme. `dark` rings an ink card
 * and `composer` rings `planCard`; neither surface changes, so neither gradient
 * does.
 *
 * `light` rings a white card, and its middle stop is white at 75% for exactly
 * that reason — it melts into the card edge. On a dark card that stop is a
 * bright smear along the top-left. Paper at a tenth does the same job here: a
 * lit edge that fades, rather than a white one that shines.
 */
export const darkHairlineGradient: HairlineGradient = {
  ...hairlineGradient,
  light: ['rgba(195,245,60,.40)', 'rgba(241,242,236,.10)', 'rgba(241,242,236,0)'],
};



/**
 * The bloom behind the Plan hero number. Android clips a text shadow to the
 * glyph box, which shows up as a lit rectangle, so the glow is iOS-only —
 * the lime on near-black already carries the emphasis without it.
 */
export const heroGlow: TextStyle = Platform.select({
  ios: { textShadowColor: 'rgba(195,245,60,.32)', textShadowRadius: 44 },
  default: {},
}) as TextStyle;

/**
 * The tight leading the display numbers are drawn with, without cropping them.
 *
 * The reference sets these line boxes *below* the font size on purpose — 48/41
 * on Me, 76/61 on Plan — because that is what makes a hero number sit tight to
 * its label. CSS can do that safely: a short line box decides only how much
 * room the line takes up, and the glyph is free to overflow it and still draw
 * whole. React Native has no such split. `lineHeight` sets the paragraph
 * style's minimum *and* maximum, the line is clamped to it, and the ascent is
 * what gets squeezed out — so the tops of the numerals are sliced off.
 *
 * That is true on both platforms, which this used to get wrong: it treated the
 * clipping as an Android quirk and left iOS asking for `lineHeight: tight`.
 * React Native's iOS text code is explicit that nothing rescues it — the
 * half-leading correction in `RCTAttributedTextUtils.mm` opens with
 * `if (maximumLineHeight < maximumFontLineHeight) return;`, so below the font's
 * natural line height (1.2em for Bricolage) the clamp is applied with no
 * compensating baseline offset at all. At 76/61 that cost the Plan hero 9.7pt
 * off the top of a 50.2pt digit: the zero rendered as a U.
 *
 * So the tightness cannot live in `lineHeight`. The line box goes back to the
 * font size — enough for a numeral, whose cap height is 0.66em, to clear the
 * 0.27em descent the clamp reserves below the baseline — and the optical
 * tightness is recovered with a negative margin, which pulls the next thing up
 * without touching the glyph's own box. Both platforms now compute the same
 * two numbers; `includeFontPadding: false`, which removes Android's own extra
 * leading so its box is exactly `lineHeight`, is the only part still per-
 * platform.
 *
 * Sized for digits and their separators. A caller wanting tall ascenders here
 * would need the line box raised towards 1.2em to match.
 *
 * The margin is scaled by hand because React Native will not do it. It scales
 * `lineHeight` with the OS text-size multiplier — literally
 * `lineHeight * RCTEffectiveFontSizeMultiplierFromTextAttributes(…)` — but
 * `marginBottom` is a layout property and is never touched, so a fixed margin
 * would hold 15pt back from a line box that had grown to 102.6pt and the ratio
 * the reference asked for would drift as the setting goes up. Multiplying the
 * difference restores it: the line occupies `tight * scale` at every size.
 *
 * The multiplier is clamped the way the text that uses it is clamped: `Bri`
 * caps its faces at `MAX_FONT_SCALE`, and past that point the glyphs stop
 * growing while an unclamped margin would keep pulling. Clamped below at 1 too,
 * so a missing or zero scale falls back to the designed numbers rather than
 * collapsing the margin to nothing.
 *
 * Takes the scale rather than reading it, so that it stays a pure function of
 * its arguments and the reading — which has to be a *subscription* — happens in
 * one place, `useDisplayLeading`. Prefer that; this is exported for the test.
 */
export const displayLeading = (fontSize: number, tight: number, fontScale: number): TextStyle => {
  const scale = Math.min(Math.max(fontScale || 1, 1), MAX_FONT_SCALE);
  return {
    lineHeight: fontSize,
    marginBottom: (tight - fontSize) * scale,
    ...Platform.select({ android: { includeFontPadding: false }, default: null }),
  };
};

/**
 * `displayLeading`, subscribed to the OS text-size setting.
 *
 * Reading the scale once during render is not enough. When the setting changes
 * — Control Center, or Settings and back — iOS posts a notification that
 * `RCTTextViewManager` acts on directly, so the *text* re-lays out at the new
 * multiplier with no JavaScript involved. The margin is ordinary style data and
 * only changes when React renders again, which nothing here would otherwise
 * ask for: the change reaches JS as a `Dimensions` event, and an event nobody
 * subscribes to re-renders nothing. The hero would keep a margin cut for the
 * old scale against a line box drawn at the new one until the screen happened
 * to be remounted.
 *
 * `useWindowDimensions` is that subscription, which is the whole reason this is
 * a hook and not a second argument the caller is trusted to remember.
 */
export const useDisplayLeading = (fontSize: number, tight: number): TextStyle =>
  displayLeading(fontSize, tight, useWindowDimensions().fontScale);
