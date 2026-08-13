/**
 * Oz bots: accounts that are openly not people.
 *
 * Two rules, and this file is both of them. A bot's profile is readable by
 * anyone signed in — which is the only way a feed of strangers can render a
 * name instead of "Someone" — and a bot may cheer a public task through one
 * function that a job cannot talk its way past.
 *
 * The negatives carry the weight here. A policy widened for one kind of row is
 * a policy that can be opened for every row by accident, and the difference is
 * invisible until someone reads a stranger's circle.
 */
import { asAnon, asService, asUser, idOf, signInAnonymously } from '../support/clients';
import { CIRCLE_IDS, SEED_BOT, SEED_USERS, type SeedHandle } from '../fixtures/world';

const MONDAY = '2026-08-10';

type Aud = 'friends' | 'everyone' | 'private';

async function stake(owner: SeedHandle, aud: Aud): Promise<string> {
  const { data, error } = await asService()
    .from('tasks')
    .insert({
      owner_id: idOf(owner),
      circle_id: CIRCLE_IDS.basement,
      week_start: MONDAY,
      day: 0,
      title: 'stake something',
      category: 'move',
      points: 3,
      aud,
      source: 'staked',
    })
    .select('id')
    .single();

  expect(error).toBeNull();
  return (data as { id: string }).id;
}

const cheerAsBot = (target: string, bot: string = SEED_BOT.id) =>
  asService().rpc('bot_cheer', { bot, target });

describe('a bot profile is readable by anyone', () => {
  it('reaches an account that shares nothing with anybody', async () => {
    // A brand-new anonymous account is in no circle at all — the state every
    // user is in for the whole of onboarding, and the state the global feed
    // has to render something in.
    const { client } = await signInAnonymously();
    const { data, error } = await client.from('profiles').select('handle,name,is_bot');

    expect(error).toBeNull();
    const rows = (data ?? []) as { handle: string; name: string; is_bot: boolean }[];
    const bot = rows.find((r) => r.handle === SEED_BOT.handle);
    expect(bot?.name).toBe(SEED_BOT.name);
    expect(bot?.is_bot).toBe(true);
  });

  /**
   * The control, and the reason the policy names `is_bot` rather than saying
   * "anyone with a public task". Without this, widening the read and opening
   * it look identical from the passing test above.
   */
  it('and nothing else — a stranger gets the bot and their own row, full stop', async () => {
    const { client, id } = await signInAnonymously();
    const { data } = await client.from('profiles').select('id,handle');

    const rows = (data ?? []) as { id: string; handle: string }[];
    // Seven seeded people are in this database and none of them share a circle
    // with a brand-new account. If any of them appear here, the policy was
    // opened rather than widened.
    const others = rows.filter((r) => r.id !== id).map((r) => r.handle);
    expect(others).toEqual([SEED_BOT.handle]);
  });

  it('a signed-out client still cannot reach the table at all', async () => {
    // Widening a policy must not be mistaken for granting the table. `anon`
    // holds no privilege on `profiles`, so it is refused before RLS is asked.
    const { error } = await asAnon().from('profiles').select('handle');
    expect(error?.code).toBe('42501');
  });
});

describe('nobody may promote themselves', () => {
  it('cannot set is_bot on its own row', async () => {
    // The prize is real: a bot profile is published to every account on the
    // service, so this is the row you would edit to be read by strangers.
    const { error } = await asUser('nana')
      .from('profiles')
      .update({ is_bot: true })
      .eq('id', idOf('nana'));

    // A column privilege, not a policy — refused outright rather than matching
    // zero rows, which is what an RLS refusal on UPDATE looks like.
    expect(error?.code).toBe('42501');
  });

  it('can still rename itself, which is the grant that had to survive', async () => {
    const { data, error } = await asUser('nana')
      .from('profiles')
      .update({ name: 'Nana R.' })
      .eq('id', idOf('nana'))
      .select();

    expect(error).toBeNull();
    expect(data?.[0]?.name).toBe('Nana R.');

    await asUser('nana')
      .from('profiles')
      .update({ name: SEED_USERS.nana.name })
      .eq('id', idOf('nana'));
  });

  it('cannot change its own handle either', async () => {
    const { error } = await asUser('nana')
      .from('profiles')
      .update({ handle: 'nana2' })
      .eq('id', idOf('nana'));

    expect(error?.code).toBe('42501');
  });
});

describe('bot_cheer', () => {
  it('is not callable by a signed-in person', async () => {
    // Postgres grants EXECUTE to PUBLIC on every new function, so this is the
    // assertion that the revoke actually ran. A human calling it would be
    // writing a reaction under someone else's name.
    const task = await stake('maya', 'everyone');
    const { error } = await asUser('dre').rpc('bot_cheer', { bot: SEED_BOT.id, target: task });
    expect(error?.code).toBe('42501');
  });

  it('cheers a public task', async () => {
    const task = await stake('maya', 'everyone');
    const { error } = await cheerAsBot(task);
    expect(error).toBeNull();

    const { data } = await asUser('maya')
      .from('reactions')
      .select('actor_id,kind')
      .eq('target_id', task);
    expect(data).toEqual([{ actor_id: SEED_BOT.id, kind: 'cheer' }]);
  });

  it('refuses a task the audience model keeps private', async () => {
    // The job runs as service_role and so bypasses RLS entirely. This is the
    // rule it is not trusted with: without it, a bug in a scheduled script
    // tells someone a stranger read their private task.
    const task = await stake('maya', 'private');
    const { error } = await cheerAsBot(task);
    expect(error?.code).toBe('23514');

    const { count } = await asService()
      .from('reactions')
      .select('id', { count: 'exact', head: true })
      .eq('target_id', task);
    expect(count).toBe(0);
  });

  it('refuses a circle-only task too', async () => {
    const task = await stake('maya', 'friends');
    const { error } = await cheerAsBot(task);
    expect(error?.code).toBe('23514');
  });

  it('refuses an actor that is not a bot', async () => {
    // Otherwise it is a way to write a reaction as anybody at all.
    const task = await stake('maya', 'everyone');
    const { error } = await cheerAsBot(task, idOf('dre'));
    expect(error?.code).toBe('23514');
  });

  it('running twice is not an error, because a schedule runs twice', async () => {
    const task = await stake('maya', 'everyone');
    expect((await cheerAsBot(task)).error).toBeNull();
    expect((await cheerAsBot(task)).error).toBeNull();

    const { count } = await asService()
      .from('reactions')
      .select('id', { count: 'exact', head: true })
      .eq('target_id', task);
    expect(count).toBe(1);
  });

  it('lands in the owner’s bell with the bot’s name on it', async () => {
    // The cheer trigger is unchanged; what is new is that the actor is
    // fictional. The name is carried in the payload, so the row reads
    // correctly for an owner who shares no circle with it.
    const task = await stake('maya', 'everyone');
    await cheerAsBot(task);

    const { data } = await asUser('maya')
      .from('notifications')
      .select('kind,payload')
      .eq('recipient_id', idOf('maya'));

    const rows = (data ?? []) as { kind: string; payload: Record<string, string> }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('cheer');
    expect(rows[0].payload.actor_name).toBe(SEED_BOT.name);
    expect(rows[0].payload.task_id).toBe(task);
  });

  it('withdrawing it takes the notification with it', async () => {
    const task = await stake('maya', 'everyone');
    await cheerAsBot(task);
    await asService().from('reactions').delete().eq('target_id', task);

    const { count } = await asService()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', idOf('maya'));
    expect(count).toBe(0);
  });
});
