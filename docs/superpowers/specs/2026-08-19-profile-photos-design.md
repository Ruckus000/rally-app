# Profile photos — design

Date: 2026-08-19
Status: approved in principle, not scheduled

Deferred out of the settings-page work (`2026-08-19-settings-page-design.md`).
Depends on the reporting work (`2026-08-19-reporting-and-blocking-design.md`) for
takedown; see **Order** below.

## What this changes about the design

`design-reference/HANDOFF.md:269` spends one line on assets and uses it to say: *"No
image assets. […] Avatars are generated initials on tinted circles."* Adding photos is a
departure from the design reference, not an implementation of it. Worth stating plainly
so nobody later reads the handoff and thinks the app drifted by accident.

The initials system does not go away — it stays as the fallback for everyone without a
photo, which on day one is everyone.

## Decision: visible everywhere, screened on upload

Photos show wherever a person shows, including the public feed. **This was chosen over
circle-only**, and the trade should be recorded rather than discovered later: it means
every uploaded image is effectively public, so the screener is not a nicety — it is the
only thing between an upload and a stranger's screen. The rest of this design is shaped
by that.

### Screening fails closed

`supabase/functions/_shared/verdict.mjs` establishes this repo's screening precedent for
goal text, and it deliberately fails **open**: a call that never arrived resolves `ok`,
because "a model having a bad day silently refusing to let anybody write anything down"
is the worse failure.

**Image screening must fail closed, and the asymmetry is the point.** An unscreened goal
is text its author typed and only their circle sees. An unscreened avatar, under this
decision, is a picture on the screens of people who have never met them. The cost of a
false refusal is "try again in a minute"; the cost of a false pass is the thing app
stores remove apps for.

Follow `verdict.mjs`'s structure — a shared `.mjs` so Deno and the unit suite read one
file — but invert the `unavailable` resolution, and comment that inversion at the point
it happens.

## Revised after reading `task_media` — read this before the rest

This spec was written before the `app-audit-ux-review` branch landed
`supabase/migrations/20260819180000_task_media.sql` (photos on goals). That work settles
the storage conventions this feature must follow rather than reinvent, and it **overturns
one decision here**.

What it establishes, and this spec now adopts:

- **A private bucket, read through signed URLs minted per read.** Its reasoning, quoted
  because it is right: a public bucket "would move visibility out of RLS and into *does
  anyone know the URL*". My earlier draft called for a public bucket with a stored path.
  That was wrong, and it is worse for avatars than it looks — see below.
- **Path shaped `<owner_id>/<…>/<media_id>.<ext>`**, with any uuid cast in a storage
  policy *guarded*, so a malformed object name answers `false` rather than raising 22P02
  inside a policy and turning one bad upload into an error on somebody else's read. The
  reporting work hit the identical trap with `payload ->> 'actor_id'`; that is twice now.
- **Client-minted ids**, so a replayed insert collides with itself instead of attaching
  the same file twice.
- **5 MB bucket ceiling, `image/jpeg | png | webp`**, with the client downscaling first.
- **No update policy** — replacing a photo is a delete plus an insert, which keeps the
  object and the row in step one operation each.

### Why the public-bucket reversal matters more for avatars

The product decision stands: profile photos are visible **everywhere a person appears,
including the public feed**. But "everywhere" means every signed-in user, not the open
internet — and a public bucket means the latter, permanently, to anyone who ever saw the
URL.

That is incompatible with the reporting work now on `main`. A report upheld against an
avatar has to actually take the image down. With a public bucket the URL keeps working,
CDN copies keep serving, and the takedown is cosmetic. With a private bucket the signed
URL expires and the next one is never minted.

So: same visibility decision, better mechanism.

### What `task_media` did NOT solve, and this spec still owns

**Screening.** There is none in that migration and no client code at all — no upload path,
no `expo-image-picker`, nothing. So the screening design below is still this spec's job.

And it should be built as a **shared** module rather than an avatar-only one: a photo
attached to a goal with `aud = 'everyone'` reaches exactly the same strangers an avatar
does. Whoever builds the `task_media` client half should call the same screener. Flagging
it here rather than silently building a second one.

### Sequencing

`task_media` is **not merged** as of this writing. Nothing here depends on it at the file
level — a different bucket, a different table, a different policy — so this can proceed in
parallel. Two places will conflict textually and should be merged by hand rather than
resolved blind: `docs/backend.md`, and `integration/support/reset.ts`.

## Architecture

### Storage, not a table

A Supabase Storage bucket, `avatars`, **private**, following `task-media`. Reads are
signed URLs minted per pull. The object path — never a URL — is what gets stored on the
profile row, because a stored URL is one that expires in the database.

### The sync layer stays row-shaped

`src/sync/transport.ts` is the only thing that talks to Supabase and speaks a `WireOp`
union of table rows. **Do not teach the outbox to carry binaries.** A queued image is a
multi-megabyte payload in AsyncStorage that has to survive relaunches and identity
changes, and the outbox was not built for it.

Instead: upload direct to Storage from the client, and only once it returns a path, queue
an ordinary `profile.update` carrying that path. The outbox keeps carrying rows. An
upload that fails is a UI-level retry, not a queue entry — which is honest, because an
upload is something the user is watching.

### Schema

`profiles` gains `avatar_path text` (nullable). RLS on it is whatever `profiles` already
does for `name`, which the reporting spec's takedown path must also be able to clear.

### Client

- `expo-image-picker` for selection. New dependency.
- **Resize and re-encode on device before upload** — cap the long edge (~1024px) and
  target a few hundred KB. A phone camera original is 3–12MB; uploading that is slow,
  expensive, and pointless for a 60px avatar.
- Strip EXIF. A photo's GPS coordinates should not travel with it, and this is a social
  app where the image is public.
- `src/components/Avatar.tsx` renders the image when a path exists and falls back to the
  existing initials otherwise. The accessible name stays the person's full name, per
  HANDOFF — the image is as decorative as the initials were.

## Failure and edge cases

- **Screening pending.** An upload that has been sent but not yet cleared shows the
  initials, not the image. Never show an unscreened image even to its owner, or the
  owner's screenshot becomes the distribution channel.
- **Screening refused.** One line in the app's own voice, `Trouble`-style, under the
  control that failed — the pattern `appleTrouble` already establishes. Do not explain
  what the model objected to; do not argue.
- **Offline.** The picker works, the upload does not. Say so and keep the file, or
  discard it and say so. Do not silently queue.
- **Takedown.** A report upheld against an avatar must be able to clear `avatar_path`
  server-side. This is why the reporting work should land first.

## Testing

- Unit: the verdict module's fail-closed inversion, exhaustively — this is the guard
  worth mutation-testing, and the mutation to try is "make `unavailable` resolve `ok`",
  which must fail a test.
- Unit: `Avatar` falls back to initials with no path, with a pending path, and with a
  refused upload.
- Integration: RLS on the bucket — a user cannot write to another user's path. This is a
  real "X cannot see/write Y" test and therefore belongs in `integration/`, not in the
  unit suite whose Supabase mock has no RLS at all.
- Not covered by any of the above: whether the screener is any good. That needs a corpus
  and a human, and the spec should not pretend otherwise.

## Order

Land **after** reporting. Photos without a takedown path is the one combination that
turns a bad upload into a support incident with no lever to pull.
