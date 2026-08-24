# The two pages App Store Connect asks for

> **Both pages are written and neither is published.** `privacy.html` and
> `support.html` in this folder are the content; hosting them, filling in the
> placeholders and pasting the URLs into App Store Connect are human steps and
> are listed below. Until those are done, the submission cannot be made — a
> privacy policy URL and a support URL are both required fields.

## Why they are HTML and why they live here

App Store Connect wants a URL, so the content has to be servable. These are
single self-contained files — one inline `<style>` block each, no assets, no
fonts, no scripts — which is the shape that any static host will serve with no
build step: GitHub Pages, a Netlify drop, an S3 bucket, a folder on a web
server. Markdown would have matched the rest of `docs/` more closely and cannot
be served without something to render it, which is a build step this repo does
not have and should not grow one for.

They sit in `docs/` with the other documentation rather than in a `public/` or
`web/` directory, because nothing in this repo builds a website and a top-level
folder that looked like a web root would imply one does. The prose is readable
in the repo as it stands.

The two files duplicate their eighty lines of CSS rather than sharing a
stylesheet. That is the cheaper option: a shared file is a second request and a
second thing to remember to deploy, on two pages that will rarely change.

## Placeholders

Every one of these is `{{UPPER_SNAKE}}` in double braces so a single
`grep -r '{{' docs/legal/` finds the lot. Do not guess at any of them.

| Placeholder | What it is | Notes |
|---|---|---|
| `{{LEGAL_ENTITY}}` | Who publishes the app — your name, or a company name | Must match the seller name on the App Store listing. GDPR calls this the data controller and wants it named. |
| `{{SUPPORT_EMAIL}}` | The address a user writes to | This is the **only** route to a person: the app contains no help screen, no contact row and no `mailto:` link anywhere. It must be an address somebody actually reads. |
| `{{PRIVACY_URL}}` | Where `privacy.html` ends up | Used on the support page and in App Store Connect. |
| `{{SUPPORT_URL}}` | Where `support.html` ends up | Used on the privacy page and in App Store Connect. |
| `{{JURISDICTION}}` | Governing law — a country, or a state and country | One line at the foot of the privacy policy. |
| `{{EFFECTIVE_DATE}}` | The date the policy takes effect | The day you publish it, not the day it was written. |
| `{{RESPONSE_TIME}}` | How long a reply takes | Appears four times across both pages and is a promise you have to keep. Apple's Guideline 1.2 expects reports of objectionable content to be acted on within **24 hours**; anything slower than that stated here is worth thinking about before you write it down. |

## The human steps, in order

1. **Fill the placeholders.** Seven of them, one pass, both files.
2. **Host the two files.** Any static host. They need no build, no framework and
   no server-side anything; two files in a bucket is enough. Confirm both load
   over HTTPS on a phone, in both light and dark mode, with no login and no
   cookie banner — Apple's reviewer will open them cold.
3. **Paste the URLs into App Store Connect.** Privacy Policy URL is under *App
   Information*; Support URL is under the version's *App Review Information*
   and also appears on the listing. They must resolve at review time and stay
   resolving afterwards.
4. **Answer the App Privacy questionnaire** in App Store Connect. It is a
   separate form from the policy URL and Apple compares the two. What the code
   supports is: **Name, Photos, Other User Content, User ID and Device ID
   collected and linked to identity; nothing used for tracking; no analytics,
   no advertising, no crash reporting.** The push token is the Device ID —
   declare it rather than arguing it is only a routing address.
5. **Deploy `delete-account` and set both of its secrets**, or accounts are
   marked for deletion and never actually deleted — silently, because the
   schedule is written to be quiet when Vault has nothing in it. The commands
   are in `supabase/functions/README.md`. This is the one step on this list
   whose omission looks exactly like success.
6. **Be ready to action a deletion email** from somebody who cannot reach the
   in-app control. See below.

## Running an account deletion by hand

**The in-app control exists now**, under Me → Settings → Delete my account, and
both pages describe it. Deletion is scheduled immediately, the account becomes
invisible to everyone else at once, and `delete-account` destroys it fourteen
days later.

This runbook is therefore the fallback rather than the route: it is for
somebody who cannot reach the control at all, because the app will not open or
because they deleted it from their phone before deleting the account. Both
pages offer the support address for exactly that case.

1. Identify the account. There is no email address on file to match against, so
   it is display name plus circle name or invite code. Confirm with the person
   before deleting anything.
2. **Set `deleted_at`, rather than deleting the row.** One statement in the SQL
   editor — `update public.profiles set deleted_at = now() where id = '…'` —
   and the account is invisible to everybody from that moment, exactly as if
   they had tapped the button. Do not delete the `auth.users` row by hand: the
   avatar object is not reached by any cascade, `avatars` has no collector, and
   the bucket is readable by any signed-in account that knows the name. The
   scheduled path removes it; a dashboard delete does not, and leaves nothing
   behind that knows to look.
3. If they should not wait a fortnight, backdate it — `now() - interval '15
   days'` — and either wait for 03:17 UTC or invoke `delete-account` yourself
   with the webhook secret. `supabase/functions/README.md` has the `curl`.
4. Reply to say it is done, and say which of the two it was: hidden now,
   destroyed on a date, or destroyed already.

What deletion does **not** reach, and what the privacy policy therefore says it
does not reach: `goal_ratings`, the permanent cache of goal text. It holds no
user id, so there is no way to find one person's rows in it. Anyone considering
changing that — adding a user id to make it deletable — should read the
migration's own comment first, since not having one is what stops the table
being a list of what every person on the service has typed.

## Things that would make these pages untrue

They are grounded in the code as it stands. Each of these changes would need a
matching edit here, in the same pass:

- **A new third party.** Today exactly two external hosts receive user data at
  runtime: `generativelanguage.googleapis.com` (goal text, image bytes) and
  `exp.host` (push token, cheerer's name, recipient's goal title). Adding
  analytics, crash reporting or an ad network would change the policy's
  strongest claims and the App Privacy answers together.
- **Moving the model off the free developer API.** The policy says we have not
  negotiated separate data-processing terms with Google and send no
  no-retention instruction. That is true of the code today. A paid tier or a
  move to Vertex AI would change it, and the paragraph should change with it.
- **Any new column holding user data**, particularly anything resembling an
  email address, a phone number, a location or a device identifier. The policy
  currently denies all four flatly.
- **The fourteen-day window changing.** It is stated on both pages, on the
  confirm screen in the app, and in `accounts_due_for_purge()` — and the last
  of those is the one that decides. They have to move together.
- **Renaming the app.** Both pages say *Rally* throughout, which is what
  `app.json` says (`expo.name`, bundle id `app.rally.weekspine`). If the App
  Store listing name differs, the two must be reconciled: a reviewer comparing
  the listing to the policy should not find two names.
