/**
 * Turn the one-time code from Apple's sheet into something revocable.
 *
 *   POST { code } -> { stored: boolean }
 *
 * The app already has an Apple **identity token** by the time this is called —
 * it is what `linkIdentity` was given, and it is a signed assertion about who
 * somebody is. It cannot be revoked, and Apple's account-deletion guidance asks
 * that tokens *be* revoked when an account goes. The revocable thing is a
 * refresh token, and the only route to one is to spend the `authorizationCode`
 * from the same sheet at `appleid.apple.com/auth/token`.
 *
 * That exchange needs a client secret signed with a `.p8` private key. A device
 * must never hold that key, which is the entire reason this function exists
 * rather than the app doing the exchange itself.
 *
 * ─── the subject is the caller, always ───────────────────────────────────
 *
 * Behind `verify_jwt`, like `rate-goal` and `screen-image`, and for
 * `screen-image`'s stronger version of the reason: this holds the service-role
 * key and writes a table no client role can reach at all. **There is no profile
 * id in the request body and there must not be one** — an argument here would
 * let any signed-in account file its own Apple credential against somebody
 * else's row, and a row in `apple_credentials` is what decides whose Apple
 * tokens get revoked.
 *
 * ─── failure is quiet on purpose ─────────────────────────────────────────
 *
 * By the time this runs, linking has already succeeded: the account is
 * recoverable, which is the thing the user actually asked for. A failure here
 * costs a revocation we would like to make in a fortnight and nothing the
 * person is waiting on — so `src/sync/session.ts` calls it best-effort and
 * ignores the answer, exactly as it does `unregister_device`.
 *
 * The one thing that is *not* quiet is a missing configuration. An unset key is
 * a deploy that will never revoke anything, and it should show up as an error
 * rate rather than as silence.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { clientSecret, exchangeAuthorizationCode } from '../_shared/appleSecret.mjs';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);

  const teamId = Deno.env.get('APPLE_TEAM_ID');
  const keyId = Deno.env.get('APPLE_KEY_ID');
  const privateKeyPem = Deno.env.get('APPLE_PRIVATE_KEY');
  const clientId = Deno.env.get('APPLE_CLIENT_ID');

  if (!teamId || !keyId || !privateKeyPem || !clientId) {
    console.error('APPLE_* secrets are not all set; no Apple token can be revoked later.');
    return json({ error: 'unconfigured' }, 500);
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Same read as `rate-goal` and `screen-image`, including the explicit token:
  // with no argument `getUser()` looks for a stored session an edge function
  // never has, and every request comes back unauthenticated whatever header it
  // carried.
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer /i, '');
  const { data: auth } = await db.auth.getUser(bearer);
  const userId = auth?.user?.id;
  if (!userId) return json({ error: 'not signed in' }, 401);

  let code: unknown;
  try {
    code = (await req.json())?.code;
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  if (typeof code !== 'string' || !code) return json({ error: 'no code' }, 400);

  let refresh: string | null;
  try {
    const secret = await clientSecret({ teamId, keyId, clientId, privateKeyPem });
    refresh = await exchangeAuthorizationCode({ code, clientId, secret });
  } catch (err) {
    // A malformed key throws here rather than answering. Worth a line, and
    // worth not carrying the message through to the client — it is about our
    // configuration, not about their request.
    console.error('apple token exchange failed:', err instanceof Error ? err.message : 'unknown');
    return json({ stored: false });
  }

  // Apple did not give one. Codes are single-use and short-lived, so the common
  // cause is a retry of a request that already worked — in which case the row
  // this would have written is already there.
  if (!refresh) return json({ stored: false });

  const { error } = await db
    .from('apple_credentials')
    // `profile_id` comes from the verified token and never from the body. The
    // upsert is what makes re-linking on a new phone replace the credential
    // rather than fail — the newest one is the one that can still be spent.
    .upsert(
      { profile_id: userId, refresh_token: refresh, client_id: clientId },
      { onConflict: 'profile_id' },
    );

  if (error) {
    console.error('apple_credentials upsert failed:', error.message);
    return json({ stored: false });
  }

  // No uuid and no token in this line. The whole point of the table is that
  // this credential lives in exactly one place.
  console.log('link-apple: stored a credential');
  return json({ stored: true });
});
