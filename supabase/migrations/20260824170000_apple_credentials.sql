-- ─── The one Apple credential worth keeping ───────────────────────────────
--
-- Apple's account-deletion guidance asks apps that support Sign in with Apple
-- to revoke the user's tokens when the account goes, through
-- `appleid.apple.com/auth/revoke`. That endpoint wants a token, and the app has
-- never held one: `signInAsync` returns an **identity token**, which is a
-- signed assertion about who somebody is and is not revocable, and the app
-- hands that straight to gotrue. The revocable thing is a *refresh* token, and
-- the only way to one is to spend the `authorizationCode` from the same sheet
-- at `appleid.apple.com/auth/token` — which needs a client secret this device
-- must never hold.
--
-- So: the phone sends the code to `link-apple`, that function does the
-- exchange, and what comes back is stored here. Nothing else reads this table.
--
-- ─── who can see it ───────────────────────────────────────────────────────
--
-- RLS on, and **no policy at all**, which is the whole access rule. That denies
-- every authenticated and anonymous request by default and leaves the table
-- reachable only by the service-role client the two edge functions hold. It is
-- the posture `goal_ratings` and `llm_usage` already use and it is easy to
-- misread as an oversight later, so, plainly: a refresh token is a bearer
-- credential for somebody's relationship with our app, and no client has any
-- reason to hold one — not even the client it belongs to.
--
-- Deliberately not a column on `profiles`. That table is readable by everyone
-- who shares a circle with you, and a secret one `grant` away from being
-- readable by your friends is a secret waiting for a mistake.

create table public.apple_credentials (
  -- Cascades, so the row goes with the account whichever way the account goes:
  -- the scheduled purge, the manual runbook, or a future one nobody has written
  -- yet. A token outliving the account it belonged to is the exact thing this
  -- table exists to prevent.
  profile_id    uuid primary key references public.profiles (id) on delete cascade,

  -- Apple's refresh token. Long-lived, opaque, and single-purpose here: the
  -- only call this project ever makes with it is a revocation.
  refresh_token text not null,

  -- The `client_id` the code was authorised against, kept rather than derived.
  -- Apple refuses a revocation whose `client_id` differs from the one used at
  -- authorisation, so if this app is ever renamed, or a Services ID is ever
  -- introduced alongside the bundle id, a row minted under the old one must
  -- still be revocable with the old one. Recomputing it at deletion time would
  -- silently stop working for every account older than the change.
  client_id     text not null,

  created_at    timestamptz not null default now()
);

comment on table public.apple_credentials is
  'Apple refresh tokens, held solely to revoke them when an account is deleted. '
  'Written by the link-apple function, read by delete-account, and reachable by '
  'no client role at all.';

comment on column public.apple_credentials.client_id is
  'The client_id the authorisation used. Apple rejects a revocation that does '
  'not match it, so it is stored rather than recomputed.';

alter table public.apple_credentials enable row level security;

-- Both halves, and the second is not optional. `goal_ratings` and `llm_usage`
-- state the same pair for the same reason: `20260815225639_device_tokens.sql`
-- revoked the default privileges that would otherwise hand `anon` and
-- `authenticated` a TRUNCATE on every new table in `public`, and that revoke
-- reaches `service_role` too. Without the grant the two edge functions cannot
-- read or write this at all — which fails exactly the way this feature fails
-- everywhere else: silently, with `link-apple` logging an upsert error nobody
-- reads and no Apple token ever stored to revoke.
revoke all on table public.apple_credentials from anon, authenticated;
grant  all on table public.apple_credentials to service_role;
