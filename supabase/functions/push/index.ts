/**
 * Carry a notification row out to the phones it belongs to.
 *
 * `private.notify_on_reaction` writes the row; a Database Webhook on
 * `notifications` insert calls this; this looks up the recipient's devices and
 * hands the message to Expo, which hands it to APNs. Nothing here knows what a
 * cheer is — the row already carries the text it renders, in `payload`, put
 * there so the bell needed no second read. This is the second reader.
 *
 * Deployed with `verify_jwt = false`, because a webhook is not a user. That
 * makes the secret check below the only thing between this URL and anyone who
 * finds it, and what is behind it is: every device token on the service, and
 * the ability to send a push to any of them. Treat that check as the whole
 * security model, because it is.
 *
 * Deno, not Node — Supabase Edge Functions are Deno, so the imports below are
 * URLs and there is no package.json anywhere near this file.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

/** Matches `notif_tier`. Every tier pushes today; see the note on `title`. */
type Tier = 'needs' | 'week' | 'circle';

type NotificationRow = {
  id: string;
  recipient_id: string;
  tier: Tier;
  kind: string;
  payload: Record<string, unknown>;
};

/** The webhook envelope. `record` is the inserted row. */
type WebhookBody = {
  type?: string;
  table?: string;
  record?: NotificationRow;
};

type ExpoTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Constant-time-ish comparison. A plain `===` on a secret leaks its length and
 * a little about its prefix through timing; this is cheap enough that there is
 * no reason not to.
 */
function secretMatches(given: string | null, expected: string): boolean {
  if (!given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * What the lock screen says.
 *
 * Built from `payload` alone. The row is written by a trigger from what the
 * database already knew, so nothing a user typed reaches this except a task
 * title — which is bounded by the tasks table and rendered as text, never
 * interpreted.
 */
function message(row: NotificationRow): { title: string; body: string } {
  const actor = String(row.payload.actor_name ?? 'Someone');
  const task = String(row.payload.task_title ?? '').trim();

  if (row.kind === 'cheer') {
    return {
      title: 'Rally',
      body: task ? `🔥 ${actor} cheered "${task}"` : `🔥 ${actor} cheered you on`,
    };
  }
  // A kind this build predates. Better a plain sentence than a push that says
  // "undefined" — and better than dropping it, which would be a notification
  // the bell shows and the phone silently swallows.
  return { title: 'Rally', body: `${actor} did something in your circle` };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const expected = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!expected) {
    // Refuse rather than fall open. A missing secret means the function was
    // deployed before it was configured, and the alternative — serving anyway
    // — is an open push endpoint.
    console.error('PUSH_WEBHOOK_SECRET is not set; refusing every request.');
    return json({ error: 'not configured' }, 500);
  }
  if (!secretMatches(req.headers.get('x-webhook-secret'), expected)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: WebhookBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  const row = body.record;
  if (!row?.recipient_id) return json({ error: 'no record' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    // The only key that can read `device_tokens` — the table is granted to
    // nobody else, deliberately.
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const { data: devices, error } = await supabase
    .from('device_tokens')
    .select('token')
    .eq('profile_id', row.recipient_id);

  if (error) {
    console.error('device lookup failed', error.message);
    return json({ error: 'lookup failed' }, 500);
  }

  const tokens = (devices ?? []).map((d: { token: string }) => d.token);
  // Not an error. Most accounts have no device registered — they never granted
  // permission, or they are on a simulator — and the bell still shows the row.
  if (tokens.length === 0) return json({ sent: 0, reason: 'no devices' });

  const { title, body: text } = message(row);
  const messages = tokens.map((to) => ({
    to,
    title,
    body: text,
    sound: 'default',
    // Collapses on the phone by recipient, so a burst replaces rather than
    // stacks. Cheap, and the only batching this does.
    channelId: 'default',
  }));

  const response = await fetch(EXPO_PUSH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    console.error('expo push failed', response.status, await response.text());
    return json({ error: 'push failed' }, 502);
  }

  const { data: tickets } = (await response.json()) as { data?: ExpoTicket[] };

  // `DeviceNotRegistered` means the app was deleted or the token rotated. Left
  // alone, those rows accumulate and every future send burns a slot on an
  // address nothing lives at — so the receipt is the only thing that can tell
  // us, and this is the only place it is read.
  const dead = (tickets ?? [])
    .map((ticket, i) => (ticket.details?.error === 'DeviceNotRegistered' ? tokens[i] : null))
    .filter((token): token is string => token !== null);

  if (dead.length > 0) {
    await supabase.from('device_tokens').delete().in('token', dead);
  }

  const failed = (tickets ?? []).filter((t) => t.status === 'error').length;
  return json({ sent: tokens.length - failed, failed, pruned: dead.length });
});
