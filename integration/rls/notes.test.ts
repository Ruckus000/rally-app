/**
 * notes: a word on a task, or a word to a person. Never both.
 *
 * The reach of a note is borrowed, not declared — a note on a task is seen by
 * exactly whoever can see the task, so widening `tasks_select` widens this
 * too. That is the point of the table-driven visibility cases below: they read
 * the audience model back out through a second table.
 */
import { asAnon, asService, asUser, idOf } from '../support/clients';
import { asRole } from '../support/reset';
import { CIRCLE_IDS, type SeedHandle } from '../fixtures/world';

/** A Monday, as `tasks.week_start` requires. */
const WEEK = '2026-08-10';

type Audience = 'friends' | 'everyone' | 'private';

/** Setup only — `asService` bypasses RLS, so nothing here is ever the subject. */
async function makeTask(
  owner: SeedHandle,
  aud: Audience,
  circle: string | null = CIRCLE_IDS.basement,
): Promise<string> {
  const { data, error } = await asService()
    .from('tasks')
    .insert({
      owner_id: idOf(owner),
      circle_id: circle,
      week_start: WEEK,
      day: 0,
      title: `${owner}: ${aud} stake`,
      category: 'move',
      points: 3,
      aud,
    })
    .select('id')
    .single();

  expect(error).toBeNull();
  return (data as { id: string }).id;
}

async function seedNote(author: SeedHandle, target: { task_id?: string; recipient_id?: string }) {
  const { data, error } = await asService()
    .from('notes')
    .insert({ author_id: idOf(author), body: 'proud of you', ...target })
    .select('id')
    .single();

  expect(error).toBeNull();
  return (data as { id: string }).id;
}

/** Does this person's own client return the note? Not "does the row exist". */
async function canSee(who: SeedHandle, noteId: string): Promise<boolean> {
  const { data, error } = await asUser(who).from('notes').select('id').eq('id', noteId);
  expect(error).toBeNull();
  return (data ?? []).length === 1;
}

describe('a note on a task is seen by whoever can see the task', () => {
  it('the author always sees the note they wrote', async () => {
    const task = await makeTask('maya', 'private');
    const note = await seedNote('maya', { task_id: task });

    expect(await canSee('maya', note)).toBe(true);
  });

  it('a circle-mate sees a note on a friends task', async () => {
    const task = await makeTask('maya', 'friends');
    const note = await seedNote('maya', { task_id: task });

    expect(await canSee('dre', note)).toBe(true);
  });

  it('sofia sees no note on a basement task, because she is not in basement', async () => {
    // This asserted the opposite until
    // `20260831210000_a_goal_belongs_to_a_circle.sql`, and said what would
    // change it: "if that predicate is ever narrowed to the task's own circle,
    // this is the test that says notes moved with it." It did, and they did.
    //
    // Worth being clear about what this proves. `notes_select` was not
    // touched by that migration — it delegates to `private.can_see_task`, and
    // rewriting the five policies that delegate would have been the exact
    // mistake this repo has a rule about. So this line inverting is the
    // evidence that the inheritance works.
    const task = await makeTask('maya', 'friends');
    const note = await seedNote('maya', { task_id: task });

    expect(await canSee('sofia', note)).toBe(false);
  });

  it('a stranger sees nothing on a friends task', async () => {
    const task = await makeTask('maya', 'friends');
    const note = await seedNote('maya', { task_id: task });

    expect(await canSee('jordan', note)).toBe(false);
  });

  it('everyone means everyone, including someone who shares no circle', async () => {
    const task = await makeTask('maya', 'everyone');
    const note = await seedNote('maya', { task_id: task });

    expect(await canSee('tomas', note)).toBe(true);
  });

  it('a circle-mate cannot see a note on mayas private task', async () => {
    // dre shares basement with maya and the task is filed there, but 'private'
    // narrows the audience to the owner and her pairs. The note inherits that.
    const task = await makeTask('maya', 'private');
    const note = await seedNote('maya', { task_id: task });

    expect(await canSee('dre', note)).toBe(false);
  });

  it('being paired on a private task is enough to see notes on it', async () => {
    const task = await makeTask('maya', 'private');
    await asService().from('task_pairs').insert({ task_id: task, profile_id: idOf('tomas') });
    const note = await seedNote('maya', { task_id: task });

    // tomas shares no circle with maya at all; the pair row is the only path.
    expect(await canSee('tomas', note)).toBe(true);
  });

  it('a stranger sees nothing on a private task', async () => {
    const task = await makeTask('maya', 'private');
    const note = await seedNote('maya', { task_id: task });

    expect(await canSee('jordan', note)).toBe(false);
  });
});

describe('a note addressed to a person', () => {
  it('the recipient sees a note addressed to them', async () => {
    const note = await seedNote('maya', { recipient_id: idOf('dre') });

    expect(await canSee('dre', note)).toBe(true);
  });

  it('the author still sees the note they addressed', async () => {
    const note = await seedNote('maya', { recipient_id: idOf('dre') });

    expect(await canSee('maya', note)).toBe(true);
  });

  it('a third circle-mate does not see a note addressed to someone else', async () => {
    // nana is in basement with both of them. An addressed note is a private
    // channel, not circle traffic — sharing a circle grants nothing here.
    const note = await seedNote('maya', { recipient_id: idOf('dre') });

    expect(await canSee('nana', note)).toBe(false);
  });

  it('a stranger does not see a note addressed to someone else', async () => {
    const note = await seedNote('maya', { recipient_id: idOf('dre') });

    expect(await canSee('jordan', note)).toBe(false);
  });

  it('cannot be addressed to someone you share no circle with', async () => {
    // notes_insert used to check authorship and nothing else, so any of the
    // anonymous accounts anyone can mint could write to any profile id. In an
    // app whose whole premise is a small closed circle, that is unsolicited
    // messaging from strangers.
    const { error } = await asUser('maya')
      .from('notes')
      .insert({ author_id: idOf('maya'), recipient_id: idOf('jordan'), body: 'hello' });

    expect(error?.code).toBe('42501');
  });

  it('can still be addressed to someone you do share a circle with', async () => {
    const { error } = await asUser('maya')
      .from('notes')
      .insert({ author_id: idOf('maya'), recipient_id: idOf('dre'), body: 'hello' });

    expect(error).toBeNull();
  });

  it('can always be addressed to yourself', async () => {
    const { error } = await asUser('jordan')
      .from('notes')
      .insert({ author_id: idOf('jordan'), recipient_id: idOf('jordan'), body: 'note to self' });

    expect(error).toBeNull();
  });

  it('is bounded in length', async () => {
    const { error } = await asUser('maya')
      .from('notes')
      .insert({ author_id: idOf('maya'), recipient_id: idOf('dre'), body: 'a'.repeat(2001) });

    expect(error?.code).toBe('23514');
  });
});

describe('exactly one target', () => {
  it('rejects a note with neither a task nor a recipient', async () => {
    const { error } = await asUser('maya')
      .from('notes')
      .insert({ author_id: idOf('maya'), body: 'floating in space' });

    // The exactly-one-target CHECK would also refuse this, but the insert
    // policy now gets there first: a note with no target is addressed to
    // nobody, so there is nothing for it to be allowed against.
    expect(error?.code).toBe('42501');
  });

  it('rejects a note that names both a task and a recipient', async () => {
    const task = await makeTask('maya', 'friends');
    const { error } = await asUser('maya')
      .from('notes')
      .insert({ author_id: idOf('maya'), task_id: task, recipient_id: idOf('dre'), body: 'both' });

    expect(error?.code).toBe('23514');
  });

  it('accepts a note with only a task', async () => {
    const task = await makeTask('maya', 'friends');
    const { error } = await asUser('maya')
      .from('notes')
      .insert({ author_id: idOf('maya'), task_id: task, body: 'nice one' });

    expect(error).toBeNull();
  });

  it('accepts a note with only a recipient', async () => {
    const { error } = await asUser('maya')
      .from('notes')
      .insert({ author_id: idOf('maya'), recipient_id: idOf('dre'), body: 'nice one' });

    expect(error).toBeNull();
  });
});

describe('a note must carry words', () => {
  it.each([
    ['empty', ''],
    ['a single space', ' '],
    ['tabs and newlines', '\t\n  '],
  ])('rejects a body that is %s', async (_label, body) => {
    const { error } = await asUser('maya')
      .from('notes')
      .insert({ author_id: idOf('maya'), recipient_id: idOf('dre'), body });

    expect(error?.code).toBe('23514');
  });

  it('accepts a body that is only padded with whitespace', async () => {
    // The check trims before measuring, so surrounding space is fine; the
    // database does not normalise the stored value.
    const { data, error } = await asUser('maya')
      .from('notes')
      .insert({ author_id: idOf('maya'), recipient_id: idOf('dre'), body: '  good week  ' })
      .select('body')
      .single();

    expect(error).toBeNull();
    expect(data?.body).toBe('  good week  ');
  });
});

describe('authorship cannot be forged', () => {
  it('dre cannot write a note signed by maya', async () => {
    const { error } = await asUser('dre')
      .from('notes')
      .insert({ author_id: idOf('maya'), recipient_id: idOf('nana'), body: 'not from maya' });

    // An INSERT refused by RLS *is* 42501, unlike an update or delete.
    expect(error?.code).toBe('42501');
  });

  it('leaves no row behind after a forged insert', async () => {
    await asUser('dre')
      .from('notes')
      .insert({ author_id: idOf('maya'), recipient_id: idOf('nana'), body: 'not from maya' });

    const { data } = await asService().from('notes').select('id');
    expect(data).toEqual([]);
  });

  it('a signed-out client cannot read notes at all', async () => {
    // `anon` holds no grant on the table, so this is refused before RLS is
    // consulted — stronger than "zero rows".
    const { error } = await asAnon().from('notes').select('id');
    expect(error?.code).toBe('42501');
  });
});

describe('notes are immutable by design', () => {
  // A note is a thing someone said. The product has no edit and no delete
  // affordance — a cheer is withdrawn by removing the reaction, not by
  // rewriting the words. So the absence of an UPDATE and a DELETE policy is a
  // decision, and the grants in the repair migration back it: `authenticated`
  // holds only SELECT and INSERT on notes. These tests exist so that adding
  // either one later is a deliberate act that breaks a named expectation.

  it('grants authenticated neither UPDATE nor DELETE on notes', async () => {
    const update = await asRole('authenticated', `update public.notes set body = 'edited'`);
    const remove = await asRole('authenticated', 'delete from public.notes');

    expect(update.error).toBe('42501');
    expect(remove.error).toBe('42501');
  });

  it('grants authenticated SELECT and INSERT, which is what the client needs', async () => {
    const read = await asRole('authenticated', 'select id from public.notes');
    expect(read.error).toBeUndefined();
  });

  it('the author cannot edit their own note', async () => {
    const note = await seedNote('maya', { recipient_id: idOf('dre') });

    const { data } = await asUser('maya')
      .from('notes')
      .update({ body: 'second thoughts' })
      .eq('id', note)
      .select();

    expect(data ?? []).toEqual([]);

    const { data: after } = await asService().from('notes').select('body').eq('id', note).single();
    expect(after?.body).toBe('proud of you');
  });

  it('the author cannot delete their own note', async () => {
    const note = await seedNote('maya', { recipient_id: idOf('dre') });

    const { data } = await asUser('maya').from('notes').delete().eq('id', note).select();

    expect(data ?? []).toEqual([]);

    const { data: after } = await asService().from('notes').select('id').eq('id', note);
    expect(after).toHaveLength(1);
  });

  it('a recipient cannot delete a note written about them', async () => {
    const note = await seedNote('maya', { recipient_id: idOf('dre') });

    await asUser('dre').from('notes').delete().eq('id', note);

    const { data: after } = await asService().from('notes').select('id').eq('id', note);
    expect(after).toHaveLength(1);
  });
});

describe('a note cannot outlive what it hangs off', () => {
  it('disappears when its task is deleted', async () => {
    // `on delete cascade` on notes.task_id — deleting a stake takes its
    // conversation with it, which is why no client-side cleanup exists.
    const task = await makeTask('maya', 'friends');
    const note = await seedNote('maya', { task_id: task });

    await asUser('maya').from('tasks').delete().eq('id', task);

    const { data } = await asService().from('notes').select('id').eq('id', note);
    expect(data).toEqual([]);
  });

  it('cannot be attached to a task that does not exist', async () => {
    const { error } = await asUser('maya').from('notes').insert({
      author_id: idOf('maya'),
      task_id: '44444444-4444-4444-8444-444444444444',
      body: 'into the void',
    });

    // The foreign key would catch this too, but can_see_task answers first —
    // a task that does not exist is one you cannot see. Either way it never
    // lands; the code says which layer refused.
    expect(error?.code).toBe('42501');
  });
});
