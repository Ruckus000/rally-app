# Reporting and blocking — design

Date: 2026-08-19
Status: approved in principle, not scheduled

Deferred out of the settings-page work (`2026-08-19-settings-page-design.md`).
Should land **before** profile photos (`2026-08-19-profile-photos-design.md`), which
needs the takedown path this creates.

## Why this exists

Rally carries user-generated content that other people see: staked task titles, notes
threads on tasks and on people, and a public feed. There is currently no way to report
any of it and no way to stop seeing a particular person. Both Apple and Google require
a reporting and blocking mechanism for apps with UGC, so this is a shipping
prerequisite, not a nicety.

There is also no moderation team. The design has to be honest about that rather than
implying a reviewer who does not exist.

## Decision: hide immediately, queue for review, offer to block

Three things happen when someone reports:

1. **The content disappears for the reporter, at once.** Not "we'll look into it" — gone
   from their feed on the next render. This is the only part the reporter can verify, and
   it is the part that matters to them.
2. **A report row is filed** in a table only the service role can read.
3. **They are offered the block**, as a separate, clearly-labelled step. Reporting a post
   and never wanting to see that person again are different intentions and should not be
   collapsed.

Nothing claims a human will review it. The copy says what actually happened: it is hidden
from you, and it has been filed.

## Schema

### `reports`

Follows `device_tokens`' pattern exactly: **no policies and no grant to
`authenticated`.** A table of reports is a list of who accused whom; the cheapest time
not to have a readable one is before it exists. Clients write through a
`security definer` RPC that stamps `reporter_id` from `auth.uid()` and returns nothing.

Columns: `id`, `reporter_id`, `subject_kind` (`task` | `note` | `profile` | `avatar`),
`subject_id`, `reason` (a small enum, not free text — see below), `created_at`,
plus `resolution` and `resolved_at` for whoever eventually looks.

**A bounded reason enum rather than free text.** Free text is a field where people type
their own name, someone else's phone number, or a slur. An enum is enough to triage and
carries no PII.

### `blocks`

`blocker_id`, `blocked_id`, `created_at`, primary key on the pair. Unlike `reports`, the
owner can read and delete their own rows — you must be able to see and undo who you have
blocked. Nobody can read rows where they are the *blocked* party; being blocked is not
something the app should announce.

## Filtering, which is the part that is easy to get wrong

Blocking must hide content **server-side as well as client-side**. Client-only filtering
means the rows still arrive, so anyone reading the traffic still receives them — and the
sync engine would keep them in local state, where a later refactor could surface them.

The feed pulls in `src/sync/transport.ts` need to exclude blocked authors, and the
cleanest place is a view or an RLS predicate rather than a `not in (…)` list assembled on
the client. Note this interacts with the existing rollup and notification paths: a cheer
from someone you blocked should not ring.

**Local filtering is still required as well**, because a block taken offline has to work
immediately — the reporter's relief cannot wait for a round trip.

## Blocking someone in your circle

The genuinely awkward case, and it needs an explicit answer rather than a default.

**Recommendation: blocking hides their content but does not remove them from the
circle.** Circle membership is a mutual, deliberate thing and leaving a circle is its own
act with its own consequences for rankings and history. Silently ejecting someone because
of a one-tap block would be a surprising amount of destruction from a small gesture.

The consequence to accept: a blocked circle member still appears in the ranked list and
still counts toward circle totals, which may feel wrong to the person who blocked them.
The alternative — vanishing them entirely — means the leaderboard silently disagrees with
everyone else's, which is worse.

**Flag this one for a decision before implementation.** It is a product call and both
answers are defensible.

## Entry points

- Feed card and task detail sheet → report this task.
- Person sheet → report this person, block this person.
- Note in a thread → report this note.
- Avatar (once photos ship) → report this photo.

All of them behind a single unobtrusive control rather than a visible button on every
card. HANDOFF's engagement row is already at its density limit and this must not become
a fourth icon next to 🔥 and 💬.

## Copy

The app's voice is warm and blunt, and this is the one flow where warmth reads as
insincere. Be plain instead. Say what happened — hidden, filed — and do not thank them
for making the community better.

Empty state for a blocked list, per HANDOFF's rule that empty states say something
human: it should acknowledge that having blocked nobody is the normal case, without
congratulating them for it.

## Testing

- **Integration, not unit.** Every meaningful assertion here is "X cannot see Y", and
  `src/__mocks__/@supabase/supabase-js.ts` has no RLS — a test named that way in the unit
  suite passes for the wrong reason. This is exactly the case `CLAUDE.md` warns about.
  Specifically: a reporter cannot read `reports`; a blocked user cannot tell they are
  blocked; a blocker no longer receives the blocked party's rows.
- Unit: the local filter, the offline path, and that a report queued offline is not lost.
- Mutation-test the filter predicate. A block that silently stops filtering is invisible
  until someone sees content they blocked, and by then the damage is the thing they
  blocked seeing.

## Open

- The circle-membership question above.
- Whether a blocked person's existing notes in *your* threads disappear retroactively or
  stay. Retroactive is cleaner to reason about; leaving them avoids holes in a
  conversation others can still see.
