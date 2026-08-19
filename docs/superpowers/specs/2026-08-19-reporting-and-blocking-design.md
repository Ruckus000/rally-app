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

## Blocking someone in your circle — DECIDED

**Blocking hides their content but does not remove them from the circle.** Circle
membership is mutual and deliberate, and leaving a circle is its own act with its own
consequences for rankings and history. Silently ejecting someone because of a one-tap
block would be a surprising amount of destruction from a small gesture.

The consequence, accepted: a blocked circle member still appears in the ranked list and
still counts toward circle totals. The alternative — vanishing them from the circle view
— makes the rollup maths per-viewer rather than per-circle, so your leaderboard would
silently disagree with everyone else's for the same circle.

**This obliges copy at the point of blocking.** If the block appears not to work because
the person is still on the podium, the feature has failed even though the code is
correct. The confirm must say that the circle is a separate thing and name how to leave
it.

## Blocking is symmetric — DECIDED

Not stated in the original draft, and the RLS predicate forces an answer.

**A block hides content in both directions.** They stop reaching you, and you stop
reaching them. One-way blocking leaves the blocked person able to keep cheering, noting
and pairing on someone who wants nothing to do with them, which defeats the point of the
control — the harm a block exists to stop is theirs to inflict, not yours to receive.

The cost, and it is real: a block is *implicitly* discoverable. Their cheers on your
tasks stop landing, and someone paying attention can infer it. The app still never says
so — see the `blocks` policy below — but this design does not pretend the inference is
impossible.

## Retroactive — DECIDED

**Every note of theirs disappears from your view, past and future.** One rule, and it is
what people expect a block to mean. Other people's view of the thread is untouched, so
the conversation stays intact for everyone else; you simply see a shorter version of it.

A tombstone was considered and rejected: a marker that keeps saying "someone you blocked
said something here" is the opposite of what the control is for.

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

All three previously-open questions are now decided above. What remains genuinely
unknown is not a design question but a product one: whether anyone will ever read the
`reports` queue. The table is built so that they can; nothing here promises that they
will, and the copy shown to the reporter must not either.
