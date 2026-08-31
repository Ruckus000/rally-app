/**
 * blocks: the one control in this app whose whole value is that it happens in
 * the database.
 *
 * A block implemented in the client is a filter someone can turn off. A block
 * implemented in a policy is an answer the server will not give. Everything
 * this feature promises — "you will not see them, and they will not see you" —
 * is `private.block_between` and the six SELECT policies that call it, so
 * every claim below is made through a real signed-in client against real RLS.
 * The unit suite structurally cannot make any of them: its Supabase fake has
 * no row security at all, so a test named "A cannot see B" would pass there
 * for the wrong reason and go on passing after the policy was deleted.
 *
 * Two things this file is unusually careful about, because they are the two
 * ways this feature can be wrong in a way that looks fine:
 *
 *   1. **Symmetry.** One row hides content in *both* directions. The person
 *      who never wrote anything down still stops seeing the blocker. If only
 *      the blocker's view were filtered, the blocked party would carry on
 *      cheering and writing notes into a void — the exact behaviour the
 *      control exists to end. Half of the assertions here are made from B's
 *      side for that reason.
 *
 *   2. **Your own rows.** `block_between` matches a row where you are either
 *      party, so a self-row would make it true of you and every amended policy
 *      would stop showing you your own week. `blocks_not_self` and the
 *      unguarded ownership branch in each policy are what prevent that, and
 *      they are asserted directly rather than inferred from the negatives —
 *      a regression there hides someone's own tasks from them, which is worse
 *      than any leak this file guards against.
 *
 * maya and dre are the pair throughout: they share the basement circle, so
 * every visibility path is genuinely open before the block and there is
 * something for it to close.
 *
 * `blocks` is not in `resetDomainTables`' truncate list — it is not a domain
 * table — so this file clears it itself, after every test rather than before,
 * so that a failing assertion cannot leave a row behind to confuse the next
 * file's negatives.
 */
import { asService, asUser, idOf, signInAnonymously } from '../support/clients';
import { sql } from '../support/reset';
import { BOT_HANDLES, SEED_BOT, type SeedHandle } from '../fixtures/world';

/** A Monday, as `tasks.week_start` requires. */
const WEEK = '2026-08-10';

afterEach(async () => {
  await sql('delete from public.blocks');
});

// ─── the vocabulary ────────────────────────────────────────────────────────

const block = (who: SeedHandle, target: SeedHandle) =>
  asUser(who).rpc('block_person', { p_blocked: idOf(target) });

const unblock = (who: SeedHandle, target: SeedHandle) =>
  asUser(who).rpc('unblock_person', { p_blocked: idOf(target) });

/**
 * Setup only. `asService` bypasses RLS, so nothing seeded here is a subject.
 *
 * `circle_id: null` is survivable here *only* because this defaults to
 * `everyone`, which ignores the circle. Since
 * `20260831210000_a_goal_belongs_to_a_circle.sql` a `friends` goal with no
 * circle reaches nobody but its owner — so the first person to write
 * `makeTask('maya', 'friends')` in this file will write a test that asserts
 * nothing. Give it `CIRCLE_IDS.basement` when you do.
 */
async function makeTask(owner: SeedHandle, aud: 'everyone' | 'friends' | 'private' = 'everyone') {
  const { data, error } = await asService()
    .from('tasks')
    .insert({
      owner_id: idOf(owner),
      circle_id: null,
      week_start: WEEK,
      day: 0,
      title: `${owner} stakes something`,
      category: 'move',
      points: 3,
      aud,
    })
    .select('id')
    .single();
  expect(error).toBeNull();
  return (data as { id: string }).id;
}

async function makeNote(author: SeedHandle, target: { task_id?: string; recipient_id?: string }) {
  const { data, error } = await asService()
    .from('notes')
    .insert({ author_id: idOf(author), body: 'proud of you', ...target })
    .select('id')
    .single();
  expect(error).toBeNull();
  return (data as { id: string }).id;
}

async function makeCheer(actor: SeedHandle, taskId: string) {
  const { data, error } = await asService()
    .from('reactions')
    .insert({ actor_id: idOf(actor), target_type: 'task', target_id: taskId, kind: 'cheer' })
    .select('id')
    .single();
  expect(error).toBeNull();
  return (data as { id: string }).id;
}

/** Does this person's own client hand the row back? Not "does the row exist". */
async function sees(viewer: SeedHandle, table: 'tasks' | 'notes' | 'reactions', id: string) {
  const { data, error } = await asUser(viewer).from(table).select('id').eq('id', id);
  expect(error).toBeNull();
  return (data ?? []).length === 1;
}

async function seesProfileOf(viewer: SeedHandle, who: SeedHandle) {
  const { data, error } = await asUser(viewer).from('profiles').select('handle').eq('id', idOf(who));
  expect(error).toBeNull();
  return (data ?? []).length === 1;
}

/**
 * One task, one note and one cheer each, arranged so that every row is visible
 * to both people before anything is blocked.
 *
 * The cheers are deliberately crossed — each person cheers the *other's* task
 * — because that is what makes the own-rows assertions bite: after the block,
 * maya's cheer sits on a task she can no longer see, and the only thing that
 * can still return it to her is the unguarded `actor_id = auth.uid()` branch.
 */
async function seedBothSides() {
  const mayaTask = await makeTask('maya');
  const dreTask = await makeTask('dre');
  return {
    mayaTask,
    dreTask,
    mayaNote: await makeNote('maya', { task_id: mayaTask }),
    dreNote: await makeNote('dre', { task_id: dreTask }),
    mayaCheer: await makeCheer('maya', dreTask),
    dreCheer: await makeCheer('dre', mayaTask),
  };
}

// ─── before anything is blocked ────────────────────────────────────────────

describe('before a block, the two of them see each other completely', () => {
  it('maya sees dres task, profile, note and cheer', async () => {
    // The control for everything below. Without it, a policy that returned
    // nothing to anybody would satisfy every negative assertion in this file.
    const w = await seedBothSides();

    expect(await sees('maya', 'tasks', w.dreTask)).toBe(true);
    expect(await seesProfileOf('maya', 'dre')).toBe(true);
    expect(await sees('maya', 'notes', w.dreNote)).toBe(true);
    expect(await sees('maya', 'reactions', w.dreCheer)).toBe(true);
  });

  it('and dre sees mayas', async () => {
    const w = await seedBothSides();

    expect(await sees('dre', 'tasks', w.mayaTask)).toBe(true);
    expect(await seesProfileOf('dre', 'maya')).toBe(true);
    expect(await sees('dre', 'notes', w.mayaNote)).toBe(true);
    expect(await sees('dre', 'reactions', w.mayaCheer)).toBe(true);
  });
});

// ─── the blocker's side ────────────────────────────────────────────────────

describe('after maya blocks dre, dre is gone from mayas app', () => {
  it('hides dres task, profile content, note and cheer', async () => {
    const w = await seedBothSides();

    const { error } = await block('maya', 'dre');
    expect(error).toBeNull();

    expect(await sees('maya', 'tasks', w.dreTask)).toBe(false);
    expect(await sees('maya', 'notes', w.dreNote)).toBe(false);
    expect(await sees('maya', 'reactions', w.dreCheer)).toBe(false);
  });

  it('and hides dre from the unfiltered reads the app actually issues', async () => {
    // The app never selects by id; it asks for the week. A policy that
    // filtered only the by-id case would be no filter at all.
    const w = await seedBothSides();
    await block('maya', 'dre');

    const { data: tasks } = await asUser('maya').from('tasks').select('id,owner_id');
    const owners = (tasks ?? []).map((t: { owner_id: string }) => t.owner_id);
    expect(owners).not.toContain(idOf('dre'));
    expect(owners).toContain(idOf('maya'));

    const { data: notes } = await asUser('maya').from('notes').select('id');
    expect((notes ?? []).map((n: { id: string }) => n.id)).not.toContain(w.dreNote);
  });
});

// ─── the blocked party's side: the symmetry claim ──────────────────────────

describe('symmetry: dre never wrote a row, and maya disappears for him too', () => {
  // The single most important block of assertions in this file. A one-way
  // block leaves the blocked person free to go on cheering and writing notes
  // at somebody who cannot see them — technically a mute, sold as a block.
  // `private.block_between` matches either column, and this is what proves it.

  it('hides mayas task from dre', async () => {
    const w = await seedBothSides();
    await block('maya', 'dre');

    expect(await sees('dre', 'tasks', w.mayaTask)).toBe(false);
  });

  it('hides mayas profile from dre', async () => {
    await seedBothSides();
    await block('maya', 'dre');

    expect(await seesProfileOf('dre', 'maya')).toBe(false);
  });

  it('hides mayas note from dre', async () => {
    const w = await seedBothSides();
    await block('maya', 'dre');

    expect(await sees('dre', 'notes', w.mayaNote)).toBe(false);
  });

  it('hides mayas cheer from dre', async () => {
    const w = await seedBothSides();
    await block('maya', 'dre');

    expect(await sees('dre', 'reactions', w.mayaCheer)).toBe(false);
  });
});

// ─── the regression that would be worst ────────────────────────────────────

describe('a block never hides you from yourself', () => {
  // `block_between(other)` is true when a row names you as *either* party, so
  // a self-row would satisfy both halves at once and every policy amended by
  // this migration would stop returning your own rows. `blocks_not_self` and
  // the unguarded ownership branch in each policy are the two things standing
  // between that and someone opening the app to an empty week. Asserted
  // explicitly rather than left to fall out of the negatives above, because
  // the negatives would all still pass while this was broken.

  it('maya still sees her own task, note, cheer and profile after blocking', async () => {
    const w = await seedBothSides();
    await block('maya', 'dre');

    expect(await sees('maya', 'tasks', w.mayaTask)).toBe(true);
    expect(await sees('maya', 'notes', w.mayaNote)).toBe(true);
    // Sits on dres task, which maya can no longer see. The `actor_id` branch
    // of `reactions_select` is the only thing that can return it.
    expect(await sees('maya', 'reactions', w.mayaCheer)).toBe(true);
    expect(await seesProfileOf('maya', 'maya')).toBe(true);
  });

  it('dre still sees his own task, note, cheer and profile after being blocked', async () => {
    const w = await seedBothSides();
    await block('maya', 'dre');

    expect(await sees('dre', 'tasks', w.dreTask)).toBe(true);
    expect(await sees('dre', 'notes', w.dreNote)).toBe(true);
    expect(await sees('dre', 'reactions', w.dreCheer)).toBe(true);
    expect(await seesProfileOf('dre', 'dre')).toBe(true);
  });

  it('and a circle-mate who is not party to the block is untouched', async () => {
    // nana is in the basement with both of them. A block is between two
    // people; a `block_between` that read the wrong column, or a policy that
    // dropped its audience test while gaining a guard, would show here.
    const w = await seedBothSides();
    await block('maya', 'dre');

    expect(await sees('nana', 'tasks', w.mayaTask)).toBe(true);
    expect(await sees('nana', 'tasks', w.dreTask)).toBe(true);
    expect(await seesProfileOf('nana', 'maya')).toBe(true);
    expect(await seesProfileOf('nana', 'dre')).toBe(true);
  });
});

// ─── retroactive ───────────────────────────────────────────────────────────

describe('a block reaches backwards', () => {
  it('hides a note dre wrote before he was blocked', async () => {
    // Falls out of the shape rather than being arranged: the guard tests the
    // author, not a timestamp. Pinned anyway, because "blocking only stops
    // new content" is a plausible-sounding thing for someone to implement
    // later, and it would leave the conversation that caused the block
    // sitting in the app.
    const task = await makeTask('maya');
    const note = await makeNote('dre', { task_id: task });

    expect(await sees('maya', 'notes', note)).toBe(true);

    await block('maya', 'dre');

    expect(await sees('maya', 'notes', note)).toBe(false);
  });

  it('and a cheer dre placed before he was blocked', async () => {
    const task = await makeTask('maya');
    const cheer = await makeCheer('dre', task);

    expect(await sees('maya', 'reactions', cheer)).toBe(true);

    await block('maya', 'dre');

    expect(await sees('maya', 'reactions', cheer)).toBe(false);
  });
});

// ─── the addressed note, in the awkward direction ──────────────────────────

describe('an addressed note stops being delivered, both ways round', () => {
  it('withholds a note dre addressed to maya', async () => {
    const note = await makeNote('dre', { recipient_id: idOf('maya') });
    expect(await sees('maya', 'notes', note)).toBe(true);

    await block('maya', 'dre');

    // The `recipient_id` branch of `notes_select` sits *inside* the guard, and
    // this is why: a note addressed to you by someone you blocked is precisely
    // the delivery the control exists to stop.
    expect(await sees('maya', 'notes', note)).toBe(false);
  });

  it('withholds a note maya addressed to dre, which is the uncomfortable half', async () => {
    // The guard is on the *author* and the block matches either way round, so
    // a note maya wrote is silently withheld from dre once she blocks him.
    // That is intended — a block is an end to the exchange, not a filter on
    // one inbox — but it is the one case where the person left in the dark is
    // the one who asked for the block, so it is pinned rather than discovered.
    const note = await makeNote('maya', { recipient_id: idOf('dre') });
    expect(await sees('dre', 'notes', note)).toBe(true);

    await block('maya', 'dre');

    expect(await sees('dre', 'notes', note)).toBe(false);
    // Still hers, though. She is the author.
    expect(await sees('maya', 'notes', note)).toBe(true);
  });
});

// ─── the bots stay ─────────────────────────────────────────────────────────

describe('blocking somebody does not cost you the bots', () => {
  it('a brand-new account still resolves every Oz bot after blocking someone', async () => {
    // The `is_bot` branch of `profiles_select` is deliberately outside the
    // guard, and this is the first-run experience that depends on it: an
    // account with no circle sees the bots by name, or it sees a screen full
    // of "Someone". If a later edit tucks `is_bot` inside the guard to look
    // tidier, this is the test that says what it cost.
    const { client, id } = await signInAnonymously();

    const { error } = await client.rpc('block_person', { p_blocked: idOf('maya') });
    expect(error).toBeNull();

    const { data } = await client.from('profiles').select('id,handle');
    const others = ((data ?? []) as { id: string; handle: string }[])
      .filter((r) => r.id !== id)
      .map((r) => r.handle)
      .sort();

    // The bots, plus maya — and maya is here *because* she was blocked, not in
    // spite of it. `private.i_blocked` widens `profiles_select` to anyone on
    // your own block list so the unblock screen can draw a name; before the
    // block this account could not see her at all. Spelled out rather than
    // filtered away, because it is the one case where blocking somebody makes
    // *more* of them visible, and a reader who did not expect it should meet
    // it here rather than in a bug report.
    expect(others).toEqual([...BOT_HANDLES, 'maya'].sort());
  });

  it('and a stranger it has not blocked stays invisible', async () => {
    // The control for the line above: `i_blocked` widens by exactly one
    // person, not by "anybody once you have blocked anybody".
    const { client, id } = await signInAnonymously();
    await client.rpc('block_person', { p_blocked: idOf('maya') });

    const { data } = await client.from('profiles').select('id,handle');
    const handles = ((data ?? []) as { id: string; handle: string }[])
      .filter((r) => r.id !== id)
      .map((r) => r.handle);

    expect(handles).not.toContain('dre');
    expect(handles).not.toContain('nana');
  });
});

// ─── week_rollups, deliberately unfiltered ─────────────────────────────────

describe('week_rollups survive a block, on purpose', () => {
  it('maya still reads dres closed week after blocking him', async () => {
    // Not an oversight. A rollup is a number the circle's arithmetic is made
    // of, not something a person said, and filtering it per-viewer would mean
    // two members of one circle get different answers to "how did we do this
    // week". Leaving somebody out of the maths is a different feature, and it
    // is called leaving the circle. This test exists so that "fixing" the
    // omission breaks something named.
    const { error: seedErr } = await asService()
      .from('week_rollups')
      .insert({ profile_id: idOf('dre'), week_start: WEEK, points: 30 });
    expect(seedErr).toBeNull();

    await block('maya', 'dre');

    const { data, error } = await asUser('maya')
      .from('week_rollups')
      .select('points')
      .eq('profile_id', idOf('dre'));

    expect(error).toBeNull();
    expect(data).toEqual([{ points: 30 }]);
  });
});

// ─── task_pairs: the residual state ────────────────────────────────────────

describe('task_pairs: their progress goes with them', () => {
  const pairsSeenBy = async (viewer: SeedHandle, taskId: string) => {
    const { data, error } = await asUser(viewer)
      .from('task_pairs')
      .select('profile_id,done_at')
      .eq('task_id', taskId);
    expect(error).toBeNull();
    return (data ?? []) as { profile_id: string; done_at: string | null }[];
  };

  it('hides dres pair row, including whether he ticked it, and keeps mayas', async () => {
    // The place blocking somebody used to leave state behind. The task
    // disappears; without the amended policy the row saying dre ticked it did
    // not, so his progress went on being readable through a table nobody
    // thinks of as content.
    const task = await makeTask('maya', 'private');
    const { error: pairErr } = await asService()
      .from('task_pairs')
      .insert([
        { task_id: task, profile_id: idOf('maya') },
        { task_id: task, profile_id: idOf('dre'), done_at: '2026-08-11T09:00:00Z' },
      ]);
    expect(pairErr).toBeNull();

    expect((await pairsSeenBy('maya', task)).map((p) => p.profile_id).sort()).toEqual(
      [idOf('maya'), idOf('dre')].sort(),
    );

    await block('maya', 'dre');

    const after = await pairsSeenBy('maya', task);
    expect(after).toHaveLength(1);
    expect(after[0].profile_id).toBe(idOf('maya'));
    expect(after[0].done_at).toBeNull();
  });
});

// ─── the block list has to render ──────────────────────────────────────────

describe('the block list renders by name, and only for the blocker', () => {
  it('maya can still resolve dres profile, so the unblock screen shows a person', async () => {
    // `private.i_blocked` exists for exactly this. `blocks_select` gives maya a
    // list of uuids; without a way to turn one back into a name, the Settings
    // screen offering to unblock him can only draw an identifier nobody
    // recognises — and a block you cannot find is a block you cannot lift.
    const w = await seedBothSides();
    await block('maya', 'dre');

    expect(await seesProfileOf('maya', 'dre')).toBe(true);
    // The name, and nothing else. `i_blocked` widens `profiles`, not content.
    expect(await sees('maya', 'tasks', w.dreTask)).toBe(false);
    expect(await sees('maya', 'notes', w.dreNote)).toBe(false);
  });

  it('but dre cannot resolve mayas, which is the asymmetry', async () => {
    // `i_blocked` is one-directional on purpose. There is no branch anywhere
    // that reads the blocker's row from the blocked party's side, so this
    // cannot be turned into a way of discovering that you have been blocked.
    await seedBothSides();
    await block('maya', 'dre');

    expect(await seesProfileOf('dre', 'maya')).toBe(false);
  });

  it('and the list itself names only rows maya wrote', async () => {
    await block('maya', 'dre');

    const { data, error } = await asUser('maya').from('blocks').select('blocker_id,blocked_id');
    expect(error).toBeNull();
    expect(data).toEqual([{ blocker_id: idOf('maya'), blocked_id: idOf('dre') }]);
  });
});

describe('being blocked is not something you can read', () => {
  it('maya cannot see the row that names her as the blocked party', async () => {
    // `blocks_select` is scoped to `blocker_id`, not to "either column". If it
    // matched both, opening the block list would be how you found out.
    const { error } = await block('dre', 'maya');
    expect(error).toBeNull();

    const { data, error: readErr } = await asUser('maya').from('blocks').select('*');
    expect(readErr).toBeNull();
    expect(data).toEqual([]);

    // The row is really there — this is a policy result, not a failed write.
    const rows = await sql<{ n: string }>('select count(*)::text as n from public.blocks');
    expect(rows[0].n).toBe('1');
  });

  it('and cannot write a row naming somebody else as the blocker', async () => {
    // No INSERT policy and no INSERT grant: both writes go through the RPCs,
    // which is what stops a row naming you as the blocked party from being
    // written by anyone but you.
    const { error } = await asUser('maya')
      .from('blocks')
      .insert({ blocker_id: idOf('dre'), blocked_id: idOf('nana') });

    expect(error?.code).toBe('42501');
  });

  it('and cannot delete somebody elses block by hand', async () => {
    await block('dre', 'maya');

    const { error } = await asUser('maya').from('blocks').delete().eq('blocker_id', idOf('dre'));
    expect(error?.code).toBe('42501');

    const rows = await sql<{ n: string }>('select count(*)::text as n from public.blocks');
    expect(rows[0].n).toBe('1');
  });
});

// ─── undo ──────────────────────────────────────────────────────────────────

describe('unblocking puts everything back, in both directions', () => {
  it('restores tasks, notes, cheers and profiles for both people', async () => {
    const w = await seedBothSides();
    await block('maya', 'dre');
    expect(await sees('maya', 'tasks', w.dreTask)).toBe(false);
    expect(await sees('dre', 'tasks', w.mayaTask)).toBe(false);

    const { error } = await unblock('maya', 'dre');
    expect(error).toBeNull();

    expect(await sees('maya', 'tasks', w.dreTask)).toBe(true);
    expect(await sees('maya', 'notes', w.dreNote)).toBe(true);
    expect(await sees('maya', 'reactions', w.dreCheer)).toBe(true);
    expect(await seesProfileOf('maya', 'dre')).toBe(true);

    expect(await sees('dre', 'tasks', w.mayaTask)).toBe(true);
    expect(await sees('dre', 'notes', w.mayaNote)).toBe(true);
    expect(await sees('dre', 'reactions', w.mayaCheer)).toBe(true);
    expect(await seesProfileOf('dre', 'maya')).toBe(true);
  });

  it('unblocking somebody who blocked you does nothing to their row', async () => {
    // `unblock_person` filters on `blocker_id = auth.uid()`. Without that
    // filter it would be the one operation a blocked person would most like to
    // perform, handed over by omission.
    await block('dre', 'maya');

    const { error } = await unblock('maya', 'dre');
    expect(error).toBeNull();

    const rows = await sql<{ n: string }>('select count(*)::text as n from public.blocks');
    expect(rows[0].n).toBe('1');
  });
});

// ─── what block_person refuses ─────────────────────────────────────────────

describe('block_person refuses the two blocks that make no sense', () => {
  it('refuses a bot, loudly', async () => {
    // A block on a bot would be an incoherent half-state: its tasks and cheers
    // would vanish while its name went on rendering to everyone, because the
    // `is_bot` branch of `profiles_select` is outside the guard. The refusal is
    // what makes that branch an invariant rather than a convention.
    const { error } = await asUser('maya').rpc('block_person', { p_blocked: SEED_BOT.id });

    expect(error).not.toBeNull();
    expect(error?.code).toBe('22023');

    const rows = await sql<{ n: string }>('select count(*)::text as n from public.blocks');
    expect(rows[0].n).toBe('0');
  });

  it('refuses you blocking yourself', async () => {
    // `blocks_not_self` is not tidiness. A self-row satisfies both halves of
    // `block_between` at once, and every policy in the migration would stop
    // showing maya her own week.
    const { error } = await asUser('maya').rpc('block_person', { p_blocked: idOf('maya') });

    expect(error?.code).toBe('23514');
  });

  it('is idempotent, because a button can be pressed twice', async () => {
    expect((await block('maya', 'dre')).error).toBeNull();
    expect((await block('maya', 'dre')).error).toBeNull();

    const rows = await sql<{ n: string }>('select count(*)::text as n from public.blocks');
    expect(rows[0].n).toBe('1');
  });

  it('and unblocking twice is not a fault either', async () => {
    await block('maya', 'dre');
    expect((await unblock('maya', 'dre')).error).toBeNull();
    expect((await unblock('maya', 'dre')).error).toBeNull();
  });
});

// ─── notifications: the actor is in the payload ────────────────────────────

describe('notifications name their actor in jsonb, and the filter has to survive that', () => {
  const seedNotification = async (
    recipient: SeedHandle,
    payload: Record<string, unknown> | null,
    kind = 'note_received',
  ) => {
    const { data, error } = await asService()
      .from('notifications')
      .insert({ recipient_id: idOf(recipient), tier: 'needs', kind, payload: payload ?? {} })
      .select('id')
      .single();
    expect(error).toBeNull();
    return (data as { id: string }).id;
  };

  /** Raw jsonb, because PostgREST would not let a client write this table. */
  const seedRawPayload = async (recipient: SeedHandle, json: string) => {
    const rows = await sql<{ id: string }>(
      `insert into public.notifications (recipient_id, tier, kind, payload)
       values ($1, 'needs', 'note_received', $2::jsonb) returning id`,
      [idOf(recipient), json],
    );
    return rows[0].id;
  };

  const feedOf = async (viewer: SeedHandle) => {
    const { data, error } = await asUser(viewer).from('notifications').select('id');
    expect(error).toBeNull();
    return (data ?? []).map((r: { id: string }) => r.id);
  };

  it('hides a notification whose actor maya has blocked', async () => {
    const id = await seedNotification('maya', { actor_id: idOf('dre') });
    expect(await feedOf('maya')).toContain(id);

    await block('maya', 'dre');

    expect(await feedOf('maya')).not.toContain(id);
  });

  it('keeps a notification whose actor is somebody else', async () => {
    const mine = await seedNotification('maya', { actor_id: idOf('nana') });
    await block('maya', 'dre');

    expect(await feedOf('maya')).toContain(mine);
  });

  it('keeps a notification with no actor_id at all', async () => {
    const id = await seedNotification('maya', { week_start: WEEK }, 'week_closed');
    await block('maya', 'dre');

    expect(await feedOf('maya')).toContain(id);
  });

  it.each([
    ['a string that is not a uuid', '{"actor_id":"not-a-uuid"}'],
    ['a sentinel the server might write', '{"actor_id":"system"}'],
    ['an empty string', '{"actor_id":""}'],
  ])('survives an actor_id that is %s', async (_label, json) => {
    // **This one is guarding a whole-screen outage, not a leak.**
    //
    // `authenticated` cannot write `notifications`, but `service_role` can and
    // the edge functions hold that key. Under a policy that casts
    // `payload ->> 'actor_id'` to uuid without testing its shape first, one row
    // like these raises *invalid input syntax for type uuid* — and because the
    // cast happens inside a policy, the failure is not one bad row being
    // hidden. It is the whole select erroring and that person's notification
    // feed returning **nothing at all**, every time they open the app, until
    // somebody deletes the row. A privacy filter that can take down a screen is
    // worse than the leak it prevents.
    //
    // The `case` in `notifications_select` is what makes these fall through to
    // `true`: a row we cannot attribute is a row we have no grounds to hide.
    // `case` rather than `or`, too, because Postgres does not promise to
    // evaluate the arms of an `or` left to right, so a regex guard sat beside
    // the cast can be reordered behind it and stop guarding anything.
    const bad = await seedRawPayload('maya', json);
    const good = await seedNotification('maya', { actor_id: idOf('nana') });

    await block('maya', 'dre');

    const { data, error } = await asUser('maya').from('notifications').select('id');

    // The error assertion is the point. Zero rows and a 22P02 are both "the
    // feed is empty" from the client's side, and only one of them is a bug.
    expect(error).toBeNull();
    const seen = (data ?? []).map((r: { id: string }) => r.id);
    expect(seen).toContain(bad);
    expect(seen).toContain(good);
  });

  it('still filters properly when a malformed row is sitting beside a blocked one', async () => {
    // The combination, because the failure mode is order-dependent: a policy
    // that erred on the malformed row would never reach the blocked one, and a
    // test that only ever saw them separately could miss that the guard
    // short-circuits the filter as well as the crash.
    const malformed = await seedRawPayload('maya', '{"actor_id":"system"}');
    const blocked = await seedNotification('maya', { actor_id: idOf('dre') });

    await block('maya', 'dre');

    const seen = await feedOf('maya');
    expect(seen).toContain(malformed);
    expect(seen).not.toContain(blocked);
  });

  it('and a notification addressed to somebody else is still nobody elses', async () => {
    // `recipient_id = auth.uid()` is an AND here rather than an OR, unlike the
    // content policies. Gaining a block guard must not have turned the
    // ownership test into a branch.
    const dres = await seedNotification('dre', { actor_id: idOf('nana') });

    expect(await feedOf('maya')).not.toContain(dres);
  });
});
