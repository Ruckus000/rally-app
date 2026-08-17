/**
 * Approve or reject drafted bot goals, one at a time.
 *
 *   SUPABASE_SERVICE_ROLE_KEY=… node scripts/review-bot-goals.mjs
 *   SUPABASE_SERVICE_ROLE_KEY=… node scripts/review-bot-goals.mjs --bot=tin.man
 *
 * This script is the gate. `draft-bot-goals.mjs --write` fills the pool with
 * pending candidates and `seed-bots.mjs` publishes approved ones, and the only
 * thing standing between a model's output and the first screen a new account
 * sees is somebody sitting here pressing a key.
 *
 * Approving stamps `approved_at`. Rejecting deletes the row — there is no
 * rejected state, because nothing asks what was turned down last month, and the
 * unique constraint on (handle, title) means a deleted goal can be drafted
 * again if the model still thinks it is good. Skipping leaves it pending for
 * next time.
 *
 * The only interactive script in this project. Everything else here takes its
 * arguments and exits; this one cannot, because the judgement is the feature.
 */
import { createInterface } from 'node:readline/promises';
import { serviceClient } from './lib/db.mjs';

const flag = (name, fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const only = flag('bot', null);
const { db } = serviceClient();

const pending = await (async () => {
  let q = db
    .from('bot_goal_candidates')
    .select('id, handle, title, category, points')
    .is('approved_at', null)
    // Oldest first, so a goal cannot sit unseen behind newer drafts forever.
    .order('created_at', { ascending: true });
  if (only) q = q.eq('handle', only);

  const { data, error } = await q;
  if (error) {
    console.error(`\nFailed: ${error.message}`);
    if (error.hint) console.error(error.hint);
    process.exit(1);
  }
  return data ?? [];
})();

if (!pending.length) {
  console.log(
    only ? `Nothing pending for ${only}.` : 'Nothing pending. Run npm run bots:draft -- --write.',
  );
  process.exit(0);
}

console.log(
  `${pending.length} pending. [a]pprove  [r]eject  [s]kip  [q]uit\n` +
    'Rejecting deletes; skipping leaves it for next time.\n',
);

const rl = createInterface({ input: process.stdin, output: process.stdout });

// Once stdin ends there is nobody to ask, and the only safe reading of silence
// is "stop". Tracked explicitly because `question()` resolves with an empty
// string on a closed stream rather than rejecting — which would otherwise be a
// loop that never ends, or worse, an answer nobody gave.
let ended = false;
rl.once('close', () => {
  ended = true;
});

const ANSWERS = ['a', 'r', 's', 'q'];

/** Asks until the answer is one of the four. Never infers one. */
async function ask() {
  for (;;) {
    let raw;
    try {
      raw = await rl.question('   [a/r/s/q] ');
    } catch {
      // The stream is gone — Ctrl-D, or the end of a pipe. `question()` rejects
      // with ERR_USE_AFTER_CLOSE rather than resolving, so this is the only
      // place the end of input can be noticed.
      return 'q';
    }
    const answer = `${raw ?? ''}`.trim().toLowerCase().charAt(0);
    if (ANSWERS.includes(answer)) return answer;
    if (ended) return 'q';
    console.log('   a to approve, r to reject, s to skip, q to stop.');
  }
}

let approved = 0;
let rejected = 0;
let skipped = 0;

try {
  for (const [i, c] of pending.entries()) {
    console.log(`── ${i + 1}/${pending.length}  ${c.handle}`);
    console.log(`   ${c.title}`);
    console.log(`   ${c.category}, ${c.points} points`);

    const answer = await ask();
    if (answer === 'q') break;

    // Branched explicitly, and deliberately not a ternary with a delete on the
    // false arm: every unhandled answer would then destroy a row. Doing nothing
    // is the only correct response to an answer this script does not recognise.
    if (answer === 's') {
      skipped += 1;
    } else if (answer === 'a') {
      const { error } = await db
        .from('bot_goal_candidates')
        .update({ approved_at: new Date().toISOString() })
        .eq('id', c.id);
      if (error) console.error(`   failed: ${error.message}`);
      else approved += 1;
    } else if (answer === 'r') {
      const { error } = await db.from('bot_goal_candidates').delete().eq('id', c.id);
      if (error) console.error(`   failed: ${error.message}`);
      else rejected += 1;
    }
    console.log('');
  }
} finally {
  rl.close();
}

const left = pending.length - approved - rejected;
console.log(
  `Approved ${approved}, rejected ${rejected}, ${skipped} skipped, ${left} still pending.`,
);
if (approved) console.log('Next: npm run db:bots.');
