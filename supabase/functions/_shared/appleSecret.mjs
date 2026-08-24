/**
 * The client secret Apple's REST API wants, and the two calls that spend it.
 *
 * A `.mjs` for the same reason `verdict.mjs` and `rubric.mjs` are: it is the one
 * extension Deno and Node both import, so the edge functions and the unit suite
 * read the same file rather than two copies somebody has to keep in agreement.
 * That matters more here than anywhere else in `_shared`, because this is the
 * only module in the project that constructs a signature. A JWT that is subtly
 * wrong does not throw — Apple answers `invalid_client` and the revocation
 * silently never happens, which is exactly the failure this whole phase exists
 * to prevent.
 *
 * ─── what Apple actually asks for ─────────────────────────────────────────
 *
 * `client_secret` is not a secret in the usual sense. It is a short-lived JWT
 * you mint yourself, signed **ES256** with a `.p8` private key downloaded from
 * the developer portal, and every one of these five things has to be right:
 *
 *   header.alg  ES256, and nothing else is accepted
 *   header.kid  the Key ID of that `.p8`
 *   iss         the Team ID
 *   sub         the `client_id` — and the two must be equal
 *   aud         `https://appleid.apple.com`
 *
 * `sub` equalling `client_id` is the one people get wrong, and Apple's own
 * developer forums are mostly threads about it. For a native iOS sign-in the
 * `client_id` is the **bundle identifier** — `app.rally.weekspine` — not a
 * Services ID, because the bundle id is what the authorisation was issued
 * against. `apple_credentials.client_id` stores it per row rather than deriving
 * it, so a rename cannot strand rows minted under the old one.
 *
 * ─── the expiry ──────────────────────────────────────────────────────────
 *
 * Apple permits up to six months. This mints five minutes, because the secret
 * is built per call and immediately spent: a six-month token would sit in
 * whatever logged the request that carried it. There is no cache and there
 * should not be one — signing costs a millisecond and the alternative is a
 * bearer credential with a lifetime.
 */

const APPLE = 'https://appleid.apple.com';

/** Apple's cap is six months; this is nowhere near it, on purpose. */
export const SECRET_TTL_SECONDS = 300;

const b64url = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const b64urlJson = (value) => b64url(new TextEncoder().encode(JSON.stringify(value)));

/**
 * A `.p8` is PEM: base64 DER between two banner lines.
 *
 * Newlines are stripped rather than required, because this arrives through
 * `supabase secrets set` and an environment variable is a single line — whether
 * the `\n`s survived depends on how it was pasted, and a key that works from a
 * file and fails from a shell is a bad afternoon.
 */
export function pemToPkcs8(pem) {
  const body = String(pem)
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  if (!body) throw new Error('apple: private key is empty');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Mint one.
 *
 * `now` is injectable so the expiry can be asserted rather than approximated;
 * nothing in production passes it.
 */
export async function clientSecret({ teamId, keyId, clientId, privateKeyPem, now = Date.now() }) {
  if (!teamId || !keyId || !clientId || !privateKeyPem) {
    throw new Error('apple: missing team id, key id, client id or private key');
  }

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(privateKeyPem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const issued = Math.floor(now / 1000);
  const header = { alg: 'ES256', kid: keyId };
  const claims = {
    iss: teamId,
    iat: issued,
    exp: issued + SECRET_TTL_SECONDS,
    aud: APPLE,
    // Not a copy-paste of `iss`. See the header: this is the one Apple rejects.
    sub: clientId,
  };

  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  // WebCrypto returns ECDSA signatures as the raw r‖s pair, which is precisely
  // what JWS ES256 specifies — no DER unwrapping, unlike most other libraries.
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

/**
 * Spend the one-time code from the sign-in sheet for a refresh token.
 *
 * Returns null rather than throwing on every failure, and the caller treats
 * that as "no credential to store". Linking an Apple identity has already
 * succeeded by the time this runs — the account is recoverable, which is what
 * the user asked for — so a failure here costs a revocation we would like to
 * make in a fortnight, not anything the person is waiting on.
 *
 * No `redirect_uri`. A native authorisation has none, and sending an empty one
 * is itself an `invalid_request`.
 */
export async function exchangeAuthorizationCode({ code, clientId, secret, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: secret,
    code,
    grant_type: 'authorization_code',
  });

  const res = await fetchImpl(`${APPLE}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const refresh = json?.refresh_token;
  return typeof refresh === 'string' && refresh ? refresh : null;
}

/**
 * Tell Apple the app is done with this person.
 *
 * Answers `true` only on a 2xx. Apple returns an **empty body** on success, so
 * there is nothing to parse and nothing to check beyond the status — a function
 * that tried to read JSON here would fail on every successful call.
 */
export async function revokeRefreshToken({ token, clientId, secret, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: secret,
    token,
    token_type_hint: 'refresh_token',
  });

  const res = await fetchImpl(`${APPLE}/auth/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  return res.ok;
}
