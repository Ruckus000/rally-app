/**
 * The transport is only interesting when the server says no, so most of this
 * file is refusals. Each one asks the single question the outbox needs answered:
 * try again, or give up?
 *
 * The double is the strict fake, not a bag of stubs — the 23514 and 22P02 cases
 * below are refused by the same constraints `supabase/migrations/` declares,
 * which is the only way a test about error classification can be trusted.
 */
import type { Audience, Task } from '../../data/fixtures';
import { fakeSupabase } from '../../__mocks__/@supabase/supabase-js';
import { __resetSupabaseForTests } from '../../lib/supabase';
import { supabaseTransport, type WireOp, type Transport } from '../transport';

const ME = '11111111-1111-4111-8111-111111111111';
const SOMEONE_ELSE = '22222222-2222-4222-8222-222222222222';
const WEEK = '2026-08-10';
const AT = Date.parse('2026-08-13T09:30:00.000Z');

let transport: Transport;

const aTask = (over: Partial<Task> = {}): Task => ({
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  day: 3,
  title: 'Read 100 pages',
  cat: 'Mind',
  pts: 30,
  done: false,
  aud: 'private',
  pair: [],
  pairKind: null,
  cmts: [],
  source: 'staked',
  ...over,
});

const upsert = (task: Task = aTask()): WireOp => ({
  id: 'entry-1',
  at: AT,
  op: 'task.upsert',
  task,
  weekStart: WEEK,
});

const remove = (taskId: string): WireOp => ({
  id: 'entry-2',
  at: AT,
  op: 'task.delete',
  taskId,
});

beforeEach(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  fakeSupabase.reset();
  __resetSupabaseForTests();
  fakeSupabase.seed({
    profiles: [
      { id: ME, handle: 'alexr', name: 'Alex Rivera' },
      { id: SOMEONE_ELSE, handle: 'maya', name: 'Maya Chen' },
    ],
  });
  transport = supabaseTransport();
});

describe('push', () => {
  it('writes the task, stamping owner_id from the session', async () => {
    expect(await transport.push(upsert(), ME)).toEqual({ ok: true });

    const [row] = fakeSupabase.rows('tasks');
    expect(row).toMatchObject({
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      owner_id: ME,
      week_start: WEEK,
      day: 3,
      title: 'Read 100 pages',
      points: 30,
      aud: 'private',
      done_at: null,
    });
  });

  it('is a no-op the second time — the id is the idempotency key', async () => {
    await transport.push(upsert(), ME);
    await transport.push(upsert(aTask({ done: true })), ME);

    // One row, carrying the newer value: an at-least-once outbox has to be able
    // to replay an entry without either duplicating it or failing.
    expect(fakeSupabase.rows('tasks')).toHaveLength(1);
    expect(fakeSupabase.rows('tasks')[0].done_at).not.toBeNull();
  });

  it('treats a 23505 on the upsert as already achieved', async () => {
    fakeSupabase.failNext(1, {
      code: '23505',
      message: 'duplicate key value violates unique constraint "tasks_pkey"',
    });

    expect(await transport.push(upsert(), ME)).toEqual({ ok: true });
  });

  it('deletes an absent row without complaint', async () => {
    expect(await transport.push(remove('never-existed'), ME)).toEqual({ ok: true });
  });

  it('deletes a row that is there', async () => {
    await transport.push(upsert(), ME);
    expect(await transport.push(remove(aTask().id), ME)).toEqual({ ok: true });
    expect(fakeSupabase.rows('tasks')).toHaveLength(0);
  });

  it('is retryable when there is no network', async () => {
    fakeSupabase.goOffline();

    const result = await transport.push(upsert(), ME);
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(fakeSupabase.rows('tasks')).toHaveLength(0);
  });

  it('is retryable on a 5xx and on a rate limit', async () => {
    fakeSupabase.failNext(1, { code: '503', message: 'service unavailable' });
    expect(await transport.push(upsert(), ME)).toMatchObject({ ok: false, retryable: true });

    fakeSupabase.failNext(1, { code: '429', message: 'too many requests' });
    expect(await transport.push(upsert(), ME)).toMatchObject({ ok: false, retryable: true });
  });

  it('is retryable when the connection dropped mid-statement — 08006', async () => {
    fakeSupabase.failNext(1, { code: '08006', message: 'connection failure' });
    expect(await transport.push(upsert(), ME)).toMatchObject({ ok: false, retryable: true });
  });

  it('gives up on an RLS refusal — 42501', async () => {
    fakeSupabase.failNext(1, {
      code: '42501',
      message: 'new row violates row-level security policy for table "tasks"',
    });

    expect(await transport.push(upsert(), ME)).toMatchObject({
      ok: false,
      retryable: false,
      code: '42501',
    });
  });

  it('gives up on a check constraint the payload can never satisfy — 23514', async () => {
    const result = await transport.push(upsert(aTask({ title: '   ' })), ME);

    expect(result).toMatchObject({ ok: false, retryable: false, code: '23514' });
    expect(fakeSupabase.rows('tasks')).toHaveLength(0);
  });

  it('gives up on a value outside the enum — 22P02', async () => {
    const result = await transport.push(upsert(aTask({ aud: 'nobody' as Audience })), ME);
    expect(result).toMatchObject({ ok: false, retryable: false, code: '22P02' });
  });

  it('gives up when the owner has no profile row — 23503', async () => {
    const result = await transport.push(upsert(), '33333333-3333-4333-8333-333333333333');
    expect(result).toMatchObject({ ok: false, retryable: false, code: '23503' });
  });

  it('retries a 401 once, after forcing a refresh', async () => {
    fakeSupabase.failNext(1, { code: 'PGRST301', message: 'JWT expired' });

    expect(await transport.push(upsert(), ME)).toEqual({ ok: true });
    expect(fakeSupabase.rows('tasks')).toHaveLength(1);
  });

  it('gives up on a second 401 — a fresh token means the token was not the problem', async () => {
    fakeSupabase.failNext(2, { code: 'PGRST301', message: 'JWT expired' });

    expect(await transport.push(upsert(), ME)).toMatchObject({
      ok: false,
      retryable: false,
      code: 'PGRST301',
    });
    expect(fakeSupabase.rows('tasks')).toHaveLength(0);
  });

  it('never throws, whatever the server does', async () => {
    fakeSupabase.failNext(1, { code: 'PGRST204', message: 'unknown column' });
    await expect(transport.push(upsert(), ME)).resolves.toMatchObject({ ok: false });
  });
});

describe('pullTasks', () => {
  it('returns this user’s tasks for the week, as Tasks', async () => {
    await transport.push(upsert(), ME);
    await transport.push(
      upsert(aTask({ id: 'aaaaaaaa-0000-4000-8000-000000000002', done: true, cat: 'Fitness' })),
      ME,
    );

    const tasks = await transport.pullTasks(ME, WEEK);

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ title: 'Read 100 pages', pts: 30, done: false, cat: 'Mind' });
    expect(tasks[1]).toMatchObject({ done: true, cat: 'Fitness' });
  });

  it('does not return another week, or another owner', async () => {
    await transport.push(upsert(), ME);
    await transport.push(
      {
        id: 'entry-next-week',
        at: AT,
        op: 'task.upsert',
        task: aTask({ id: 'aaaaaaaa-0000-4000-8000-000000000003' }),
        weekStart: '2026-08-17',
      },
      ME,
    );
    await transport.push(
      upsert(aTask({ id: 'aaaaaaaa-0000-4000-8000-000000000004' })),
      SOMEONE_ELSE,
    );

    expect(await transport.pullTasks(ME, WEEK)).toHaveLength(1);
  });

  it('throws with the code when the read is refused', async () => {
    fakeSupabase.failNext(1, { code: '42501', message: 'permission denied for table tasks' });
    await expect(transport.pullTasks(ME, WEEK)).rejects.toThrow('permission denied');
  });
});

describe('pullCircle', () => {
  const CIRCLE = '44444444-4444-4444-8444-444444444444';

  it('returns everyone who shares a circle with you, once each', async () => {
    fakeSupabase.seed({
      circles: [
        { id: CIRCLE, name: 'The Basement', invite_code: 'basement-0123456789abcdef', created_by: ME },
      ],
      circle_members: [
        { circle_id: CIRCLE, profile_id: ME },
        { circle_id: CIRCLE, profile_id: SOMEONE_ELSE },
      ],
    });

    const people = await transport.pullCircle(ME);

    expect(people.map((p) => p.id).sort()).toEqual([ME, SOMEONE_ELSE].sort());
    expect(people.find((p) => p.id === SOMEONE_ELSE)).toMatchObject({
      name: 'Maya Chen',
      first: 'Maya',
      initials: 'MC',
    });
  });

  it('is empty, and asks for no profiles, when you are in no circle', async () => {
    expect(await transport.pullCircle(ME)).toEqual([]);
    expect(fakeSupabase.calls.filter((c) => c.table === 'profiles')).toHaveLength(0);
  });
});
