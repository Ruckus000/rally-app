/**
 * The fake is only useful if it can say no. These tests pin the refusals to
 * the constraints in `supabase/migrations/`, so a regression in the double is
 * a red test here rather than a green test everywhere else that means nothing.
 *
 * Imported by path rather than by package name because the control surface is
 * the thing under test. Everywhere else, `@supabase/supabase-js` resolves to
 * this same module automatically — the last test in the file proves it.
 */
import { createClient, fakeSupabase } from '../../__mocks__/@supabase/supabase-js';

const URL = 'http://127.0.0.1:55321';
const KEY = 'anon-key';

let db: ReturnType<typeof createClient>;
let me: string;

/** A signed-in anonymous user, with the profile row the trigger would create. */
async function signIn(): Promise<string> {
  const { data } = await db.auth.signInAnonymously();
  if (!data.session) throw new Error('the fake refused to sign in');
  return data.session.user.id;
}

const aTask = (over: Record<string, unknown> = {}) => ({
  owner_id: me,
  week_start: '2026-08-10',
  day: 2,
  title: 'ride to the bridge',
  category: 'move',
  points: 3,
  ...over,
});

beforeEach(async () => {
  fakeSupabase.reset();
  db = createClient(URL, KEY);
  me = await signIn();
});

describe('the fake refuses what Postgres would refuse', () => {
  it('rejects a second identical reaction — 23505', async () => {
    const target = { actor_id: me, target_type: 'task', target_id: me, kind: 'cheer' };

    const first = await db.from('reactions').insert(target);
    expect(first.error).toBeNull();

    const { error } = await db.from('reactions').insert(target);
    expect(error?.code).toBe('23505');
    expect(error?.message).toContain('reactions_actor_id_target_type_target_id_kind_key');
    expect(fakeSupabase.rows('reactions')).toHaveLength(1);
  });

  it('lets the same actor cheer two different targets', async () => {
    const { error } = await db.from('reactions').insert([
      { actor_id: me, target_type: 'task', target_id: me, kind: 'cheer' },
      { actor_id: me, target_type: 'post', target_id: me, kind: 'cheer' },
    ]);
    expect(error).toBeNull();
    expect(fakeSupabase.rows('reactions')).toHaveLength(2);
  });

  it('rejects a day outside 0..6 — 23514', async () => {
    const { data, error } = await db.from('tasks').insert(aTask({ day: 7 })).select();
    expect(data).toBeNull();
    expect(error?.code).toBe('23514');
    expect(error?.message).toContain('tasks_day_check');
  });

  it('rejects a blank title — 23514', async () => {
    const { error } = await db.from('tasks').insert(aTask({ title: '   \n' }));
    expect(error?.code).toBe('23514');
    expect(error?.message).toContain('tasks_title_check');
    expect(fakeSupabase.rows('tasks')).toHaveLength(0);
  });

  it('rejects a note with two targets, or none — notes_exactly_one_target', async () => {
    const { data: task } = await db.from('tasks').insert(aTask()).select().single();

    const both = await db
      .from('notes')
      .insert({ author_id: me, task_id: task?.id, recipient_id: me, body: 'nice' });
    expect(both.error?.code).toBe('23514');
    expect(both.error?.message).toContain('notes_exactly_one_target');

    const neither = await db.from('notes').insert({ author_id: me, body: 'nice' });
    expect(neither.error?.code).toBe('23514');
    expect(neither.error?.message).toContain('notes_exactly_one_target');

    const one = await db.from('notes').insert({ author_id: me, task_id: task?.id, body: 'nice' });
    expect(one.error).toBeNull();
  });

  it('rejects an owner who does not exist — 23503', async () => {
    const stranger = '11111111-1111-4111-8111-111111111111';
    const { error } = await db.from('tasks').insert(aTask({ owner_id: stranger }));
    expect(error?.code).toBe('23503');
    expect(error?.message).toContain('tasks_owner_id_fkey');
    expect(error?.details).toContain('is not present in table "profiles"');
  });

  it('rejects a value outside an enum — 22P02', async () => {
    const { error } = await db.from('tasks').insert(aTask({ aud: 'loud' }));
    expect(error?.code).toBe('22P02');
    expect(error?.message).toBe('invalid input value for enum audience: "loud"');
  });

  it('refuses single() on zero rows, and on more than one — PGRST116', async () => {
    await db.from('tasks').insert([aTask(), aTask({ title: 'second' })]);

    const none = await db.from('tasks').select('*').eq('day', 5).single();
    expect(none.data).toBeNull();
    expect(none.error?.code).toBe('PGRST116');
    expect(none.error?.details).toBe('The result contains 0 rows');

    const two = await db.from('tasks').select('*').eq('day', 2).single();
    expect(two.error?.code).toBe('PGRST116');
    expect(two.error?.details).toBe('The result contains 2 rows');
  });

  it('lets maybeSingle() see nothing, but not two things', async () => {
    const none = await db.from('tasks').select('*').eq('day', 5).maybeSingle();
    expect(none).toEqual({ data: null, error: null });

    await db.from('tasks').insert([aTask(), aTask({ title: 'second' })]);
    const two = await db.from('tasks').select('*').eq('day', 2).maybeSingle();
    expect(two.error?.code).toBe('PGRST116');
  });

  it('carries its refusals through an update, not only an insert', async () => {
    const { data: task } = await db.from('tasks').insert(aTask()).select().single();

    const { error } = await db.from('tasks').update({ day: -1 }).eq('id', task?.id);
    expect(error?.code).toBe('23514');
    expect(fakeSupabase.rows('tasks')[0].day).toBe(2);
  });

  it('never throws on a refusal — the envelope is the contract', async () => {
    await expect(db.from('tasks').insert(aTask({ points: -5 }))).resolves.toMatchObject({
      data: null,
      error: { code: '23514' },
    });
  });
});

describe('what it does not model, it says so out loud', () => {
  it('throws on channel() rather than pretending realtime works', () => {
    expect(() => db.channel('week')).toThrow(/realtime is not mocked/);
  });

  it('throws on an embedded select', () => {
    expect(() => db.from('tasks').select('*, profiles(name)')).toThrow(/embedded selects/);
  });

  it('models no row level security at all', async () => {
    // Written down as a test so the boundary is impossible to miss: a second
    // client sees the first one's rows. Anything named "cannot see" belongs in
    // integration/, where a real Postgres decides.
    const other = createClient(URL, KEY);
    const { data } = await db.from('tasks').insert(aTask({ aud: 'private' })).select();
    expect(data).toHaveLength(1);

    const seen = await other.from('tasks').select('*');
    expect(seen.data).toHaveLength(1);
  });
});

describe('the failure controls', () => {
  it('goOffline() rejects with a network error rather than an { error } envelope', async () => {
    fakeSupabase.goOffline();

    await expect(db.from('tasks').select('*')).rejects.toThrow(TypeError);
    await expect(db.from('tasks').select('*')).rejects.toThrow('Network request failed');
    await expect(db.rpc('create_circle', { circle_name: 'The Basement' })).rejects.toThrow(
      TypeError,
    );
    await expect(db.auth.signInAnonymously()).rejects.toThrow('Network request failed');

    fakeSupabase.goOnline();
    await expect(db.from('tasks').select('*')).resolves.toEqual({ data: [], error: null });
  });

  it('failNext(n) fails exactly n requests and leaves the data alone', async () => {
    fakeSupabase.failNext(2, { code: '08006', message: 'connection failure' });

    const a = await db.from('tasks').insert(aTask());
    const b = await db.from('tasks').insert(aTask());
    const c = await db.from('tasks').insert(aTask());

    expect(a.error?.code).toBe('08006');
    expect(b.error?.code).toBe('08006');
    expect(c.error).toBeNull();
    expect(fakeSupabase.rows('tasks')).toHaveLength(1);
  });

  it('reproduces the 422 when anonymous sign-in is turned off', async () => {
    fakeSupabase.setAnonymousDisabled(true);

    const { data, error } = await db.auth.signInAnonymously();
    expect(data.session).toBeNull();
    expect(error).toMatchObject({ status: 422, code: 'anonymous_provider_disabled' });
  });
});

describe('the parts that have to work', () => {
  it('logs every call as { method, table, body }', async () => {
    fakeSupabase.reset();
    const client = createClient(URL, KEY);
    expect(fakeSupabase.calls).toEqual([]);

    await client.auth.signInAnonymously();
    await client.from('tasks').select('*').eq('day', 1);

    expect(fakeSupabase.calls).toEqual([
      { method: 'auth.signInAnonymously', table: null, body: null },
      { method: 'select', table: 'tasks', body: null },
    ]);
  });

  it('creates the profile row that the auth trigger creates', () => {
    expect(fakeSupabase.rows('profiles')).toEqual([
      expect.objectContaining({ id: me, name: 'Someone' }),
    ]);
  });

  it('orders, limits and filters', async () => {
    await db.from('tasks').insert([
      aTask({ title: 'c', day: 5 }),
      aTask({ title: 'a', day: 1 }),
      aTask({ title: 'b', day: 3 }),
    ]);

    const { data } = await db
      .from('tasks')
      .select('title')
      .in('day', [1, 5])
      .order('day', { ascending: false })
      .limit(1);

    expect(data).toEqual([{ title: 'c' }]);
  });

  it('upserts on a conflict target instead of duplicating', async () => {
    await db.from('week_rollups').upsert({ profile_id: me, week_start: '2026-08-10', points: 3 });
    await db.from('week_rollups').upsert({ profile_id: me, week_start: '2026-08-10', points: 9 });

    const rows = fakeSupabase.rows('week_rollups');
    expect(rows).toHaveLength(1);
    expect(rows[0].points).toBe(9);
  });

  it('runs the two RPCs the schema actually exposes', async () => {
    const created = await db.rpc('create_circle', { circle_name: 'The Basement' });
    const [circle] = created.data as { id: string; invite_code: string }[];
    expect(circle.invite_code).toMatch(/^the-basement-[0-9a-f]{16}$/);

    const joined = await db.rpc('join_circle_by_code', { code: circle.invite_code });
    expect(joined.data).toBe(circle.id);

    const wrong = await db.rpc('join_circle_by_code', { code: 'nope-0000000000000000' });
    expect(wrong.error?.code).toBe('P0002');
    expect(wrong.error?.message).toBe('invalid invite code');
  });

  it('deletes only what the filter matched', async () => {
    await db.from('tasks').insert([aTask({ day: 1 }), aTask({ day: 2 })]);
    const { error } = await db.from('tasks').delete().eq('day', 1);

    expect(error).toBeNull();
    expect(fakeSupabase.rows('tasks').map((r) => r.day)).toEqual([2]);
  });

  it('is what @supabase/supabase-js resolves to in a unit test', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const auto = require('@supabase/supabase-js');
    expect(auto.createClient).toBe(createClient);
  });
});
