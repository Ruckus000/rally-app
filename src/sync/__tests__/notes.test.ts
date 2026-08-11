/**
 * `SEND_NOTE` has four outcomes and the table has room for two of them. These
 * tests are arranged around that: one describe per branch of the reducer, using
 * the ids those branches actually see — a staked task's uuid, a fixture moment
 * id like `f1`, a global post id like `g1`.
 */
import { noteKey, noteSiteOf, syncableNote } from '../notes';

const TASK = '4d1f0f3a-6c2b-4a0e-9f77-1b2c3d4e5f60';
const PERSON = 'a0000000-0000-4000-8000-000000000001';
const NOTE = 'b0000000-0000-4000-8000-0000000000ff';

const ids = (myTasks: string[] = [], moments: string[] = []) => ({
  myTasks: new Set(myTasks),
  moments: new Set(moments),
});

describe('noteSiteOf', () => {
  it('reads a person sheet as a note to that person', () => {
    expect(noteSiteOf({ type: 'person', id: PERSON }, ids())).toBe('person');
  });

  it('reads a task sheet on one of your own rows as a comment on it', () => {
    expect(noteSiteOf({ type: 'task', id: TASK }, ids([TASK]))).toBe('ownTask');
  });

  it('reads a task sheet on a moment as a comment on someone else’s task', () => {
    expect(noteSiteOf({ type: 'task', id: 'f1' }, ids([], ['f1']))).toBe('moment');
  });

  it('reads an id in neither list as a global post', () => {
    expect(noteSiteOf({ type: 'task', id: 'g1' }, ids([TASK], ['f1']))).toBe('globalPost');
  });

  it('prefers your own task, matching the reducer’s order', () => {
    expect(noteSiteOf({ type: 'task', id: TASK }, ids([TASK], [TASK]))).toBe('ownTask');
  });

  it('has nothing to say about a closed sheet, an id-less one, or an invite', () => {
    expect(noteSiteOf(null, ids())).toBeNull();
    expect(noteSiteOf({ type: 'task', id: null }, ids())).toBeNull();
    expect(noteSiteOf({ type: 'invite', id: PERSON }, ids())).toBeNull();
  });
});

describe('syncableNote', () => {
  it('targets a person note at recipient_id', () => {
    expect(syncableNote({ id: NOTE, site: 'person', targetId: PERSON, body: 'proud of you' })).toEqual(
      { id: NOTE, body: 'proud of you', target: { recipientId: PERSON } },
    );
  });

  it('targets a comment on your own task at task_id', () => {
    expect(syncableNote({ id: NOTE, site: 'ownTask', targetId: TASK, body: 'day three' })).toEqual({
      id: NOTE,
      body: 'day three',
      target: { taskId: TASK },
    });
  });

  it('targets a moment at task_id too — a moment is another member’s task', () => {
    expect(syncableNote({ id: NOTE, site: 'moment', targetId: TASK, body: 'go on' })).toEqual({
      id: NOTE,
      body: 'go on',
      target: { taskId: TASK },
    });
  });

  it('keeps a moment local while moment ids are fixtures', () => {
    expect(syncableNote({ id: NOTE, site: 'moment', targetId: 'f1', body: 'go on' })).toBeNull();
  });

  it('never syncs a global post, even with a uuid — there is no table', () => {
    expect(syncableNote({ id: NOTE, site: 'globalPost', targetId: TASK, body: 'nice' })).toBeNull();
    expect(syncableNote({ id: NOTE, site: 'globalPost', targetId: 'g1', body: 'nice' })).toBeNull();
  });

  it('refuses a body the CHECK would refuse', () => {
    expect(syncableNote({ id: NOTE, site: 'ownTask', targetId: TASK, body: '' })).toBeNull();
    expect(syncableNote({ id: NOTE, site: 'ownTask', targetId: TASK, body: '   \n\t ' })).toBeNull();
  });

  it('trims the body it does send', () => {
    expect(
      syncableNote({ id: NOTE, site: 'ownTask', targetId: TASK, body: '  day three  ' })?.body,
    ).toBe('day three');
  });

  it('refuses a note with no client id, which is every note today', () => {
    expect(syncableNote({ id: '', site: 'ownTask', targetId: TASK, body: 'hi' })).toBeNull();
    expect(syncableNote({ id: 'n1', site: 'ownTask', targetId: TASK, body: 'hi' })).toBeNull();
  });

  it('normalises both uuids to the case Postgres renders', () => {
    expect(
      syncableNote({
        id: NOTE.toUpperCase(),
        site: 'person',
        targetId: PERSON.toUpperCase(),
        body: 'hi',
      }),
    ).toEqual({ id: NOTE, body: 'hi', target: { recipientId: PERSON } });
  });
});

describe('noteKey', () => {
  it('is the row id, because the pk is the only identity a note has', () => {
    const note = syncableNote({ id: NOTE, site: 'ownTask', targetId: TASK, body: 'hi' });
    expect(note && noteKey(note)).toBe(`note:${NOTE}`);
  });

  it('separates two notes on the same task — saying it twice is legitimate', () => {
    const a = syncableNote({ id: NOTE, site: 'ownTask', targetId: TASK, body: 'hi' });
    const b = syncableNote({ id: PERSON, site: 'ownTask', targetId: TASK, body: 'hi' });
    expect(a && noteKey(a)).not.toBe(b && noteKey(b));
  });
});
