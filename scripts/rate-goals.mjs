/**
 * Price goals the way the composer would, and print what it would charge.
 *
 *   node scripts/rate-goals.mjs "Walk 30 minutes every morning" "Get fitter"
 *   node scripts/rate-goals.mjs --provider=groq --file=goals.txt
 *
 * Two uses. One: you have reviewed a batch of bot goals and need the numbers to
 * paste into `seed-bots.mjs`. Two: the parity check — run the same list through
 * `--provider=ollama` and `--provider=groq` and diff. A local 3B and a hosted
 * 70B will not agree perfectly, and what matters is that they agree on which
 * goals are the cheap ones and never disagree about a block. If the local model
 * is the harsher of the two, tune the rubric against it, because a bot goal
 * priced here and a user's goal priced in production have to mean the same
 * thing.
 *
 * Writes nothing. Prints a table.
 */
import { readFileSync } from 'node:fs';
import { RUBRIC, SCREENING, complete, providerFromArgv } from './lib/llm.mjs';

const POINT_MIN = 10;
const POINT_MAX = 60;
const POINT_STEP = 5;

/** The same two calls the edge function makes, so parity means what it says. */
const PRICE_SCHEMA = {
  type: 'object',
  properties: { points: { type: 'integer' } },
  required: ['points'],
};

const SCREEN_SCHEMA = {
  type: 'object',
  properties: { harmful: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['harmful', 'reason'],
};

const provider = providerFromArgv();
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const fileFlag = process.argv.find((a) => a.startsWith('--file='));

/**
 * A goal per line. `Title | Category` if you want to fix the category; bare
 * titles are rated as Fitness, which only matters as context for the model.
 */
const lines = fileFlag
  ? readFileSync(fileFlag.slice('--file='.length), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  : args;

if (!lines.length) {
  console.error(
    'Nothing to rate.\n\n' +
      '  node scripts/rate-goals.mjs "Walk 30 minutes every morning"\n' +
      '  node scripts/rate-goals.mjs --file=goals.txt --provider=groq\n\n' +
      'In the file, one goal per line, optionally "Title | Category".',
  );
  process.exit(1);
}

console.log(`Rating ${lines.length} goal${lines.length === 1 ? '' : 's'} via ${provider}.\n`);

for (const line of lines) {
  const [title, cat = 'Fitness'] = line.split('|').map((s) => s.trim());
  try {
    const [priced, screened] = await Promise.all([
      complete({
        system: RUBRIC,
        user: `Category: ${cat}\nGoal: ${title}`,
        schema: PRICE_SCHEMA,
        provider,
      }),
      complete({ system: SCREENING, user: title, schema: SCREEN_SCHEMA, provider }),
    ]);
    // The same clamp the server applies, so what prints is what a task row
    // would actually carry rather than what the model happened to say.
    const points = clamp(priced.points);
    console.log(`${String(points).padStart(3)}  ${title}${screened.harmful ? ' BLOCKED' : ''}`);
    if (screened.harmful) console.log(`     ↳ ${screened.reason}`);
  } catch (err) {
    console.error(`  ??  ${title}\n     ↳ ${err.message}`);
  }
}

function clamp(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return POINT_MIN;
  const snapped = Math.round(value / POINT_STEP) * POINT_STEP;
  return Math.min(POINT_MAX, Math.max(POINT_MIN, snapped));
}
