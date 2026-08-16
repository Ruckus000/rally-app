/**
 * Price goals the way the composer would, and print what it would charge.
 *
 *   node scripts/rate-goals.mjs "Walk 30 minutes every morning" "Get fitter"
 *   node scripts/rate-goals.mjs --file=goals.txt
 *
 * Two uses. One: you have reviewed a batch of bot goals and need the numbers to
 * paste into `seed-bots.mjs`. Two: checking the rubric after editing it — feed
 * it a list with known-cheap, known-dear and known-blocked lines and read the
 * column.
 *
 * There is no provider flag, because there is one provider. Point LLM_BASE_URL
 * at whatever machine production talks to and this prices goals with the same
 * model users get, which is the only definition of parity that means anything.
 *
 * Writes nothing. Prints a table.
 */
import { readFileSync } from 'node:fs';
import { RUBRIC, SCREENING, complete } from './lib/llm.mjs';

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
      '  node scripts/rate-goals.mjs --file=goals.txt\n\n' +
      'In the file, one goal per line, optionally "Title | Category".',
  );
  process.exit(1);
}

console.log(`Rating ${lines.length} goal${lines.length === 1 ? '' : 's'}.\n`);

for (const line of lines) {
  const [title, cat = 'Fitness'] = line.split('|').map((s) => s.trim());
  try {
    const [priced, screened] = await Promise.all([
      complete({
        system: RUBRIC,
        user: `Category: ${cat}\nGoal: ${title}`,
        schema: PRICE_SCHEMA,
      }),
      complete({ system: SCREENING, user: title, schema: SCREEN_SCHEMA }),
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
