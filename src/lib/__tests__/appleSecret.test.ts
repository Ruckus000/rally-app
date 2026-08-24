/**
 * The one signature this project constructs.
 *
 * `supabase/functions/_shared/appleSecret.mjs` runs in Deno, in an edge function
 * `npm run typecheck` does not cover and no integration test can reach. It is
 * also the piece with the least forgiving failure mode in the whole deletion
 * feature: a JWT that is subtly wrong does not throw anywhere. Apple answers
 * `invalid_client`, `link-apple` stores nothing, and fourteen days later an
 * account is deleted without its Apple tokens ever being revoked — silently, and
 * with nothing anywhere saying so.
 *
 * So the signature is *verified* here rather than merely shaped. A real P-256
 * key pair is generated, the secret is minted with the private half and checked
 * with the public half, which is the only assertion that could catch a wrong
 * curve, a DER-wrapped signature, or a mangled signing input.
 *
 * `.mjs` is what makes this possible: Deno and Node both import it, so the file
 * under test is the file that ships. Node 20's `globalThis.crypto.subtle` is the
 * same WebCrypto the edge runtime has, including the detail the module leans on
 * — ECDSA signatures come back as the raw r‖s pair, which is what JWS wants,
 * where most libraries would hand back DER.
 */
import {
  SECRET_TTL_SECONDS,
  clientSecret,
  exchangeAuthorizationCode,
  pemToPkcs8,
  revokeRefreshToken,
} from '../../../supabase/functions/_shared/appleSecret.mjs';

const TEAM = 'ABCDE12345';
const KEY_ID = 'KEY1234567';
/** The bundle id. A native authorisation is issued against the App ID. */
const CLIENT_ID = 'app.rally.weekspine';
/** A fixed instant, so the expiry is asserted rather than approximated. */
const NOW = 1_756_000_000_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64urlDecode = (part: string): string =>
  dec.decode(
    Uint8Array.from(
      atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')),
      (c) => c.charCodeAt(0),
    ),
  );

const partsOf = (jwt: string) => {
  const [h, c, s] = jwt.split('.');
  return {
    header: JSON.parse(b64urlDecode(h)) as Record<string, unknown>,
    claims: JSON.parse(b64urlDecode(c)) as Record<string, unknown>,
    signature: s,
    signingInput: `${h}.${c}`,
  };
};

/** A real key pair, so the signature can actually be checked. */
async function keyPair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const base64 = btoa(String.fromCharCode(...pkcs8));
  const pem = `-----BEGIN PRIVATE KEY-----\n${
    base64.match(/.{1,64}/g)?.join('\n') ?? base64
  }\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: pair.publicKey };
}

describe('clientSecret', () => {
  it('is signed by the key it was given', async () => {
    // The assertion the rest of this file exists to support. Everything else
    // checks a field; this checks that Apple would accept the thing at all.
    const { pem, publicKey } = await keyPair();

    const jwt = await clientSecret({
      teamId: TEAM,
      keyId: KEY_ID,
      clientId: CLIENT_ID,
      privateKeyPem: pem,
      now: NOW,
    });

    const { signature, signingInput } = partsOf(jwt);
    const raw = Uint8Array.from(
      atob(signature.replace(/-/g, '+').replace(/_/g, '/').padEnd(88, '=')),
      (c) => c.charCodeAt(0),
    );

    // 64 bytes: r and s, 32 each. A DER-wrapped signature is ~70 and variable,
    // and is what a library that "helpfully" encodes for you would produce.
    expect(raw.length).toBe(64);

    const good = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      raw,
      enc.encode(signingInput),
    );
    expect(good).toBe(true);
  });

  it('names ES256 and the key id in the header', async () => {
    const { pem } = await keyPair();
    const { header } = partsOf(
      await clientSecret({
        teamId: TEAM,
        keyId: KEY_ID,
        clientId: CLIENT_ID,
        privateKeyPem: pem,
        now: NOW,
      }),
    );

    expect(header).toEqual({ alg: 'ES256', kid: KEY_ID });
  });

  it('puts the client id in sub and the team id in iss, which are not the same field', async () => {
    // The mistake Apple's own forums are mostly threads about. `sub` must be the
    // client_id; `iss` must be the team. Swap them and every call comes back
    // `invalid_client` with nothing else to go on.
    const { pem } = await keyPair();
    const { claims } = partsOf(
      await clientSecret({
        teamId: TEAM,
        keyId: KEY_ID,
        clientId: CLIENT_ID,
        privateKeyPem: pem,
        now: NOW,
      }),
    );

    expect(claims.iss).toBe(TEAM);
    expect(claims.sub).toBe(CLIENT_ID);
    expect(claims.aud).toBe('https://appleid.apple.com');
  });

  it('expires minutes from now, not months', async () => {
    // Apple allows six months. This is spent immediately, so a long-lived one
    // would only ever be a bearer credential sitting in somebody's request log.
    const { pem } = await keyPair();
    const { claims } = partsOf(
      await clientSecret({
        teamId: TEAM,
        keyId: KEY_ID,
        clientId: CLIENT_ID,
        privateKeyPem: pem,
        now: NOW,
      }),
    );

    expect(claims.iat).toBe(Math.floor(NOW / 1000));
    expect(claims.exp).toBe(Math.floor(NOW / 1000) + SECRET_TTL_SECONDS);
    expect(SECRET_TTL_SECONDS).toBeLessThan(60 * 60);
  });

  it('refuses to mint anything when a piece is missing', async () => {
    const { pem } = await keyPair();
    const base = { teamId: TEAM, keyId: KEY_ID, clientId: CLIENT_ID, privateKeyPem: pem };

    for (const missing of ['teamId', 'keyId', 'clientId', 'privateKeyPem']) {
      await expect(clientSecret({ ...base, [missing]: '' })).rejects.toThrow(/apple/i);
    }
  });
});

describe('pemToPkcs8', () => {
  it('reads a key whose newlines did not survive the shell', async () => {
    // `supabase secrets set` carries this as one environment variable, and
    // whether the `\\n`s are still there depends on how it was pasted. A key
    // that works from a file and fails from a shell is a bad afternoon.
    const { pem } = await keyPair();
    const flattened = pem.replace(/\n/g, '');

    expect(pemToPkcs8(flattened)).toEqual(pemToPkcs8(pem));
  });

  it('says so when there is nothing there', () => {
    expect(() => pemToPkcs8('-----BEGIN PRIVATE KEY----------END PRIVATE KEY-----')).toThrow(
      /empty/i,
    );
  });
});

describe('exchangeAuthorizationCode', () => {
  const ok = (body: unknown) =>
    jest.fn().mockResolvedValue({ ok: true, json: async () => body } as unknown as Response);

  it('sends the grant Apple expects, and no redirect_uri', async () => {
    // A native authorisation has none, and an empty one is its own
    // `invalid_request` — which reads exactly like a bad secret.
    const fetchImpl = ok({ refresh_token: 'r1' });

    await exchangeAuthorizationCode({
      code: 'c1',
      clientId: CLIENT_ID,
      secret: 's1',
      fetchImpl,
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://appleid.apple.com/auth/token');
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code')).toBe('c1');
    expect(sent.get('client_id')).toBe(CLIENT_ID);
    expect(sent.has('redirect_uri')).toBe(false);
  });

  it('hands back the refresh token', async () => {
    await expect(
      exchangeAuthorizationCode({
        code: 'c1',
        clientId: CLIENT_ID,
        secret: 's1',
        fetchImpl: ok({ refresh_token: 'r1' }),
      }),
    ).resolves.toBe('r1');
  });

  it('answers null rather than throwing when Apple refuses', async () => {
    // The caller has already linked the identity successfully by this point.
    // Nobody is waiting on this, and a throw would turn a missed revocation
    // into a failed sign-in.
    const refused = jest
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({}) } as unknown as Response);

    await expect(
      exchangeAuthorizationCode({ code: 'c1', clientId: CLIENT_ID, secret: 's1', fetchImpl: refused }),
    ).resolves.toBeNull();
  });

  it('answers null when the body has no refresh token in it', async () => {
    await expect(
      exchangeAuthorizationCode({
        code: 'c1',
        clientId: CLIENT_ID,
        secret: 's1',
        fetchImpl: ok({ access_token: 'a1' }),
      }),
    ).resolves.toBeNull();
  });
});

describe('revokeRefreshToken', () => {
  it('sends the token with the hint that says what it is', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true } as unknown as Response);

    await revokeRefreshToken({ token: 'r1', clientId: CLIENT_ID, secret: 's1', fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://appleid.apple.com/auth/revoke');
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get('token')).toBe('r1');
    expect(sent.get('token_type_hint')).toBe('refresh_token');
  });

  it('reads the status and never the body, because success is empty', async () => {
    // Apple answers 200 with no content. A function that parsed JSON here would
    // fail on every call that worked.
    const json = jest.fn();
    await expect(
      revokeRefreshToken({
        token: 'r1',
        clientId: CLIENT_ID,
        secret: 's1',
        fetchImpl: jest.fn().mockResolvedValue({ ok: true, json } as unknown as Response),
      }),
    ).resolves.toBe(true);
    expect(json).not.toHaveBeenCalled();
  });

  it('answers false when Apple refuses', async () => {
    await expect(
      revokeRefreshToken({
        token: 'r1',
        clientId: CLIENT_ID,
        secret: 's1',
        fetchImpl: jest.fn().mockResolvedValue({ ok: false } as unknown as Response),
      }),
    ).resolves.toBe(false);
  });
});
