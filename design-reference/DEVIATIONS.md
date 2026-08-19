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

**Friends and Global are one feed** — `src/screens/WeekScreen.tsx`

The handoff's Week screen has three scopes: Personal, Friends, Global. The
build has two: Personal and Feed. Everything but the slice was already shared —
same shape, same card, same sort — so the split bought navigation and cost a
new account a wall of strangers with its own people behind a tab it had to
think to cross. The cards carry a FRIENDS/FOLLOW badge, which is the thing the
tab used to say.

---

## Density and chrome

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
