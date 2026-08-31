/**
 * Scheduling a deletion, and the fourteen days before it is irreversible.
 *
 * Guideline 5.1.1(v) wants the entire account record gone, including content
 * shared with other people. This file is about the first half of that: the
 * moment someone taps the button, everything they own stops being readable by
 * anyone else, and stays readable to them so that the way back has something
 * to put back.
 *
 * Every claim here is a claim about row security, so every one is made through
 * a real signed-in client against a real database. The unit suite structurally
 * cannot make them — its Supabase fake has no RLS at all, so "dre cannot see
 * maya" would pass there for the wrong reason and go on passing after the
 * policy was deleted.
 *
 * Three things this file is deliberate about:
 *
 *   1. **The control comes first.** A policy that returned nothing to anybody
 *      would satisfy every negative below. Each visibility claim is asserted
 *      true before the deletion is scheduled and false after, in that order,
 *      against the same seeded row.
 *
 *   2. **`aud = 'everyone'` gets its own test.** That branch is why this could
 *      not be done by teaching `shares_circle_with` about deleted accounts —
 *      a public goal never consults a circle, so a guard there would have left
 *      one on the shared feed. jordan shares no circle with dre and is the
 *      only person in this file who can prove it.
 *
 *   3. **Your own rows.** Every amended policy keeps its ownership branch
 *      outside the new guard. If that regressed, a scheduled account would
 *      stop being able to see what it is about to lose — and the Undo screen
 *      would have nothing to draw. That is asserted directly rather than
 *      inferred from the negatives.
 *
 * maya and dre share the basement circle, so every path is genuinely open
 * before the deletion and there is something for it to close. `profiles` is
 * not in `resetDomainTables`' truncate list, so this file clears `deleted_at`
 * itself, after every test rather than before, so a failing assertion cannot
 * leave an account scheduled and confuse the next file's positives.
 */
import { asAnon, asService, asUser, idOf } from '../support/clients';
import { sql } from '../support/reset';
import { CIRCLE_IDS, type SeedHandle } from '../fixtures/world';

/** A Monday, as `tasks.week_start` requires. */
const WEEK = '2026-08-10';

afterEach(async () => {
  await sql('update public.profiles set deleted_at = null where deleted_at is not null');
});

// ─── the vocabulary ────────────────────────────────────────────────────────

const schedule = (who: SeedHandle) => asUser(who).rpc('schedule_account_deletion');
const cancel = (who: SeedHandle) => asUser(who).rpc('cancel_account_deletion');

/**
 * Setup only. `asService` bypasses RLS, so nothing seeded here is a subject.
 *
 * The circle is not decoration. This defaults to `friends`, and since
 * `20260831210000_a_goal_belongs_to_a_circle.sql` a `friends` goal with no
 * circle is visible to its owner alone — so with `circle_id: null` every
 * "visible until the account is scheduled, then not" assertion below would
 * pass against something already invisible, and this file would go green
 * while testing nothing. basement, because maya and dre are both in it.
 */
async function makeTask(owner: SeedHandle, aud: 'everyone' | 'friends' | 'private' = 'friends') {
  const { data, error } = await asService()
    .from('tasks')
    .insert({
      owner_id: idOf(owner),
      circle_id: CIRCLE_IDS.basement,
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

async function makeRollup(who: SeedHandle) {
  const { error } = await asService().from('week_rollups').insert({
    profile_id: idOf(who),
    week_start: WEEK,
    points: 12,
    done: 4,
    total: 5,
    perfect: false,
    streak_held: true,
  });
  expect(error).toBeNull();
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

async function seesRollupOf(viewer: SeedHandle, who: SeedHandle) {
  const { data, error } = await asUser(viewer)
    .from('week_rollups')
    .select('points')
    .eq('profile_id', idOf(who));
  expect(error).toBeNull();
  return (data ?? []).length === 1;
}

async function seesMembershipOf(viewer: SeedHandle, who: SeedHandle) {
  const { data, error } = await asUser(viewer)
    .from('circle_members')
    .select('circle_id')
    .eq('profile_id', idOf(who));
  expect(error).toBeNull();
  return (data ?? []).length > 0;
}

/** Everything dre owns, arranged so all of it is visible to maya beforehand. */
async function dresWorld() {
  const task = await makeTask('dre');
  await makeRollup('dre');
  return {
    task,
    noteOnOwnTask: await makeNote('dre', { task_id: task }),
    noteToMaya: await makeNote('dre', { recipient_id: idOf('maya') }),
    cheer: await makeCheer('dre', await makeTask('maya')),
  };
}

// ─── the control ───────────────────────────────────────────────────────────

describe('before anything is scheduled, maya sees all of dre', () => {
  it('profile, goal, notes, cheer, rollup and membership', async () => {
    const w = await dresWorld();

    expect(await seesProfileOf('maya', 'dre')).toBe(true);
    expect(await sees('maya', 'tasks', w.task)).toBe(true);
    expect(await sees('maya', 'notes', w.noteOnOwnTask)).toBe(true);
    expect(await sees('maya', 'notes', w.noteToMaya)).toBe(true);
    expect(await sees('maya', 'reactions', w.cheer)).toBe(true);
    expect(await seesRollupOf('maya', 'dre')).toBe(true);
    expect(await seesMembershipOf('maya', 'dre')).toBe(true);
  });
});

// ─── the disappearance ─────────────────────────────────────────────────────

describe('once dre schedules deletion, dre is gone from mayas app', () => {
  it('takes the profile, the goal, both notes, the cheer and the rollup', async () => {
    const w = await dresWorld();

    const { error } = await schedule('dre');
    expect(error).toBeNull();

    expect(await seesProfileOf('maya', 'dre')).toBe(false);
    expect(await sees('maya', 'tasks', w.task)).toBe(false);
    expect(await sees('maya', 'notes', w.noteOnOwnTask)).toBe(false);
    expect(await sees('maya', 'reactions', w.cheer)).toBe(false);
    expect(await seesRollupOf('maya', 'dre')).toBe(false);
  });

  it('takes the note dre wrote *to* maya, which sits in mayas own inbox', async () => {
    // The subtle one. `recipient_id = auth.uid()` is inside the guard, not
    // outside it, so a note addressed to you by someone who left goes too.
    // Outside the guard this row would survive its own author.
    const w = await dresWorld();
    await schedule('dre');

    expect(await sees('maya', 'notes', w.noteToMaya)).toBe(false);
  });

  it('takes dre off the circle roster, without taking maya off it', async () => {
    // `is_circle_member` asks about the caller, so it cannot carry this alone.
    // The ownership half of the same policy is what keeps maya in her circle.
    await schedule('dre');

    expect(await seesMembershipOf('maya', 'dre')).toBe(false);
    expect(await seesMembershipOf('maya', 'maya')).toBe(true);
  });

  it('holds for the unfiltered reads the app actually issues', async () => {
    // The app never selects by id; it asks for the week. A policy that
    // filtered only the by-id case would be no filter at all.
    const w = await dresWorld();
    await schedule('dre');

    const { data: tasks } = await asUser('maya').from('tasks').select('id,owner_id');
    const owners = (tasks ?? []).map((t: { owner_id: string }) => t.owner_id);
    expect(owners).not.toContain(idOf('dre'));
    expect(owners).toContain(idOf('maya'));

    const { data: notes } = await asUser('maya').from('notes').select('id');
    expect((notes ?? []).map((n: { id: string }) => n.id)).not.toContain(w.noteOnOwnTask);
  });
});

// ─── the branch a circle guard would have missed ───────────────────────────

describe('a public goal goes too', () => {
  it('is visible to a stranger before, and not after', async () => {
    // jordan shares no circle with dre, so `aud = 'everyone'` is the only
    // reason this row was ever readable — and the only branch that a guard on
    // `shares_circle_with` would have left wide open to the whole service.
    const open = await makeTask('dre', 'everyone');
    expect(await sees('jordan', 'tasks', open)).toBe(true);

    await schedule('dre');

    expect(await sees('jordan', 'tasks', open)).toBe(false);
  });
});

// ─── the second read of the audience model ─────────────────────────────────

describe('content other people wrote on a departing account goes with it', () => {
  it('hides mayas note on dres goal, from a third party', async () => {
    // `tasks_select` inlines the audience model; `notes_select` delegates to
    // `private.can_see_task`. Guard only the policy and the two answers
    // diverge — this note is maya's, so no author guard touches it, and it
    // stays readable through a task that has stopped being.
    const task = await makeTask('dre');
    const mayasNote = await makeNote('maya', { task_id: task });
    expect(await sees('nana', 'notes', mayasNote)).toBe(true);

    await schedule('dre');

    expect(await sees('nana', 'notes', mayasNote)).toBe(false);
  });
});

// ─── what the departing account keeps ──────────────────────────────────────

describe('dre goes on seeing dre, which is what the way back reads', () => {
  it('own profile, own goal, own notes, own cheer, own rollup', async () => {
    const w = await dresWorld();
    await schedule('dre');

    expect(await seesProfileOf('dre', 'dre')).toBe(true);
    expect(await sees('dre', 'tasks', w.task)).toBe(true);
    expect(await sees('dre', 'notes', w.noteOnOwnTask)).toBe(true);
    expect(await sees('dre', 'notes', w.noteToMaya)).toBe(true);
    expect(await sees('dre', 'reactions', w.cheer)).toBe(true);
    expect(await seesRollupOf('dre', 'dre')).toBe(true);
  });

  it('and does not take anybody else down with it', async () => {
    // The failure this guards against is a predicate that is true of the
    // caller rather than of the row's subject, which would empty the app for
    // everyone the moment one person left.
    const mayaTask = await makeTask('maya');
    await schedule('dre');

    expect(await sees('nana', 'tasks', mayaTask)).toBe(true);
    expect(await seesProfileOf('nana', 'maya')).toBe(true);
  });
});

// ─── a scheduled account may not write ─────────────────────────────────────

describe('a scheduled account cannot write', () => {
  it('refuses a new goal, a note and a cheer', async () => {
    // The device is wiped to onboarding, but the session is deliberately left
    // on disk so the way back works — and a session on disk is a bearer token
    // somebody can point at the API directly. This is the difference between
    // an account that is hidden and an account that is being deleted.
    const mayaTask = await makeTask('maya');
    await schedule('dre');

    const task = await asUser('dre').from('tasks').insert({
      owner_id: idOf('dre'),
      circle_id: null,
      week_start: WEEK,
      day: 1,
      title: 'one more',
      category: 'move',
      points: 3,
      aud: 'friends',
    });
    expect(task.error?.code).toBe('42501');

    const note = await asUser('dre')
      .from('notes')
      .insert({ author_id: idOf('dre'), body: 'still here', recipient_id: idOf('maya') });
    expect(note.error?.code).toBe('42501');

    const cheer = await asUser('dre')
      .from('reactions')
      .insert({ actor_id: idOf('dre'), target_type: 'task', target_id: mayaTask, kind: 'cheer' });
    expect(cheer.error?.code).toBe('42501');
  });

  it('and cannot edit a goal it already had', async () => {
    const task = await makeTask('dre');
    await schedule('dre');

    const { error } = await asUser('dre').from('tasks').update({ title: 'renamed' }).eq('id', task);
    expect(error?.code).toBe('42501');
  });
});

// ─── the way back ──────────────────────────────────────────────────────────

describe('cancelling puts everything back', () => {
  it('restores the profile, the goal and the rollup to maya', async () => {
    const w = await dresWorld();
    await schedule('dre');
    expect(await seesProfileOf('maya', 'dre')).toBe(false);

    const { error } = await cancel('dre');
    expect(error).toBeNull();

    expect(await seesProfileOf('maya', 'dre')).toBe(true);
    expect(await sees('maya', 'tasks', w.task)).toBe(true);
    expect(await seesRollupOf('maya', 'dre')).toBe(true);
    expect(await seesMembershipOf('maya', 'dre')).toBe(true);
  });

  it('and lets the account write again', async () => {
    await schedule('dre');
    await cancel('dre');

    const { error } = await asUser('dre').from('tasks').insert({
      owner_id: idOf('dre'),
      circle_id: null,
      week_start: WEEK,
      day: 1,
      title: 'back',
      category: 'move',
      points: 3,
      aud: 'friends',
    });
    expect(error).toBeNull();
  });

  it('is a no-op rather than an error when nothing was scheduled', async () => {
    // The way back is reached from a screen that may have been left open, or
    // opened by somebody who never scheduled anything. The state the caller
    // wants is the state they end up in either way.
    const { error } = await cancel('dre');
    expect(error).toBeNull();
  });
});

// ─── the clock does not restart ────────────────────────────────────────────

describe('scheduling twice', () => {
  it('returns the first timestamp rather than moving it', async () => {
    // The client runs this inline rather than through the outbox, so a flaky
    // connection produces a second call. If a retry extended the window, an
    // account could be kept alive forever by tapping the button once a week.
    const first = await schedule('dre');
    expect(first.error).toBeNull();

    const second = await schedule('dre');
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);
  });
});

// ─── who may call them ─────────────────────────────────────────────────────

describe('the two RPCs', () => {
  it('refuse a caller with no session', async () => {
    // `anon` holds no EXECUTE grant — the revoke-then-grant pair in the
    // migration is the whole defence, and PostgREST reports the missing
    // function rather than the missing privilege.
    const s = await asAnon().rpc('schedule_account_deletion');
    expect(s.error).not.toBeNull();

    const c = await asAnon().rpc('cancel_account_deletion');
    expect(c.error).not.toBeNull();
  });

  it('take no account id, so there is nothing to point at somebody else', async () => {
    // The signature is the authorisation. Asked over `pg` rather than through
    // REST, because "this function has no parameters" is a fact about the
    // catalogue and not something a call can demonstrate.
    const rows = await sql<{ name: string; args: string }>(
      `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('schedule_account_deletion', 'cancel_account_deletion')
        order by p.proname`,
    );

    expect(rows.map((r) => r.name)).toEqual([
      'cancel_account_deletion',
      'schedule_account_deletion',
    ]);
    expect(rows.every((r) => r.args === '')).toBe(true);
  });
});
