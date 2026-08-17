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
import { rateGoal } from './lib/rate.mjs';

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
    const { points, harmful, reason } = await rateGoal({ title, category: cat });
    console.log(`${String(points).padStart(3)}  ${title}${harmful ? ' BLOCKED' : ''}`);
    if (harmful) console.log(`     ↳ ${reason}`);
  } catch (err) {
    console.error(`  ??  ${title}\n     ↳ ${err.message}`);
  }
}
