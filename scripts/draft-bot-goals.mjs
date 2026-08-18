/**
 * Draft candidate goals for the Oz bots.
 *
 *   node scripts/draft-bot-goals.mjs
 *   node scripts/draft-bot-goals.mjs --count=12 --bot=tin.man
 *   SUPABASE_SERVICE_ROLE_KEY=… node scripts/draft-bot-goals.mjs --write
 *
 * The Global feed is the first screen a new account lands on, so its goals are
 * the app's answer to "what does a stake look like here". That is documentation
 * written by four fictional people, and it is not something a model gets to
 * publish. This script generates; you approve with `bots:review`;
 * `seed-bots.mjs` publishes what you approved. The gap between those three
 * sentences is the entire design.
 *
 * Without `--write` it prints and stores nothing, which is the way to read a
 * batch before committing to it. With `--write` each goal is priced and
 * screened and lands in `bot_goal_candidates` as pending — pending, not
 * published: nothing here reaches a feed until a person has said yes to it.
 *
 * Ask for forty and keep eight. Rejecting most of the output is the expected
 * way to use this, not a sign it went wrong.
 */
import { RUBRIC, answer } from './lib/llm.mjs';
import { rateGoal } from './lib/rate.mjs';
import { serviceClient } from './lib/db.mjs';

/**
 * Who they are, in the terms the goals have to reflect. Deliberately short:
 * these are people with a week, not characters with a bit. The Oz names carry
 * the joke; the goals have to carry their weight as goals.
 */
const BOTS = {
  'dorothy.gale': 'Dorothy Gale — practical, outdoorsy, keeps a household running.',
  'the.scarecrow': 'The Scarecrow — studying for something, reads, wants to think better.',
  'tin.man': 'Tin Man — works on staying connected to people, and on his health.',
  'cowardly.lion': 'Cowardly Lion — pushing himself at work, doing the things he is afraid of.',
};

const SCHEMA = {
  type: 'object',
  properties: {
    goals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          category: { type: 'string', enum: ['Fitness', 'Work', 'Home', 'Mind'] },
        },
        required: ['title', 'category'],
      },
    },
  },
  required: ['goals'],
};

const flag = (name, fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const count = Number(flag('count', '10'));
const only = flag('bot', null);
const write = process.argv.includes('--write');

if (only && !BOTS[only]) {
  console.error(`Unknown bot "${only}". One of: ${Object.keys(BOTS).join(', ')}`);
  process.exit(1);
}
const chosen = only ? { [only]: BOTS[only] } : BOTS;

// Only when writing, so reading a batch stays a thing you can do with no key.
const { db } = write ? serviceClient() : {};

/**
 * The rubric describes what a goal worth points looks like, which is exactly
 * the brief for writing one. Reusing it rather than restating it is what stops
 * the bots being written to a different standard than they are priced by.
 */
const system = [
  RUBRIC,
  '',
  '---',
  '',
  'You are not pricing a goal now. You are writing candidates, to the standard',
  'described above. Every line must be one a stranger could copy into their own',
  'week unchanged: one action, a number or a day attached, done or not done by',
  'Sunday with nothing to argue about. "Get fitter" is not a goal. "Walk 30',
  'minutes every morning" is.',
  '',
  'Write in the first person, plainly, the way somebody types into a box on',
  'their phone. No brand voice, no encouragement, no exclamation marks, and no',
  'reference to Oz — the names carry that and the goals must not.',
  '',
  'Keep every title under 50 characters. Vary what they ask of a week: some',
  'ordinary, a few genuinely hard. A list where everything is impressive is a',
  'list nobody can copy.',
  '',
  'Two things a smaller model gets wrong here, so check them before answering.',
  '',
  'Do not reuse the example goals above. They are there to show you the shape',
  'of a good line, and they are already in the app — writing them back is the',
  'one outcome that makes this list worthless. Every goal must be new.',
  '',
  'Choose each category from what the goal is actually about, not from the',
  'first option in the list. Fitness is the body. Work is a job or study. Home',
  'is the house, food, and money. Mind is reading, thinking, rest, and people.',
  'Calling a friend is Mind, not Fitness. A list where every goal has the same',
  'category is wrong.',
].join('\n');

console.log(
  write
    ? 'Drafting. Each goal is priced and screened, then stored as pending.\n'
    : 'Drafting. Nothing here is written anywhere — run again with --write to keep it.\n',
);

let kept = 0;
let blocked = 0;
let repeats = 0;
let unpriced = 0;

for (const [handle, who] of Object.entries(chosen)) {
  console.log(`── ${handle} ${'─'.repeat(Math.max(0, 60 - handle.length))}`);
  try {
    const { goals } = await answer({
      system,
      user: `${who}\n\nWrite ${count} candidate goals for this person's week.`,
      schema: SCHEMA,
    });
    for (const g of goals ?? []) {
      if (!write) {
        const long = g.title.length > 50 ? `  ← ${g.title.length} chars, too long` : '';
        console.log(`  ['${g.title.replace(/'/g, "\\'")}', '${g.category}'],${long}`);
        continue;
      }
      // The title bound is a database constraint now, so a long line is a
      // failed insert rather than a warning. Said here, before spending a call
      // pricing something that cannot be stored.
      if (g.title.length > 50) {
        console.log(`  ${String(g.title.length).padStart(3)}c  ${g.title}  ← too long, dropped`);
        continue;
      }
      const { points, verdict, reason } = await rateGoal({ title: g.title, category: g.category });
      if (points === null) {
        // The rubric did not answer, so there is no price to store. Storing one
        // anyway — the category's, the band's floor, any number at all — puts a
        // goal in front of a reviewer that looks priced and was not.
        unpriced += 1;
        console.log(`  ???  ${g.title}  ← not priced, dropped`);
        continue;
      }
      if (verdict === 'blocked') {
        // Not stored at all. A blocked goal is not a pending one — putting it
        // in the queue would only mean rejecting it again by hand.
        blocked += 1;
        console.log(`  ---  ${g.title} BLOCKED`);
        console.log(`       ↳ ${reason}`);
        continue;
      }
      const { data, error } = await db
        .from('bot_goal_candidates')
        .upsert(
          { handle, title: g.title, category: g.category, points },
          { onConflict: 'handle,title', ignoreDuplicates: true },
        )
        .select('id');
      if (error) throw error;

      // Nothing back means the unique constraint swallowed it: this bot already
      // has that goal, approved or pending or waiting to be rejected. Worth
      // showing rather than counting as new — a run that is mostly repeats is
      // telling you the pool is saturated.
      if (!data?.length) {
        repeats += 1;
        console.log(`  ${String(points).padStart(3)}  ${g.title}  ← already in the pool`);
        continue;
      }
      kept += 1;
      console.log(`  ${String(points).padStart(3)}  ${g.title}  (${g.category})`);
    }
  } catch (err) {
    console.error(`  failed: ${err.message}`);
  }
  console.log('');
}

console.log(
  write
    ? `Stored ${kept} pending, blocked ${blocked}, already had ${repeats}` +
      // Only mentioned when it happened. A zero here is the normal state and
      // does not need a word; a number is worth running again for, because
      // those goals were drafted and then thrown away unpriced.
      (unpriced ? `, could not price ${unpriced}` : '') +
      '.\nNext: npm run bots:review, then npm run db:bots.'
    : 'Next: run again with --write to store these for review.',
);
