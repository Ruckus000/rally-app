/**
 * How often did the composer stake a goal nobody screened?
 *
 *   npm run llm:health              # the last 24 hours
 *   npm run llm:health -- --hours=6
 *
 * The rating feature fails open on purpose: a model that does not answer must
 * not stop somebody writing down their week. The cost of that choice is that a
 * lapsed guard looks exactly like a working one — the goal is staked, the price
 * is its category's, and nothing on screen differs. On a free-tier key the
 * quota is shared by every user, so this is a thing users trigger rather than a
 * thing you do, and there is no other trace: failures are deliberately never
 * cached, so `goal_ratings` will never show a day the model was down.
 *
 * `rate-goal` says so in a log line. This counts them.
 *
 * Zero is the healthy answer and the only one. Any goal that reached the
 * composer unscreened is one the guard did not run on, and a number that keeps
 * climbing is the signal to put the Gemini key on a paid tier — the per-minute
 * free-tier limit is the usual cause, and it is measured in single-digit goals
 * per minute across everybody.
 *
 * Writes nothing. Exits 1 if anything went unscreened, so it can be a cron.
 */
import { fromEnvFile } from './lib/env.mjs';

const flag = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const hours = Math.min(Number(flag('hours', 24)), 24); // the API rejects wider
const token = fromEnvFile('SUPABASE_ACCESS_TOKEN');

/**
 * The project ref, which is the first label of the API host. Derived rather
 * than configured — `.env` already names the project and a second place to
 * write it down is a second place for it to be wrong.
 */
const ref =
  flag('ref', null) ??
  (fromEnvFile('EXPO_PUBLIC_SUPABASE_URL') ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\./)?.[1];

if (!token || !ref) {
  console.error(
    `Cannot reach the log API.\n` +
      (token ? '' : '  SUPABASE_ACCESS_TOKEN is not set. Make one at\n    https://supabase.com/dashboard/account/tokens\n  then put it in .env or export it.\n') +
      (ref ? '' : '  No project ref. Set EXPO_PUBLIC_SUPABASE_URL in .env, or pass --ref=<ref>.\n'),
  );
  process.exit(1);
}

const end = new Date();
const start = new Date(end.getTime() - hours * 3600_000);

/**
 * ClickHouse, which has been the Logs Explorer engine since June 2026: one
 * `logs` table, tagged by `source`, with the raw line in `event_message`.
 * A project older than that runs on BigQuery, where the source is the table
 * name and the query reads `select event_message from function_logs`.
 */
const sql = `
  select event_message, count(*) as n
  from logs
  where source = 'function_logs'
    and event_message like '%rate-goal: %'
  group by event_message
  order by n desc
`;

const url = new URL(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all`);
url.searchParams.set('sql', sql);
url.searchParams.set('iso_timestamp_start', start.toISOString());
url.searchParams.set('iso_timestamp_end', end.toISOString());

const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
if (!res.ok) {
  console.error(`The log API returned ${res.status}.\n  ${await res.text()}`);
  process.exit(1);
}

const rows = (await res.json())?.result ?? [];
const count = (needle) =>
  rows.filter((r) => `${r.event_message}`.includes(needle)).reduce((n, r) => n + Number(r.n), 0);

const unscreened = count('NOT SCREENED');
const unpriced = count('priced by category');

console.log(`rate-goal, the last ${hours} hour${hours === 1 ? '' : 's'}:\n`);
console.log(`  staked without being screened   ${unscreened}`);
console.log(`  priced by category, not rated   ${unpriced}`);

if (!unscreened && !unpriced) {
  console.log('\nEvery goal reached the model. Nothing to do.');
  process.exit(0);
}

if (unscreened) {
  console.log(
    `\n${unscreened} goal${unscreened === 1 ? '' : 's'} went unscreened. The guard did not run on ` +
      `them,\nand the composer showed nothing to say so. If this is not a one-off, the free\n` +
      `tier's per-minute limit is the usual cause — it is a few goals a minute across\n` +
      `every user at once, not per user.`,
  );
}

process.exit(unscreened ? 1 : 0);
