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
import type { NoteTarget, SyncableNote } from '../notes';
import type { ReactionKind } from '../reactions';
import {
  createCircle,
  isAuthExpired,
  joinCircleByCode,
  supabaseTransport,
  UnknownInviteCode,
  type WireOp,
  type Transport,
} from '../transport';
import { getSupabase, __resetSupabaseForTests } from '../../lib/supabase';

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

const TASK_ID = aTask().id;
const NOTE_ID = 'bbbbbbbb-0000-4000-8000-000000000001';

const cheer = (kind: ReactionKind = 'cheer', targetId: string = TASK_ID): WireOp => ({
  id: 'entry-3',
  at: AT,
  op: 'reaction.add',
  targetId,
  kind,
});

const uncheer = (kind: ReactionKind = 'cheer', targetId: string = TASK_ID): WireOp => ({
  id: 'entry-4',
  at: AT,
  op: 'reaction.remove',
  targetId,
  kind,
});

const note = (over: Partial<SyncableNote> = {}): WireOp => ({
  id: 'entry-5',
  at: AT,
  op: 'note.add',
  note: { id: NOTE_ID, body: 'proud of you', target: { taskId: TASK_ID }, ...over },
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

describe('the circle calls', () => {
  // Both go through SECURITY DEFINER functions, so being signed in is the whole
  // authorisation story — the fake refuses them without a session exactly as
  // the real ones do.
  const signedIn = async () => {
    const { data } = await getSupabase().auth.signInAnonymously();
    return data.session?.user.id as string;
  };

  it('creates a circle and puts the caller in it', async () => {
    const me = await signedIn();

    const { id, inviteCode } = await createCircle('The Basement');

    expect(fakeSupabase.rows('circles')).toHaveLength(1);
    // One call, one transaction: a circle that exists with no members is a
    // state `create_circle` was written to make impossible.
    expect(fakeSupabase.rows('circle_members')).toEqual([
      expect.objectContaining({ circle_id: id, profile_id: me }),
    ]);
    // The entropy the schema insists on — `circles_invite_code_entropy`.
    expect(inviteCode).toMatch(/-[0-9a-f]{16}$/);
  });

  it('joins by code, and is idempotent about it', async () => {
    await signedIn();
    const { id, inviteCode } = await createCircle('The Basement');
    await getSupabase().auth.signOut();
    const other = await signedIn();

    expect(await joinCircleByCode(inviteCode)).toBe(id);
    expect(await joinCircleByCode(inviteCode)).toBe(id);

    const mine = fakeSupabase.rows('circle_members').filter((m) => m.profile_id === other);
    expect(mine).toHaveLength(1);
  });

  it('accepts the code as the field actually produces it — shouted', async () => {
    await signedIn();
    const { id, inviteCode } = await createCircle('The Basement');
    await getSupabase().auth.signOut();
    await signedIn();

    // The input uppercases what you type (`autoCapitalize="characters"`, and the
    // value itself is uppercased), while every generated code is lowercase and
    // the match is exact. Without normalising, a correctly-typed code fails
    // every single time — and `fireEvent.changeText` in the flow tests bypasses
    // the keyboard, so no screen-level test would ever notice.
    expect(await joinCircleByCode(inviteCode.toUpperCase())).toBe(id);
  });

  it('reports a code that names nothing as something the user can fix', async () => {
    await signedIn();

    // Not a generic failure: this is the one error with an obvious next step,
    // and it must stay indistinguishable from "no such circle" so the function
    // cannot be used to enumerate codes.
    await expect(joinCircleByCode('basement-0000000000000000')).rejects.toBeInstanceOf(
      UnknownInviteCode,
    );
  });

  it('does not dress a dead network up as a bad code', async () => {
    await signedIn();
    fakeSupabase.goOffline();

    // Telling someone their code is wrong when the truth is that the radio is
    // off sends them hunting for a typo that isn't there.
    await expect(joinCircleByCode('basement-0000000000000000')).rejects.not.toBeInstanceOf(
      UnknownInviteCode,
    );
  });
});

describe('the profile name', () => {
  const rename = (name = 'Maya Chen'): WireOp => ({
    id: 'entry-6',
    at: AT,
    op: 'profile.update',
    name,
  });

  const profile = (id: string) => fakeSupabase.rows('profiles').find((r) => r.id === id);

  it('writes the name onto the row the session names', async () => {
    expect(await transport.push(rename(), ME)).toEqual({ ok: true });

    // The handle is untouched: it is unique, and rewriting it is a 23505 no
    // retry can clear.
    expect(profile(ME)).toMatchObject({ handle: 'alexr', name: 'Maya Chen' });
  });

  it('never touches anyone else, whatever the payload says', async () => {
    // The payload cannot name its own subject — the id comes from the session.
    // If it ever could, this is the test that would notice.
    await transport.push(rename('Impostor'), SOMEONE_ELSE);

    expect(profile(ME)).toMatchObject({ name: 'Alex Rivera' });
    expect(profile(SOMEONE_ELSE)).toMatchObject({ name: 'Impostor' });
  });

  it('is safe to replay — the second write says the same thing', async () => {
    await transport.push(rename(), ME);
    await transport.push(rename(), ME);

    expect(fakeSupabase.rows('profiles')).toHaveLength(2);
  });

  it('reports a dead connection as retryable rather than losing the rename', async () => {
    fakeSupabase.goOffline();

    expect(await transport.push(rename(), ME)).toMatchObject({ ok: false, retryable: true });
  });
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

  it('says so about its own answer, so the engine reads it the same way twice', async () => {
    fakeSupabase.failNext(2, { code: 'PGRST301', message: 'JWT expired' });
    const result = await transport.push(upsert(), ME);

    // The engine re-reads this result to decide whether the *session* died, and
    // must reach the same verdict the transport already reached from the wire
    // error. A refusal that is merely permanent must not be mistaken for one.
    expect(isAuthExpired(result)).toBe(true);
    expect(isAuthExpired({ code: '23514' })).toBe(false);
  });

  it('recognises the bare 401 it invents when a 401 carries no SQLSTATE', () => {
    // `code: e.code ?? '401'` is this module's own fallback. Not matching it
    // would leave exactly one auth failure — the one with no Postgres error
    // behind it — sliding through as an ordinary permanent refusal, which is
    // the verdict that drops queue entries.
    expect(isAuthExpired({ code: '401' })).toBe(true);
    expect(isAuthExpired({ status: 401 })).toBe(true);
  });
});

describe('reactions', () => {
  it('writes the reaction, stamping actor_id from the session', async () => {
    expect(await transport.push(cheer(), ME)).toEqual({ ok: true });

    expect(fakeSupabase.rows('reactions')[0]).toMatchObject({
      actor_id: ME,
      target_type: 'task',
      target_id: TASK_ID,
      kind: 'cheer',
    });
  });

  it('refuses an actor_id smuggled into the payload', async () => {
    // The type has no room for one, so this is what a shape bug would look
    // like. The row is built from `userId` alone, and the extra field is not
    // even carried to the server to be refused there.
    await transport.push({ ...cheer(), actor_id: SOMEONE_ELSE } as unknown as WireOp, ME);

    expect(fakeSupabase.rows('reactions')).toHaveLength(1);
    expect(fakeSupabase.rows('reactions')[0].actor_id).toBe(ME);
  });

  it('is a success the second time — the unique tuple is the toggle', async () => {
    expect(await transport.push(cheer(), ME)).toEqual({ ok: true });
    expect(await transport.push(cheer(), ME)).toEqual({ ok: true });

    // One cheer, not two and not a failure: a replay of an insert whose whole
    // intent is "this tuple exists" has already achieved it.
    expect(fakeSupabase.rows('reactions')).toHaveLength(1);
  });

  it('treats a 23505 the server did raise as already achieved', async () => {
    fakeSupabase.failNext(1, {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    });
    expect(await transport.push(cheer(), ME)).toEqual({ ok: true });
  });

  it('lets two people cheer the same task, and one person cheer two ways', async () => {
    await transport.push(cheer(), ME);
    await transport.push(cheer(), SOMEONE_ELSE);
    await transport.push(cheer('nod'), ME);

    expect(fakeSupabase.rows('reactions')).toHaveLength(3);
  });

  it('removes a reaction that is not there without complaint', async () => {
    expect(await transport.push(uncheer(), ME)).toEqual({ ok: true });
    expect(fakeSupabase.rows('reactions')).toEqual([]);
  });

  it('removes only this actor’s reaction, of this kind', async () => {
    await transport.push(cheer(), ME);
    await transport.push(cheer('nod'), ME);
    await transport.push(cheer(), SOMEONE_ELSE);

    expect(await transport.push(uncheer(), ME)).toEqual({ ok: true });

    // Matched on the natural key, so the other actor's cheer and this actor's
    // nod both survive — which is the whole reason not to match on an id the
    // client would have had to guess.
    expect(fakeSupabase.rows('reactions')).toHaveLength(2);
    expect(fakeSupabase.rows('reactions').some((r) => r.actor_id === ME && r.kind === 'nod')).toBe(
      true,
    );
  });

  it('gives up on a kind outside the enum — 22P02', async () => {
    const result = await transport.push(cheer('clap' as ReactionKind), ME);
    expect(result).toMatchObject({ ok: false, retryable: false, code: '22P02' });
  });

  it('gives up when the actor has no profile row — 23503', async () => {
    const result = await transport.push(cheer(), '33333333-3333-4333-8333-333333333333');
    expect(result).toMatchObject({ ok: false, retryable: false, code: '23503' });
  });

  it('is retryable when there is no network', async () => {
    fakeSupabase.goOffline();
    expect(await transport.push(cheer(), ME)).toMatchObject({ ok: false, retryable: true });
  });
});

describe('notes', () => {
  beforeEach(async () => {
    // task_id is a foreign key, so the row it names has to exist first.
    await transport.push(upsert(), ME);
  });

  it('writes the note, stamping author_id from the session', async () => {
    expect(await transport.push(note(), ME)).toEqual({ ok: true });

    expect(fakeSupabase.rows('notes')[0]).toMatchObject({
      id: NOTE_ID,
      author_id: ME,
      task_id: TASK_ID,
      recipient_id: null,
      body: 'proud of you',
    });
  });

  it('refuses an author_id smuggled into the payload', async () => {
    await transport.push({ ...note(), author_id: SOMEONE_ELSE } as unknown as WireOp, ME);
    expect(fakeSupabase.rows('notes')[0].author_id).toBe(ME);
  });

  it('writes a note to a person as a recipient, with no task', async () => {
    await transport.push(note({ target: { recipientId: SOMEONE_ELSE } }), ME);

    expect(fakeSupabase.rows('notes')[0]).toMatchObject({
      recipient_id: SOMEONE_ELSE,
      task_id: null,
    });
  });

  it('is a no-op the second time — the client-minted id is the pk', async () => {
    await transport.push(note(), ME);
    expect(await transport.push(note(), ME)).toEqual({ ok: true });

    // Notes are append-only and have no unique tuple to dedupe them, so this
    // pk is the only thing standing between a retry and a second comment on
    // someone's screen.
    expect(fakeSupabase.rows('notes')).toHaveLength(1);
  });

  it('gives up on a blank body — 23514', async () => {
    const result = await transport.push(note({ body: '   ' }), ME);

    expect(result).toMatchObject({ ok: false, retryable: false, code: '23514' });
    expect(fakeSupabase.rows('notes')).toEqual([]);
  });

  it('gives up when the row names both targets — 23514', async () => {
    const both = { taskId: TASK_ID, recipientId: SOMEONE_ELSE } as unknown as NoteTarget;
    const result = await transport.push(note({ target: both }), ME);

    expect(result).toMatchObject({ ok: false, retryable: false, code: '23514' });
    expect(fakeSupabase.rows('notes')).toEqual([]);
  });

  it('gives up when the task it names is gone — 23503', async () => {
    const result = await transport.push(
      note({ target: { taskId: 'cccccccc-0000-4000-8000-000000000009' } }),
      ME,
    );
    expect(result).toMatchObject({ ok: false, retryable: false, code: '23503' });
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

describe('pullReactions', () => {
  it('returns this user’s own reactions, as refs', async () => {
    await transport.push(cheer(), ME);
    await transport.push(cheer('nod'), ME);
    await transport.push(cheer(), SOMEONE_ELSE);

    const mine = await transport.pullReactions(ME);

    // Only mine: `acted` is a record of taps this user made and has nowhere to
    // put anyone else's.
    expect(mine.map((r) => r.kind).sort()).toEqual(['cheer', 'nod']);
    expect(mine.every((r) => r.targetId === TASK_ID)).toBe(true);
  });

  it('ignores a reaction on a post — there is no table behind that id', async () => {
    fakeSupabase.seed({
      reactions: [{ actor_id: ME, target_type: 'post', target_id: TASK_ID, kind: 'cheer' }],
    });
    expect(await transport.pullReactions(ME)).toEqual([]);
  });

  it('throws with the code when the read is refused', async () => {
    fakeSupabase.failNext(1, { code: '42501', message: 'permission denied for table reactions' });
    await expect(transport.pullReactions(ME)).rejects.toThrow('permission denied');
  });
});

describe('pullNotes', () => {
  beforeEach(async () => {
    await transport.push(upsert(), ME);
  });

  it('returns notes on your tasks and notes addressed to you', async () => {
    fakeSupabase.seed({
      notes: [
        { id: NOTE_ID, author_id: SOMEONE_ELSE, task_id: TASK_ID, body: 'go on then' },
        {
          id: 'bbbbbbbb-0000-4000-8000-000000000002',
          author_id: SOMEONE_ELSE,
          recipient_id: ME,
          body: 'week two',
        },
        {
          id: 'bbbbbbbb-0000-4000-8000-000000000003',
          author_id: ME,
          recipient_id: SOMEONE_ELSE,
          body: 'not yours to read back',
        },
      ],
    });

    const notes = await transport.pullNotes(ME);

    expect(notes.map((n) => n.body).sort()).toEqual(['go on then', 'week two']);
    expect(notes.find((n) => n.body === 'go on then')).toMatchObject({
      authorId: SOMEONE_ELSE,
      target: { taskId: TASK_ID },
    });
    expect(notes.find((n) => n.body === 'week two')?.target).toEqual({ recipientId: ME });
  });

  it('asks for no notes on tasks when you have none', async () => {
    const before = fakeSupabase.calls.filter((c) => c.table === 'notes').length;
    await transport.pullNotes(SOMEONE_ELSE);

    // One read, for notes addressed to them. The `in ()` for tasks is skipped
    // rather than sent with an empty list.
    expect(fakeSupabase.calls.filter((c) => c.table === 'notes')).toHaveLength(before + 1);
  });

  it('throws with the code when the read is refused', async () => {
    fakeSupabase.failNext(1, { code: '42501', message: 'permission denied for table tasks' });
    await expect(transport.pullNotes(ME)).rejects.toThrow('permission denied');
  });
});

describe('an entry we cannot even turn into a request', () => {
  it('is permanent, not retryable — otherwise it wedges the queue forever', async () => {
    // A TypeError out of the mappers is indistinguishable from a dead fetch,
    // and the queue is strictly ordered and head-of-line blocking. Classified
    // as retryable, a malformed entry can never succeed and never dies, so
    // every mutation behind it is silently stranded for the life of the
    // install. This is the one case where giving up is the safe answer.
    const result = await supabaseTransport().push(
      { id: 'malformed-1', op: 'task.upsert', task: undefined as never, weekStart: WEEK, at: AT },
      ME,
    );

    expect(result).toEqual(
      expect.objectContaining({ ok: false, retryable: false, code: 'malformed' }),
    );
  });

  it('is permanent for a note with no target too', async () => {
    const result = await supabaseTransport().push(
      { id: 'malformed-2', op: 'note.add', note: undefined as never, at: AT },
      ME,
    );

    expect(result).toMatchObject({ ok: false, retryable: false, code: 'malformed' });
  });
});
