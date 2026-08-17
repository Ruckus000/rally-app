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
import { serviceClient } from './lib/db.mjs';
import { complete } from './lib/llm.mjs';
import { possible, thisMonday, todayIndex } from './lib/week.mjs';

const { db, url } = serviceClient();

/**
 * The cast, and the shape of their week.
 *
 * The goals are no longer here, and that is the change. They are drawn from
 * `bot_goal_candidates` — written by a model, priced by the rubric the composer
 * prices yours with, and approved one at a time by a person running
 * `npm run bots:review`. This file used to carry eleven hand-written lines, and
 * the cast sat on whatever week those lines described until somebody edited
 * them.
 *
 * The characters only decide which *kind* of goal each one is written for —
 * Dorothy moves, the Scarecrow learns, the Tin Man tends to people, the Lion
 * asks for things. That is enough personality for a feed and none of it has to
 * be explained.
 *
 * `slots` are fixed task ids, and they are what keeps this idempotent: slot one
 * for Dorothy is the same row every week, holding whichever goal was drawn for
 * it. Without them a second run would stake the week twice rather than replace
 * it. Every task is `aud: 'everyone'`, which is what makes this the Global feed
 * rather than four accounts nobody can see.
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
    slots: [
      '0b0d0000-0000-4000-8000-000000000001',
      '0b0d0000-0000-4000-8000-000000000002',
      '0b0d0000-0000-4000-8000-000000000003',
    ],
  },
  {
    handle: 'the.scarecrow',
    name: 'The Scarecrow',
    email: 'scarecrow@rally.test',
    slots: [
      '0b0d0000-0000-4000-8000-000000000011',
      '0b0d0000-0000-4000-8000-000000000012',
      '0b0d0000-0000-4000-8000-000000000013',
    ],
  },
  {
    handle: 'tin.man',
    name: 'Tin Man',
    email: 'tinman@rally.test',
    slots: [
      '0b0d0000-0000-4000-8000-000000000021',
      '0b0d0000-0000-4000-8000-000000000022',
      '0b0d0000-0000-4000-8000-000000000023',
    ],
  },
  {
    // Two, not three, on purpose: a cast where everybody stakes the same number
    // of goals reads like a template.
    handle: 'cowardly.lion',
    name: 'Cowardly Lion',
    email: 'lion@rally.test',
    slots: [
      '0b0d0000-0000-4000-8000-000000000031',
      '0b0d0000-0000-4000-8000-000000000032',
    ],
  },
];

/**
 * The draw: this bot's approved goals, least recently used first.
 *
 * `nulls first` is the whole rule — a goal that has never been staked outranks
 * every goal that has, and after those the one that ran longest ago comes back
 * round. So a pool with more goals than slots never repeats until it has to,
 * and a pool with fewer degrades to repetition rather than to a silent feed.
 * Somebody repeating a goal across two weeks is honest anyway.
 *
 * Unapproved candidates are invisible here. That filter is the gate: it is the
 * only thing standing between a model's output and the first screen a new
 * account sees.
 */
async function draw(bot) {
  const { data, error } = await db
    .from('bot_goal_candidates')
    .select('id, title, category, points')
    .eq('handle', bot.handle)
    .not('approved_at', 'is', null)
    .order('last_staked', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(bot.slots.length);
  if (error) throw error;
  return data ?? [];
}

const RHYTHM_SCHEMA = {
  type: 'object',
  properties: {
    week: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          day: { type: 'integer' },
          done: { type: 'boolean' },
        },
        required: ['id', 'day', 'done'],
      },
    },
  },
  required: ['week'],
};

/**
 * Which goals close, which are missed, and on which days.
 *
 * Worth being honest about: this is the job in the whole feature where a model
 * earns least. Weighted random would produce a week that read the same. It is a
 * prompt because it keeps every judgement about the bots in one place, and
 * because one call a week costs nothing.
 *
 * Which is also why it falls back rather than failing. A model having a bad day
 * must not stop the week being staked — the goals are the point, the stagger is
 * decoration. The fallback is stated out loud so a run that quietly produced a
 * duller week cannot look like a run that did not.
 */
async function rhythm(drawn, today) {
  const listed = drawn
    .map((g, i) => `${i}: ${g.name} — ${g.title} (${g.category}, ${g.points} points)`)
    .join('\n');

  const system = [
    'You are laying out one week for a small cast of people in a habit-tracking',
    'app, so that the feed reads like a real week rather than a spreadsheet.',
    '',
    'For every goal, choose the day it sits on (0 is Monday, 6 is Sunday) and',
    'whether it was finished by Sunday.',
    '',
    'Spread the days out. Nobody stacks their whole week on one day, and a cast',
    'where everything lands on Monday looks staged.',
    '',
    'Most goals close, but not all of them, and not for everybody. Somebody',
    'should end the week having missed one — that is the honest part, and a feed',
    'where every person finished everything is a feed that makes a reader feel',
    'worse. Nobody should miss all of theirs either.',
    '',
    'Harder and vaguer goals are likelier to be missed than small specific ones.',
    '',
    `Today is day ${today} of this week, counting Monday as 0. Nothing on a`,
    'later day can have been finished yet, so mark those not done — the days',
    'ahead are the ones still to play for.',
    '',
    'Put at least two or three goals on today or a day already past, and close',
    'most of those. A week where every goal is still ahead reads as one nobody',
    'has started, and the feed is meant to show people who are already going.',
    '',
    'Return one entry per goal, using the id given.',
  ].join('\n');

  try {
    const { week } = await complete({
      system,
      user: `The goals, by id:\n\n${listed}`,
      schema: RHYTHM_SCHEMA,
    });

    const byId = new Map((week ?? []).map((w) => [w.id, w]));
    // Anything the model skipped or invented falls back per goal rather than
    // discarding the whole answer, so a half-answer still beats no answer.
    return drawn.map((g, i) => {
      const said = byId.get(i);
      const raw = Number(said?.day);
      const day = Number.isInteger(raw) && raw >= 0 && raw <= 6 ? raw : i % 7;
      return {
        day,
        done: possible(day, typeof said?.done === 'boolean' ? said.done : i % 3 !== 2, today),
      };
    });
  } catch (err) {
    console.error(`  (no rhythm from the model: ${err.message.split('\n')[0]})`);
    console.error('  Falling back to a fixed spread — the week will read flatter.');
    return drawn.map((_, i) => ({ day: i % 7, done: possible(i % 7, i % 3 !== 2, today) }));
  }
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

// One reading of the clock, not two. `week_start` and the day index have to
// describe the same week, and computing them separately leaves a window —
// small, but real — where a run that crosses midnight stakes one week and
// judges its outcomes against the next, forcing almost everything open.
const now = new Date();
const monday = thisMonday(now);
const today = todayIndex(now);
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
  // Everyone's accounts and everyone's goals first, so the week is laid out in
  // one call across the whole cast. Asking per bot would let four independent
  // answers all decide Tuesday was a good day.
  const drawn = [];
  for (const bot of BOTS) {
    const { id, created } = await ensureAccount(bot);

    // The signup trigger generates a handle; this replaces it with the readable
    // one and is the only place `is_bot` is ever set.
    const { error: profileError } = await db
      .from('profiles')
      .update({ handle: bot.handle, name: bot.name, is_bot: true })
      .eq('id', id);
    if (profileError) throw profileError;

    bot.id = id;
    bot.created = created;
    bot.goals = await draw(bot);
    for (const g of bot.goals) drawn.push({ ...g, name: bot.name });
  }

  const empty = BOTS.filter((b) => !b.goals.length);
  if (empty.length === BOTS.length) {
    throw new Error(
      'No approved goals for anybody, so there is no week to stake.\n' +
        '  npm run bots:draft -- --write   then   npm run bots:review',
    );
  }
  for (const b of empty) {
    console.error(`  ${b.name} has no approved goals — staking nothing for them.`);
  }

  const shape = await rhythm(drawn, today);

  let cursor = 0;
  for (const [botIndex, bot] of BOTS.entries()) {
    // Staggered, and interleaved across the cast. Everything written in one
    // transaction is written at one instant, and the feed rendered as a wall of
    // "0h ago" in four blocks of one name — a week's worth of other people's
    // lives, all apparently happening while you watched.
    const rows = bot.goals.map((g, i) => {
      const { day, done } = shape[cursor + i];
      const at = new Date(Date.now() - (2 + i * 5 + botIndex) * 3600_000).toISOString();
      return {
        id: bot.slots[i],
        owner_id: bot.id,
        week_start: monday,
        day,
        title: g.title,
        category: g.category,
        points: g.points,
        aud: 'everyone',
        source: 'staked',
        created_at: at,
        done_at: done ? at : null,
        updated_at: at,
      };
    });
    cursor += bot.goals.length;

    if (rows.length) {
      const { error: taskError } = await db.from('tasks').upsert(rows, { onConflict: 'id' });
      if (taskError) throw taskError;
    }

    // A slot the pool could not fill would otherwise keep last week's row, and
    // show up in the feed as a goal from a week nobody is looking at.
    const unfilled = bot.slots.slice(bot.goals.length);
    if (unfilled.length) {
      const { error } = await db.from('tasks').delete().in('id', unfilled);
      if (error) throw error;
    }

    // Stamped only once the week is actually staked, so a run that fell over
    // half way does not push these goals to the back of the queue for nothing.
    if (bot.goals.length) {
      const { error } = await db
        .from('bot_goal_candidates')
        .update({ last_staked: monday })
        .in(
          'id',
          bot.goals.map((g) => g.id),
        );
      if (error) throw error;
    }

    const closed = rows.filter((r) => r.done_at).length;
    console.log(
      `  ${bot.created ? 'created' : 'updated'}  ${bot.name.padEnd(15)} ${closed}/${rows.length} closed`,
    );
  }

  console.log('Done. The Global feed is these four.');
}
