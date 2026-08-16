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
 * These goals are the point, not the characters. The Global feed is the first
 * screen a new account lands on, so it is where someone learns what a stake
 * looks like here — which means every line has to be one they could put in
 * their own week unchanged: a single action, a number or a day attached to it,
 * and done or not done by Sunday with nothing to argue about. "Get fitter" is
 * not on this list; "Walk 30 minutes every morning" is.
 *
 * The characters only decide which *kind* of goal each one takes — Dorothy
 * moves, the Scarecrow learns, the Tin Man tends to people, the Lion asks for
 * things. That is enough personality for a feed and none of it has to be
 * explained.
 *
 * Each goal carries its own price, rated by the same rubric the composer rates
 * yours with — `node scripts/rate-goals.mjs` produces them. Every task is
 * `aud: 'everyone'`, which is what makes this the Global feed rather than four
 * accounts nobody can see, and ids are fixed so a second run updates the same
 * rows instead of staking the week twice.
 *
 * Nobody closes everything. A feed of perfect weeks is not encouragement, it
 * is a pace car, and the one thing this app should never imply is that the
 * people in it do not miss.
 *
 * The addresses are the one part of this list that is not this script's to
 * choose. On a local stack all four already exist: `supabase/seed.sql` creates
 * them at fixed ids as the control on `profiles_select`, and `ensureAccount`
 * adopts those rows by handle rather than making a second cast. So an address
 * that disagrees with the seed describes an account nobody has — which is
 * exactly what `dorothy@ozbots.rally.app` did, unnoticed, until
 * `integration/world.test.ts` started checking. Only a hosted project ever
 * reads them, and there they are what the accounts get created with.
 */
const BOTS = [
  {
    handle: 'dorothy.gale',
    name: 'Dorothy Gale',
    email: 'dorothy@rally.test',
    tasks: [
      ['0b0d0000-0000-4000-8000-000000000001', 1, 'Walk 30 minutes every morning', 'Fitness', 35, true],
      ['0b0d0000-0000-4000-8000-000000000002', 2, 'Meal prep Sunday for the week', 'Home', 25, true],
      ['0b0d0000-0000-4000-8000-000000000003', 4, 'Bike to work 3 days', 'Fitness', 35, false],
    ],
  },
  {
    handle: 'the.scarecrow',
    name: 'The Scarecrow',
    email: 'scarecrow@rally.test',
    tasks: [
      ['0b0d0000-0000-4000-8000-000000000011', 0, 'Read 50 pages before opening my phone', 'Mind', 25, true],
      ['0b0d0000-0000-4000-8000-000000000012', 2, 'Finish module 3 of the SQL course', 'Work', 45, false],
      ['0b0d0000-0000-4000-8000-000000000013', 3, 'Write a 20-minute weekly review on Friday', 'Mind', 25, true],
    ],
  },
  {
    handle: 'tin.man',
    name: 'Tin Man',
    email: 'tinman@rally.test',
    tasks: [
      ['0b0d0000-0000-4000-8000-000000000021', 1, 'Call my sister on Wednesday', 'Mind', 25, true],
      ['0b0d0000-0000-4000-8000-000000000022', 3, 'Cook at home 4 nights', 'Home', 25, false],
      ['0b0d0000-0000-4000-8000-000000000023', 5, 'Stretch 10 minutes before bed', 'Fitness', 35, false],
    ],
  },
  {
    handle: 'cowardly.lion',
    name: 'Cowardly Lion',
    email: 'lion@rally.test',
    tasks: [
      ['0b0d0000-0000-4000-8000-000000000031', 2, 'Ask for a 1:1 about the promotion', 'Work', 45, true],
      ['0b0d0000-0000-4000-8000-000000000032', 4, 'Send the pitch to 3 clients', 'Work', 45, false],
    ],
  },
];

/**
 * There is no `POINTS` map here any more, and its absence is the point.
 *
 * It used to be a hand-copy of `CATEGORY_POINTS`, and the price was derived
 * from the category so that a bot goal could never carry a number the composer
 * would not charge. The composer no longer charges by category — it reads the
 * goal — so deriving a price here would now be the thing that produced a number
 * nobody could stake.
 *
 * Each task therefore carries its own reviewed price, from
 * `node scripts/rate-goals.mjs`. Re-run it whenever the wording changes: an
 * edited goal is a different goal, and the number beside it has to be the one
 * the app would give somebody who typed the same words.
 */

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

  const closed = bot.tasks.filter((t) => t[4]).length;
  console.log(
    `  ${created ? 'created' : 'updated'}  ${bot.name.padEnd(15)} ${closed}/${bot.tasks.length} closed`,
  );
}

console.log('Done. The Global feed is these four.');
}
