/**
 * Draft candidate goals for the Oz bots. Prints them. Writes nothing.
 *
 *   node scripts/draft-bot-goals.mjs
 *   node scripts/draft-bot-goals.mjs --count=12 --bot=tin.man
 *
 * The Global feed is the first screen a new account lands on, so its goals are
 * the app's answer to "what does a stake look like here". That is documentation
 * written by four fictional people, and it is not something a model gets to
 * publish. This script generates; you choose; `seed-bots.mjs` publishes what
 * you chose. The gap between those three sentences is the entire design.
 *
 * Because it runs against Ollama on your own machine, generating is free and
 * unmetered — ask for forty and keep eight. Rejecting most of the output is the
 * expected way to use this, not a sign it went wrong.
 */
import { RUBRIC, complete, providerFromArgv } from './lib/llm.mjs';

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
const provider = providerFromArgv();

const chosen = only ? { [only]: BOTS[only] } : BOTS;
if (only && !BOTS[only]) {
  console.error(`Unknown bot "${only}". One of: ${Object.keys(BOTS).join(', ')}`);
  process.exit(1);
}

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

console.log(`Drafting via ${provider}. Nothing here is written anywhere — pick what you want.\n`);

for (const [handle, who] of Object.entries(chosen)) {
  console.log(`── ${handle} ${'─'.repeat(Math.max(0, 60 - handle.length))}`);
  try {
    const { goals } = await complete({
      system,
      user: `${who}\n\nWrite ${count} candidate goals for this person's week.`,
      schema: SCHEMA,
      provider,
    });
    for (const g of goals ?? []) {
      const long = g.title.length > 50 ? `  ← ${g.title.length} chars, too long` : '';
      console.log(`  ['${g.title.replace(/'/g, "\\'")}', '${g.category}'],${long}`);
    }
  } catch (err) {
    console.error(`  failed: ${err.message}`);
  }
  console.log('');
}

console.log(
  'Next: paste the keepers into BOTS in scripts/seed-bots.mjs with a day and a\n' +
    'done flag, run scripts/rate-goals.mjs to price them, then npm run db:bots.',
);
