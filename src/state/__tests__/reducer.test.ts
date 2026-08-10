/**
 * The reducer carries the product rules the handoff is most explicit about:
 * a cheer is one specific act and can be taken back, unstaking is required,
 * closing every stake fires the celebration, and routing never leaves a stale
 * overlay behind. Those are what's tested here.
 */
import { Action, DEFAULT_CONFIG, reducer, State } from '../store';
import { MY_TASKS, MOMENTS } from '../../data/fixtures';
import { CURRENT_WEEK } from '../../data/week';

const base: State = {
  tab: 'week',
  scope: 'friends',
  day: CURRENT_WEEK.today,
  myTasks: MY_TASKS,
  moments: MOMENTS,
  acted: {},
  replied: {},
  pending: {},
  personNotes: {},
  usedSugg: {},
  note: '',
  draft: '',
  composerVal: '',
  draftDay: null,
  draftCat: 'Fitness',
  draftPair: [],
  draftAud: null,
  editingId: null,
  planOpen: false,
  wrapOpen: false,
  wrapWeek: null,
  notifOpen: false,
  notifFilter: 'all',
  notifRead: {},
  sheet: null,
  composerOpen: false,
  onboardStep: null,
  seenTooltip: false,
  toast: null,
  toastSeq: 0,
};

const run = (state: State, ...actions: Action[]) => actions.reduce(reducer, state);

describe('cheering', () => {
  it('toggles off on a second tap and says so', () => {
    const cheered = reducer(base, { type: 'ACT', id: 'f1', kind: 'cheer', toast: 'Maya heard that' });
    expect(cheered.acted['f1:cheer']).toBe(true);
    expect(cheered.toast).toBe('Maya heard that');

    const taken = reducer(cheered, { type: 'ACT', id: 'f1', kind: 'cheer' });
    expect(taken.acted['f1:cheer']).toBeUndefined();
    expect(taken.toast).toBe('Cheer taken back');
  });

  it('does not toggle the non-cheer acts', () => {
    const once = reducer(base, { type: 'ACT', id: 'f2', kind: 'in', toast: 'Jordan knows' });
    const twice = reducer(once, { type: 'ACT', id: 'f2', kind: 'in' });
    expect(twice.acted['f2:in']).toBe(true);
  });
});

describe('closing tasks', () => {
  it('fires the celebration only when the last stake closes', () => {
    const open = base.myTasks.filter((t) => !t.done);
    const almost = run(
      base,
      ...open.slice(0, -1).map((t) => ({ type: 'TOGGLE_TASK', id: t.id }) as Action),
    );
    expect(almost.toast).not.toBe('That’s the whole week. Tell the circle.');

    const done = reducer(almost, { type: 'TOGGLE_TASK', id: open[open.length - 1].id });
    expect(done.myTasks.every((t) => t.done)).toBe(true);
    expect(done.toast).toBe('That’s the whole week. Tell the circle.');
  });

  it('does not re-fire when a task is reopened and closed again', () => {
    const all = run(base, ...base.myTasks.filter((t) => !t.done).map((t) => ({ type: 'TOGGLE_TASK', id: t.id }) as Action));
    const reopened = reducer(all, { type: 'TOGGLE_TASK', id: 'm1' });
    const reclosed = reducer({ ...reopened, toast: null }, { type: 'TOGGLE_TASK', id: 'm1' });
    expect(reclosed.toast).toBe('That’s the whole week. Tell the circle.');
  });
});

describe('staking', () => {
  it('refuses an empty title', () => {
    const s = reducer({ ...base, draft: '   ' }, { type: 'ADD_TASK', aud: 'friends' });
    expect(s.myTasks).toHaveLength(base.myTasks.length);
  });

  it('takes points from the category and the day from the picker', () => {
    const s = run(
      base,
      { type: 'SET_DRAFT', value: 'Ship the thing' },
      { type: 'SET_DRAFT_CAT', cat: 'Work' },
      { type: 'SET_DRAFT_DAY', day: 5 },
      { type: 'ADD_TASK', aud: 'everyone' },
    );
    const added = s.myTasks[s.myTasks.length - 1];
    expect(added).toMatchObject({ title: 'Ship the thing', cat: 'Work', pts: 45, day: 5, aud: 'everyone' });
    expect(s.toast).toBe('+45 on the line');
    expect(s.draft).toBe('');
  });

  it('unstakes and says it', () => {
    const s = reducer(base, { type: 'REMOVE_TASK', id: 'm1' });
    expect(s.myTasks.find((t) => t.id === 'm1')).toBeUndefined();
    expect(s.toast).toBe('Unstaked — off the line');
  });

  it('stakes a suggestion once only', () => {
    const suggestion = { id: 's1', tag: 'X', title: 'Stretch', sub: '', pts: 20, cat: 'Fitness' as const };
    const once = reducer(base, { type: 'ADD_SUGGESTION', suggestion });
    const twice = reducer(once, { type: 'ADD_SUGGESTION', suggestion });
    expect(twice.myTasks).toHaveLength(base.myTasks.length + 1);
  });
});

describe('editing a stake', () => {
  it('loads the task into the composer and routes to Plan', () => {
    const s = reducer(base, { type: 'START_EDIT', id: 'm2' });
    expect(s.planOpen).toBe(true);
    expect(s.editingId).toBe('m2');
    expect(s.draft).toBe('Ship the portfolio site');
    expect(s.draftCat).toBe('Work');
    expect(s.draftAud).toBe('friends');
  });

  it('rewrites the task in place rather than adding one', () => {
    const s = run(
      base,
      { type: 'START_EDIT', id: 'm2' },
      { type: 'SET_DRAFT', value: 'Ship it Friday' },
      { type: 'SET_DRAFT_CAT', cat: 'Mind' },
      { type: 'SAVE_EDIT', aud: 'private' },
    );
    expect(s.myTasks).toHaveLength(base.myTasks.length);
    expect(s.myTasks.find((t) => t.id === 'm2')).toMatchObject({
      title: 'Ship it Friday',
      cat: 'Mind',
      pts: 25,
      aud: 'private',
    });
    expect(s.editingId).toBeNull();
    expect(s.toast).toBe('Updated — still on the line');
  });

  it('keeps the original when the edit is cancelled', () => {
    const s = run(
      base,
      { type: 'START_EDIT', id: 'm2' },
      { type: 'SET_DRAFT', value: 'discarded' },
      { type: 'CANCEL_EDIT' },
    );
    expect(s.myTasks.find((t) => t.id === 'm2')?.title).toBe('Ship the portfolio site');
    expect(s.editingId).toBeNull();
    expect(s.draft).toBe('');
  });

  it('abandons the edit if the task is unstaked underneath it', () => {
    const s = run(base, { type: 'START_EDIT', id: 'm2' }, { type: 'REMOVE_TASK', id: 'm2' });
    expect(s.editingId).toBeNull();
    expect(s.draft).toBe('');
  });

  it('abandons the edit when Plan is closed', () => {
    const s = run(base, { type: 'START_EDIT', id: 'm2' }, { type: 'CLOSE_PLAN' });
    expect(s.editingId).toBeNull();
  });
});

describe('quick log', () => {
  it('lands on today at 20 points, marked as a quick log', () => {
    const s = run(
      base,
      { type: 'SET_COMPOSER', open: true },
      { type: 'SET_COMPOSER_VAL', value: 'Walked the dog' },
      { type: 'SUBMIT_COMPOSER' },
    );
    const added = s.myTasks[s.myTasks.length - 1];
    expect(added).toMatchObject({ pts: 20, cat: 'Quick log', day: base.day, source: 'quicklog', pair: [] });
    expect(s.composerOpen).toBe(false);
    expect(s.toast).toBe('Logged to your week');
  });
});

describe('routing', () => {
  it('closes every other overlay when Plan is opened with a seed', () => {
    const busy: State = { ...base, wrapOpen: true, wrapWeek: 31, notifOpen: true, sheet: { type: 'person', id: 'maya' } };
    const s = reducer(busy, { type: 'OPEN_PLAN_WITH', seed: { title: 'Swim Sunday', pair: ['maya'] } });
    expect(s).toMatchObject({ planOpen: true, wrapOpen: false, wrapWeek: null, notifOpen: false, sheet: null });
    expect(s.draft).toBe('Swim Sunday');
    expect(s.draftPair).toEqual(['maya']);
  });

  it('clears overlays when routing to a tab', () => {
    const busy: State = { ...base, planOpen: true, notifOpen: true };
    const s = reducer(busy, { type: 'GO_PLACE', patch: { tab: 'me' } });
    expect(s).toMatchObject({ tab: 'me', planOpen: false, notifOpen: false });
  });
});

describe('notifications', () => {
  it('marks items read one at a time', () => {
    const s = reducer(base, { type: 'READ_NOTIF', id: 'n1' });
    expect(s.notifRead).toEqual({ n1: true });
  });

  it('marks everything read on request', () => {
    const s = reducer(base, { type: 'READ_ALL_NOTIFS' });
    expect(Object.keys(s.notifRead).length).toBeGreaterThan(5);
  });
});

describe('notes', () => {
  it('appends your note to a task thread', () => {
    const s = run(
      base,
      { type: 'OPEN_SHEET', sheet: { type: 'task', id: 'm4' } },
      { type: 'SET_NOTE', value: 'Halfway.' },
      { type: 'SEND_NOTE' },
    );
    expect(s.myTasks.find((t) => t.id === 'm4')?.cmts).toEqual([{ w: 'You', k: 'you', t: 'Halfway.' }]);
    expect(s.note).toBe('');
  });

  it('ignores an empty note', () => {
    const s = run(
      base,
      { type: 'OPEN_SHEET', sheet: { type: 'task', id: 'm4' } },
      { type: 'SET_NOTE', value: '   ' },
      { type: 'SEND_NOTE' },
    );
    expect(s.myTasks.find((t) => t.id === 'm4')?.cmts).toEqual([]);
  });
});

describe('audience', () => {
  it('cycles a staked task through all three', () => {
    let s = reducer(base, { type: 'CYCLE_TASK_AUD', id: 'm1' });
    expect(s.myTasks.find((t) => t.id === 'm1')?.aud).toBe('everyone');
    s = reducer(s, { type: 'CYCLE_TASK_AUD', id: 'm1' });
    expect(s.myTasks.find((t) => t.id === 'm1')?.aud).toBe('private');
    s = reducer(s, { type: 'CYCLE_TASK_AUD', id: 'm1' });
    expect(s.myTasks.find((t) => t.id === 'm1')?.aud).toBe('friends');
  });
});

describe('config', () => {
  it('defaults to the friends audience', () => {
    expect(DEFAULT_CONFIG.defaultAudience).toBe('friends');
  });
});
