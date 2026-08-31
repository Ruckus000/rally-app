# The two pages App Store Connect asks for

> **Both pages are filled in and live.** They are served from this folder as a
> Vercel static project, and the two URLs App Store Connect requires are:
>
> - Privacy Policy URL — <https://rally-app-legal.vercel.app/privacy>
> - Support URL — <https://rally-app-legal.vercel.app/support>
>
> Pasting those two into App Store Connect is still a human step, as are the
> App Privacy questionnaire and the two edge-function deploys. They are listed
> below, and steps 1 and 2 are marked done rather than deleted so that the
> order still reads.

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

Every one of these was `{{UPPER_SNAKE}}` in double braces so a single
`grep -r '{{' docs/legal/` found the lot. **They are now filled**, with the
values below; that grep should come back empty for `privacy.html` and
`support.html`, and finding a brace in either again means a page was edited
from an unfilled copy.

| Placeholder | Filled with |
|---|---|
| `{{LEGAL_ENTITY}}` | Jean Luc Philistin |
| `{{SUPPORT_EMAIL}}` | lordruckus.nb@gmail.com |
| `{{PRIVACY_URL}}` | https://rally-app-legal.vercel.app/privacy |
| `{{SUPPORT_URL}}` | https://rally-app-legal.vercel.app/support |
| `{{JURISDICTION}}` | the State of Florida, United States |
| `{{EFFECTIVE_DATE}}` | 30 August 2026 |
| `{{RESPONSE_TIME}}` | 24 hours |

The entity name has to keep matching the App Store seller name, and the
response time is a promise both pages make five times over. What each one is
for, and why it matters, is below.

| Placeholder | What it is | Notes |
|---|---|---|
| `{{LEGAL_ENTITY}}` | Who publishes the app — your name, or a company name | Must match the seller name on the App Store listing. GDPR calls this the data controller and wants it named. |
| `{{SUPPORT_EMAIL}}` | The address a user writes to | This is the **only** route to a person: the app contains no help screen, no contact row and no `mailto:` link anywhere. It must be an address somebody actually reads. |
| `{{PRIVACY_URL}}` | Where `privacy.html` ends up | Used on the support page and in App Store Connect. |
| `{{SUPPORT_URL}}` | Where `support.html` ends up | Used on the privacy page and in App Store Connect. |
| `{{JURISDICTION}}` | Governing law — a country, or a state and country | One line at the foot of the privacy policy. |
| `{{EFFECTIVE_DATE}}` | The date the policy takes effect | The day you publish it, not the day it was written. |
| `{{RESPONSE_TIME}}` | How long a reply takes | Appears four times across both pages and is a promise you have to keep. Apple's Guideline 1.2 expects reports of objectionable content to be acted on within **24 hours**; anything slower than that stated here is worth thinking about before you write it down. |

## Where they are hosted

This folder *is* the site. It is linked to a Vercel project called
`rally-app-legal`, deployed straight from here with no build step, which is the
arrangement the two files were written for: a static host serving HTML it does
not have to process. Redeploying after an edit is one command from this
directory:

```
vercel deploy --prod
```

Three small files make that work, and nothing else in the repository is
touched by it:

- `vercel.json` — `cleanUrls`, so the published URLs are `/privacy` and
  `/support` rather than `.html`, and a redirect from `/` to `/support` so the
  bare domain is a useful page instead of a 404.
- `.vercelignore` — keeps `README.md` out of the deploy. Every file in this
  folder becomes a URL, and this one is instructions for us, not a page.
- `.gitignore` — written by `vercel link`, keeping the project link and the
  CLI's OIDC token file out of the repository.

The project is named `rally-app-legal` rather than `rally-legal` because
`rally-legal.vercel.app` is already taken by an unrelated site. A custom domain
can be added later without breaking anything, but the two URLs would change,
and both pages hardcode each other's — so that is a re-fill of `{{PRIVACY_URL}}`
and `{{SUPPORT_URL}}`, a redeploy, and an edit in App Store Connect, in that
order.

## The human steps, in order

1. ~~**Fill the placeholders.**~~ **Done.** Seven of them, one pass, both
   files. The values are in the table above.
2. ~~**Host the two files.**~~ **Done.** They are on Vercel — see *Where they
   are hosted* above. Both were checked over HTTPS at phone width in light and
   dark mode, with no login and no cookie banner, which is how Apple's reviewer
   will open them.
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
6. **Set the four `APPLE_*` secrets and deploy `link-apple`**, if the App Store
   listing offers Sign in with Apple — Apple asks that an account's tokens be
   revoked when it is deleted, and without these nothing is ever stored to
   revoke. Unlike step 5 this one is a *should* rather than a must, and
   `delete-account` skips it quietly when the secrets are absent, which is the
   right behaviour for a project that never configured Apple at all.
7. **Be ready to action a deletion email** from somebody who cannot reach the
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
- **Storing anything else from Apple.** The policy now says exactly one token is
  kept and names its single purpose. Requesting a scope, or keeping an access
  token alongside the refresh one, would make that paragraph untrue.
- **The fourteen-day window changing.** It is stated on both pages, on the
  confirm screen in the app, and in `accounts_due_for_purge()` — and the last
  of those is the one that decides. They have to move together.
- **Renaming the app.** Both pages say *Rally* throughout, which is what
  `app.json` says (`expo.name`, bundle id `app.rally.weekspine`). If the App
  Store listing name differs, the two must be reconciled: a reviewer comparing
  the listing to the policy should not find two names.
