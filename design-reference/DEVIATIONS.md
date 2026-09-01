# Deviations from the handoff

`HANDOFF.md` is authoritative, and it says so: colours, type, spacing and copy
are final and intentional. This file is the short list of places the build
knowingly does something else, and why — each one decided rather than drifted
into.

It exists because an audit cannot tell a decision from a mistake by reading the
code. Everything here was flagged by one, looked at, and kept on purpose; a
deviation that is not written down here is a bug, not a choice.

Each entry also carries a comment at the site, pointing back here.

---

## Copy

**Points bar reports progress, not a count** — `src/screens/WeekScreen.tsx`

The handoff reads `{pts} pts · {n} this week`; the build reads
`{pts} pts · {done} of {total} done`. How many you staked is already the length
of the list directly beneath the bar. How many you have closed is not stated
anywhere else on the screen, and it is the thing the bar is looked at for.

**Notification tiers are named for who a row is about** —
`src/data/fixtures.ts`

The handoff names them *Needs you / Worth a look / Batched*; the build uses
*Needs you / Your week / Your circle*. Batching is not a category, it is
something that happens to cheers: `batchCheers` groups them wherever they land,
inside whichever tier they belong to. A tier named after it would put a
rendering detail alongside two real subjects.

---

## Interaction

**The invite sheet shares rather than copies** — `src/overlays/DetailSheet.tsx`

The handoff asks for a copyable link. `Share` is core React Native — no native
module, no rebuild — and it reaches the clipboard *and* Messages, WhatsApp and
mail in one tap. Sending someone a code is the actual task; a pasteboard only
ever half-does it.

**Per-tab scroll position is kept** — `src/App.tsx`

The handoff specifies one shared scroll container that resets to the top on tab
change. Each tab now keeps its own position and its own container, because the
shared one also meant every tab switch unmounted and remounted a whole screen —
the cost of which was visible on device.

**Overlays and tabs animate in and out** — `src/overlays/Overlay.tsx`,
`src/App.tsx`

The prototype's overlays appear and vanish in a single frame; the handoff's
motion table has no entry for them. `<Presence>` fades them, and tab panes
cross-fade. Reduced motion is respected, as everywhere else.

**SEEN BY's first slot names a circle** — `src/overlays/PlanOverlay.tsx`

The handoff's audience control is three chips: Friends, Everyone, Private. The
ladder is unchanged and still reads narrow to wide; only its narrow end
acquired a proper noun. "Friends" stopped naming anything once somebody could
be in two rooms — it meant "people you share a circle with" on a goal that
belongs to one specific room out of several — so the chip reads the circle's
name, and tapping it when it is already selected opens a picker. When it is not
selected the tap selects it, like the other two, which is what keeps a
one-circle account from ever opening anything: at one circle there is nothing
to disambiguate and the control behaves exactly as drawn.

A separate "stake in" control was the alternative and was rejected: two
controls can express "staked in Gym, seen by Private", which is a sentence with
a dead clause, since a private goal is gated on pairing and reaches no room at
all.

The pills also moved off the section rule onto their own line beneath it —
`SectionRule` lays label, hairline and children out in one row, and a circle
called "Wednesday Morning Riders" wants more width than that line has to give.
It is the same arrangement "In it with me" already uses two sections down.

**Friends and Global are one feed** — `src/screens/WeekScreen.tsx`

The handoff's Week screen has three scopes: Personal, Friends, Global. The
build has two: Personal and Feed. Everything but the slice was already shared —
same shape, same card, same sort — so the split bought navigation and cost a
new account a wall of strangers with its own people behind a tab it had to
think to cross. The cards carry a FRIENDS/FOLLOW badge, which is the thing the
tab used to say.

---

## Density and chrome

**A circle switcher appears from the second circle** — `src/components/CircleSwitcher.tsx`

HANDOFF §2 draws the Circle screen as podium, caps label, ranked list, total,
invite. There is no slot above the podium, because the prototype has one circle
and never had to say which. The build has a horizontally scrolling row of chips
there — but only from the second circle: at one, the component returns nothing
and the screen is §2 exactly as drawn. What the row buys is the thing being
alone in a room used to cost. The "A circle of one" state was an early return,
so somebody in three circles standing in an empty one saw it with no way out;
it is a body branch under the switcher now, and the other rooms stay reachable.

Not the Header's scope segment, which was the obvious existing home. That
control gives each tab `flex: 1`, and five circles is five 78px columns holding
names people chose for themselves.

**The invite sheet names the circle** — `src/overlays/DetailSheet.tsx`

The handoff reads "Grow the circle", and the share message "Join my circle on
Rally". Both now name it — "Grow The Basement", "Join The Basement on Rally
with the code …". This removes a choice rather than adding one: with several
rooms, a sheet that says "the circle" asks the reader to work out which one
they are about to hand a code to, and the person receiving it cannot work it
out at all. The demo modes keep the generic wording, because `fresh` has no
circle to name and would otherwise borrow the seeded world's.

**Cards are one step larger than the reference** — `src/components/FeedCards.tsx`

Every padding, radius and size matched the 402×874 reference exactly. The
reference is dense, and read as cramped on a real device, so padding, the
checkbox, the inter-card gap and the two title sizes each moved one step up the
handoff's own spacing rhythm — together, so the composition scales rather than
one card growing inside it.

**The header bell has no white chip** — `src/shell/Header.tsx`

The handoff specifies a 42px circular white bell button. The build draws the
bell at 48pt directly on the paper, with no disc and no shadow. Owner-directed;
ink on paper is about 14:1, so only the chrome went.

**The Me tab's header says "Me"** — `src/shell/Header.tsx`

The handoff gives every screen a title and a subtitle. The Me header renders
the screen's name rather than the person's, because the profile card directly
below already carries the name at 22px. (Rendering nothing at all — which is
what it did before — left the bell floating over a band of empty chrome.)

---

## Identity

The mark is specified in `Rally - Logo Spec.dc.html`, not in `HANDOFF.md`, which
says nothing about brand identity. That document is authoritative on the same
terms, and these are the two places the build knowingly departs from it.

**The app icon keeps the lime plate** — `scripts/make-icons.mjs`

The spec's app-icon row asks for the mark bone-and-lime on an ink tile at 58% of
tile width. The build keeps the ink mark on the lime plate the app has always
had. Owner-directed: the green tile is what people already pick out of a home
screen, and an identity change is not a reason to make the app harder to find.
The 58% sizing is kept.

**And so it is drawn in one colour** — `scripts/make-icons.mjs`

Which follows from the plate rather than being a second decision. The spec's
two-tone core is olive `#4B6A0B` and it only ever puts that on bone or white; on
lime it is about 1.9:1. At 120px it is a smudge and at 60px — the size a home
screen actually renders — it is gone, so the mark arrives at a one-colour huddle
by accident. The spec has a cut for being one colour on purpose, with the core
grown to r15 so the shape fuses, and it is stronger at every size an icon is
judged at. Two-tone is kept on the splash art, where the ground is bone or ink
and the colorway works as drawn.

**The launch screen shows the mark alone** — `src/screens/BootScreen.tsx`

The spec sends variant B, the stacked lockup, to "app splash", and variant C,
the mark alone, to "loading states". This screen is both, and it resolves as C:
the lockup contains real text, and the launch screen is on the glass precisely
while the fonts are still loading. Drawing the wordmark there would mean
outlining it into paths for the one surface that cannot wait for a font.

**The core is there first, and the wedges arrive onto it** —
`src/screens/BootScreen.tsx`, `scripts/make-icons.mjs`

The spec's loading-state row reads "wedges may fade in one at a time, 72° apart,
then the core lands". The build does it the other way round, and not by
preference. A native splash is a static PNG, so whatever it shows is the state
the React screen must start in. Show the finished mark there and the arrival is
unwatchable — it plays behind the splash and is over before the splash lifts.
Filmed, the mark was already complete in the first visible frame, and had been
for the mark this replaced. Start it on reveal instead and the mark visibly
disassembles and rebuilds, which is the specific flaw `BootScreen` exists to
prevent.

Putting the core on the splash is what buys an arrival anyone can see, and it
says the truer thing anyway: the point is already there, and people arrive at
it. The cost is that on a slow cold start the splash is a lone dot for a beat
longer than it would otherwise be.
