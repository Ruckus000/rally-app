/**
 * Create the Oz bots, and stake them a week.
 *
 *   SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed-bots.mjs
 *
 * Idempotent, and keyed on handle rather than on id: it is run once per
 * environment and then again every time the cast changes, so "already there"
 * has to be the boring case rather than a duplicate-key crash.
 *
 * The service-role key is read from the environment and never written
 * anywhere. It bypasses RLS entirely, which is why this is a script you run
 * rather than something the app can do: `is_bot` is not settable by any
 * signed-in account, deliberately — it publishes a profile to every user on
 * the service.
 *
 * Plain .mjs rather than TypeScript: there is no TS runner in this project's
 * dependencies, and adding one to run a script four times a year is not worth
 * the install.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error(
    'SUPABASE_SERVICE_ROLE_KEY is not set.\n' +
      'Find it under Project Settings → API in the Supabase dashboard, and pass it\n' +
      'on the command line rather than putting it in .env — that file is for the\n' +
      'publishable key, and this one bypasses every policy in the database.',
  );
  process.exit(1);
}

// A key goes into an HTTP header, and a header can only hold ASCII — so a
// placeholder pasted verbatim out of a README fails deep inside fetch with
// "Cannot convert argument to a ByteString", naming a character code and
// nothing else. Caught here, where the answer is obvious.
if (!/^[\x21-\x7e]{20,}$/.test(KEY)) {
  console.error(
    'That does not look like a service-role key.\n' +
      'If you copied the command from a README, replace the … with the real key —\n' +
      'it is a long run of plain ASCII, starting with "sb_secret_" or "eyJ".',
  );
  process.exit(1);
}

/** The URL is not a secret and is already in .env, next to the publishable key. */
const url =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  (readFileSync(new URL('../.env', import.meta.url), 'utf8').match(
    /^EXPO_PUBLIC_SUPABASE_URL=(.+)$/m,
  ) ?? [])[1];

if (!url) {
  console.error('No EXPO_PUBLIC_SUPABASE_URL, in the environment or in .env.');
  process.exit(1);
}

const db = createClient(url, KEY, {
  auth: { persistSession: false },
  // Node 20 has no global WebSocket and supabase-js builds a realtime client
  // eagerly, so `createClient` throws without this. The same line, for the same
  // reason, is in integration/support/clients.ts — the app itself needs
  // neither, because React Native provides WebSocket natively.
  realtime: { transport: ws },
});

/**
 * The cast, and their week.
 *
 * Every task is `aud: 'everyone'` — that is what makes this the Global feed
 * rather than four accounts nobody can see. Ids are fixed so a second run
 * updates the same rows instead of staking the week twice.
 *
 * Nobody closes everything. A feed of perfect weeks is not encouragement, it
 * is a pace car, and the one thing this app should never imply is that the
 * people in it do not miss.
 */
const BOTS = [
  {
    handle: 'dorothy.gale',
    name: 'Dorothy Gale',
    email: 'dorothy@ozbots.rally.app',
    tasks: [
      ['0b0d0000-0000-4000-8000-000000000001', 1, 'Walked the whole way instead of taking the bus', 'Fitness', 20, true],
      ['0b0d0000-0000-4000-8000-000000000002', 2, 'Wrote the letter I kept not writing', 'Mind', 25, true],
      ['0b0d0000-0000-4000-8000-000000000003', 4, 'Back on the road before it gets dark', 'Fitness', 30, false],
    ],
  },
  {
    handle: 'the.scarecrow',
    name: 'The Scarecrow',
    email: 'scarecrow@ozbots.rally.app',
    tasks: [
      ['0b0d0000-0000-4000-8000-000000000011', 0, 'Read forty pages before anything else', 'Mind', 25, true],
      ['0b0d0000-0000-4000-8000-000000000012', 2, 'Finished the course I started in March', 'Work', 40, false],
      ['0b0d0000-0000-4000-8000-000000000013', 3, 'Explained it to someone else, badly, then better', 'Mind', 20, true],
    ],
  },
  {
    handle: 'tin.man',
    name: 'Tin Man',
    email: 'tinman@ozbots.rally.app',
    tasks: [
      ['0b0d0000-0000-4000-8000-000000000021', 1, 'Called someone I had been putting off', 'Mind', 15, true],
      ['0b0d0000-0000-4000-8000-000000000022', 3, 'Actually said the thing instead of hinting at it', 'Mind', 25, false],
      ['0b0d0000-0000-4000-8000-000000000023', 5, 'Oiled the joints — stretched every morning', 'Fitness', 20, false],
    ],
  },
  {
    handle: 'cowardly.lion',
    name: 'Cowardly Lion',
    email: 'lion@ozbots.rally.app',
    tasks: [
      ['0b0d0000-0000-4000-8000-000000000031', 2, 'Said the thing in the meeting', 'Work', 30, true],
      ['0b0d0000-0000-4000-8000-000000000032', 4, 'Asked for the raise', 'Work', 45, false],
    ],
  },
];

/** The Monday of the current week, in the server's own `week_start` shape. */
function thisMonday() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // getDay(): Sunday is 0, so Monday is 1 and Sunday is six days into the week.
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Existing bot, by handle. The signup trigger writes the row; this finds it. */
async function findByHandle(handle) {
  const { data, error } = await db.from('profiles').select('id').eq('handle', handle).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

async function ensureAccount(bot) {
  const existing = await findByHandle(bot.handle);
  if (existing) return { id: existing, created: false };

  const { data, error } = await db.auth.admin.createUser({
    email: bot.email,
    email_confirm: true,
    user_metadata: { handle: bot.handle, name: bot.name },
  });
  if (error) throw error;
  return { id: data.user.id, created: true };
}

const monday = thisMonday();
console.log(`Seeding the Oz bots into ${new URL(url).host}, week of ${monday}.`);

try {
  await seed();
} catch (err) {
  // A stack trace here is noise: everything that can go wrong is a wrong key,
  // a project that has not had the migration pushed, or no network.
  console.error(`\nFailed: ${err?.message ?? err}`);
  if (err?.hint) console.error(err.hint);
  process.exit(1);
}

async function seed() {
for (const [botIndex, bot] of BOTS.entries()) {
  const { id, created } = await ensureAccount(bot);

  // The signup trigger generates a handle; this replaces it with the readable
  // one and is the only place `is_bot` is ever set.
  const { error: profileError } = await db
    .from('profiles')
    .update({ handle: bot.handle, name: bot.name, is_bot: true })
    .eq('id', id);
  if (profileError) throw profileError;

  // Staggered, and interleaved across the cast. Everything written in one
  // transaction is written at one instant, and the feed rendered as a wall of
  // "0h ago" in four blocks of one name — a week's worth of other people's
  // lives, all apparently happening while you watched.
  const rows = bot.tasks.map(([taskId, day, title, category, points, done], i) => {
    const at = new Date(Date.now() - (2 + i * 5 + botIndex) * 3600_000).toISOString();
    return {
      id: taskId,
      owner_id: id,
      week_start: monday,
      day,
      title,
      category,
      points,
      aud: 'everyone',
      source: 'staked',
      created_at: at,
      done_at: done ? at : null,
      updated_at: at,
    };
  });

  const { error: taskError } = await db.from('tasks').upsert(rows, { onConflict: 'id' });
  if (taskError) throw taskError;

  const closed = bot.tasks.filter((t) => t[5]).length;
  console.log(
    `  ${created ? 'created' : 'updated'}  ${bot.name.padEnd(15)} ${closed}/${bot.tasks.length} closed`,
  );
}

console.log('Done. The Global feed is these four.');
}
