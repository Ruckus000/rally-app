/**
 * The reducer carries the product rules the handoff is most explicit about:
 * a cheer is one specific act and can be taken back, unstaking is required,
 * closing every stake fires the celebration, and routing never leaves a stale
 * overlay behind. Those are what's tested here.
 */
import { Action, DEFAULT_CONFIG, hydrate, reducer, State } from '../store';
import { pick } from '../persistence';
import { GLOBAL_MOMENTS, MY_TASKS, MOMENTS, Task } from '../../data/fixtures';
import { __resetOutboxForTests, enqueue } from '../../sync/outbox';
import type { ReactionRef } from '../../sync/reactions';
import type { PulledNote } from '../../sync/transport';
import { WORLD, getWorld, seedProfile } from '../../data/seed';
import { personOf } from '../../data/people';
import { baseState as base, freshState } from '../../test/baseState';
import { weekAfter } from '../../data/week';

/** RFC 4122, any version — the shape, not a particular generator. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


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

  it('hands a suggestion back when its task is unstaked', () => {
    const suggestion = { id: 's1', tag: 'X', title: 'Stretch', sub: '', pts: 20, cat: 'Fitness' as const };
    const staked = reducer(base, { type: 'ADD_SUGGESTION', suggestion });
    const added = staked.myTasks[staked.myTasks.length - 1];
    expect(staked.usedSugg.s1).toBe(true);

    const unstaked = reducer(staked, { type: 'REMOVE_TASK', id: added.id });
    expect(unstaked.usedSugg.s1).toBeUndefined();

    // …and it can be staked again rather than being a dead card.
    const restaked = reducer(unstaked, { type: 'ADD_SUGGESTION', suggestion });
    expect(restaked.myTasks).toHaveLength(base.myTasks.length + 1);
  });

  it('leaves other suggestions alone when one task is unstaked', () => {
    const a = { id: 's1', tag: 'X', title: 'Stretch', sub: '', pts: 20, cat: 'Fitness' as const };
    const b = { id: 's3', tag: 'Y', title: 'Read', sub: '', pts: 30, cat: 'Mind' as const };
    let s = reducer(base, { type: 'ADD_SUGGESTION', suggestion: a });
    s = reducer(s, { type: 'ADD_SUGGESTION', suggestion: b });
    const fromA = s.myTasks.find((t) => t.fromSuggestion === 's1')!;
    s = reducer(s, { type: 'REMOVE_TASK', id: fromA.id });
    expect(s.usedSugg.s1).toBeUndefined();
    expect(s.usedSugg.s3).toBe(true);
  });

  it('does not disturb suggestions when a normal task is unstaked', () => {
    const suggestion = { id: 's1', tag: 'X', title: 'Stretch', sub: '', pts: 20, cat: 'Fitness' as const };
    const staked = reducer(base, { type: 'ADD_SUGGESTION', suggestion });
    const s = reducer(staked, { type: 'REMOVE_TASK', id: 'm1' });
    expect(s.usedSugg.s1).toBe(true);
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
    const cmts = s.myTasks.find((t) => t.id === 'm4')?.cmts ?? [];
    expect(cmts).toEqual([{ w: 'You', k: 'you', t: 'Halfway.', id: expect.any(String) }]);
    // The id is the row's primary key in `notes`, so a note the server refuses
    // to accept is a note the sync layer drops silently — the uuid gate in
    // `syncableNote` is strict, and a generator that stopped producing uuids
    // would show up nowhere else.
    expect(cmts[0].id).toMatch(UUID);
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

describe('notes on a public post', () => {
  const onGlobal = { type: 'OPEN_SHEET', sheet: { type: 'task' as const, id: 'g1' } } as Action;

  it('keeps the note instead of silently dropping it', () => {
    const s = run(base, onGlobal, { type: 'SET_NOTE', value: 'Respect.' }, { type: 'SEND_NOTE' });
    // Carries an id like any other note. It buys nothing here — a public post
    // has no table — but a note that is written one way everywhere is one fewer
    // shape for the sync layer to have an opinion about.
    expect(s.globalNotes.g1).toEqual([{ w: 'You', k: 'you', t: 'Respect.', id: expect.any(String) }]);
    expect(s.note).toBe('');
  });

  it('does not leak into your tasks or the circle feed', () => {
    const s = run(base, onGlobal, { type: 'SET_NOTE', value: 'Respect.' }, { type: 'SEND_NOTE' });
    expect(s.myTasks).toEqual(base.myTasks);
    expect(s.moments).toEqual(base.moments);
  });

  it('still routes a note on your own task to that task', () => {
    const s = run(
      base,
      { type: 'OPEN_SHEET', sheet: { type: 'task', id: 'm4' } },
      { type: 'SET_NOTE', value: 'Halfway.' },
      { type: 'SEND_NOTE' },
    );
    expect(s.myTasks.find((t) => t.id === 'm4')?.cmts).toHaveLength(1);
    expect(s.globalNotes).toEqual({});
  });

  it('still routes a note on a friend’s moment to that moment', () => {
    const s = run(
      base,
      { type: 'OPEN_SHEET', sheet: { type: 'task', id: 'f2' } },
      { type: 'SET_NOTE', value: 'On my way.' },
      { type: 'SEND_NOTE' },
    );
    expect(s.moments.find((m) => m.id === 'f2')?.cmts).toHaveLength(1);
    expect(s.globalNotes).toEqual({});
  });

  it('ignores an empty note', () => {
    const s = run(base, onGlobal, { type: 'SET_NOTE', value: '  ' }, { type: 'SEND_NOTE' });
    expect(s.globalNotes).toEqual({});
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

describe('accounts', () => {
  /** Onboarding starts from nothing — the fixtures aren't the initial state. */
  // Genuinely pre-decision: the fixtures haven't been granted yet.
  const undecided: State = {
    ...base,
    account: null,
    myTasks: [],
    moments: [],
    history: [],
    yearLevels: [],
    profile: seedProfile(null),
    onboardStep: 'onboarding',
  };

  it('starts empty before you have chosen', () => {
    expect(getWorld(undecided.account).members).toEqual(['you']);
    expect(undecided.myTasks).toHaveLength(0);
  });

  it('choosing the demo is what seeds the circle and the demo week', () => {
    const s = reducer(undecided, { type: 'SET_ACCOUNT', mode: 'seeded' });
    expect(s.account).toBe('seeded');
    expect(s.myTasks).toHaveLength(MY_TASKS.length);
    expect(s.moments).toHaveLength(MOMENTS.length);
    expect(getWorld(s.account).members.length).toBeGreaterThan(1);
    // The account is a separate question from where onboarding is: the flow
    // holds the step itself, and picking a world must not close it.
    expect(s.onboardStep).toBe('onboarding');
  });

  it('re-seeds when the account is chosen again, leaving nothing of the last one', () => {
    // The front door is one back-press from every step of the flow, so this is
    // a route a user really has.
    const demo = reducer(undecided, { type: 'SET_ACCOUNT', mode: 'seeded' });
    const acted = reducer(demo, { type: 'ACT', id: 'f1', kind: 'cheer' });
    const live = reducer(acted, { type: 'SET_ACCOUNT', mode: 'live' });

    expect(live.account).toBe('live');
    expect(live.myTasks).toHaveLength(0);
    expect(live.moments).toHaveLength(0);
    expect(live.history).toHaveLength(0);
    expect(Object.keys(live.people)).toHaveLength(0);
    expect(live.profile.allTimePoints).toBe(0);
    // Acted-on ids belonged to the world being left.
    expect(live.acted).toEqual({});
  });

  it('going solo in the demo drops the circle it had granted', () => {
    const demo = reducer(undecided, { type: 'SET_ACCOUNT', mode: 'seeded' });
    const solo = reducer(demo, { type: 'SET_ACCOUNT', mode: 'fresh' });

    expect(solo.account).toBe('fresh');
    expect(solo.myTasks).toHaveLength(0);
    expect(getWorld(solo.account).members).toEqual(['you']);
  });

  it('skipping leaves a genuinely empty account', () => {
    const s = reducer(undecided, { type: 'SKIP_ONBOARD' });
    expect(s.account).toBe('fresh');
    expect(s.myTasks).toHaveLength(0);
    expect(s.moments).toHaveLength(0);
    expect(s.onboardStep).toBeNull();

    const world = getWorld(s.account);
    expect(world.members).toEqual(['you']);
    expect(world.notifications).toHaveLength(0);
    expect(world.suggestions).toHaveLength(0);
    expect(s.history).toHaveLength(0);
    expect(s.yearLevels).toHaveLength(0);
    expect(s.profile.allTimePoints).toBe(0);
    expect(s.profile.currentStreak).toBe(0);
    // Nothing staked and no circle, so both of the other tabs are empty
    // states — the one landing the app picks with nothing of yours to show
    // opens on the feed that has something in it.
    expect(s.tab).toBe('week');
    expect(s.scope).toBe('global');
  });

  it('does not downgrade an account that already chose the demo', () => {
    const joined = reducer(undecided, { type: 'SET_ACCOUNT', mode: 'seeded' });
    expect(reducer(joined, { type: 'SKIP_ONBOARD' }).account).toBe('seeded');
  });

  it('keeps the name you typed, so you are not rendered as a stranger', () => {
    // The flow asks for a name on screen 2. Leaving it uncommitted meant the
    // avatar rendered "?" the moment onboarding finished — asking and then
    // discarding is worse than never asking.
    const chosen = reducer(undecided, { type: 'SET_ACCOUNT', mode: 'fresh' });
    const s = reducer(chosen, {
      type: 'FINISH_ONBOARD',
      name: 'Jonathan Philistin',
      stakes: [],
      aud: 'friends',
    });

    expect(s.people[s.selfId]?.initials).toBe('JP');
    expect(s.people[s.selfId]?.first).toBe('Jonathan');
    // Second person, not third: the circle refers to you as "You".
    expect(s.people[s.selfId]?.name).toBe('You');
  });

  it('turns what you staked in onboarding into real tasks', () => {
    const chosen = reducer(undecided, { type: 'SET_ACCOUNT', mode: 'fresh' });
    const s = reducer(chosen, {
      type: 'FINISH_ONBOARD',
      name: 'Jonathan Philistin',
      stakes: [
        { title: 'Run 5k', cat: 'Fitness', pts: 40 },
        { title: 'In bed by 11', cat: 'Mind', pts: 40 },
      ],
      aud: 'friends',
    });

    expect(s.onboardStep).toBeNull();
    expect(s.myTasks).toHaveLength(2);
    expect(s.myTasks.map((t) => t.title)).toEqual(['Run 5k', 'In bed by 11']);
    // The same shape ADD_TASK mints, so nothing downstream can tell them apart.
    expect(s.myTasks.every((t) => t.source === 'staked')).toBe(true);
    expect(s.myTasks.every((t) => t.aud === 'friends')).toBe(true);
    expect(s.myTasks.every((t) => !t.done && t.pair.length === 0)).toBe(true);
    expect(s.myTasks.every((t) => UUID.test(t.id))).toBe(true);
    // The flow never asks for a day, so they start today rather than later.
    expect(s.myTasks.every((t) => t.day === chosen.day)).toBe(true);
  });

  it('keeps the demo week when the demo is what you staked on top of', () => {
    const demo = reducer(undecided, { type: 'SET_ACCOUNT', mode: 'seeded' });
    const s = reducer(demo, {
      type: 'FINISH_ONBOARD',
      name: 'Jonathan Philistin',
      stakes: [{ title: 'Write 500 words', cat: 'Work', pts: 50 }],
      aud: 'friends',
    });
    expect(s.myTasks).toHaveLength(MY_TASKS.length + 1);
  });

  it('resets to a fresh account, clearing your work', () => {
    const dirty = run(base, { type: 'TOGGLE_TASK', id: 'm2' }, { type: 'ACT', id: 'f1', kind: 'cheer' });
    const s = reducer(dirty, { type: 'RESET', mode: 'fresh' });
    expect(s.account).toBe('fresh');
    expect(s.myTasks).toHaveLength(0);
    expect(s.acted).toEqual({});
    expect(s.onboardStep).toBeNull();
    // An emptied account has no week and no circle; the demo below keeps
    // Friends because it has one, which is the control on this.
    expect(s.scope).toBe('global');
  });

  it('resets back to the demo', () => {
    const s = reducer({ ...base, account: 'fresh', myTasks: [] }, { type: 'RESET', mode: 'seeded' });
    expect(s.myTasks).toHaveLength(MY_TASKS.length);
    expect(s.history.length).toBeGreaterThan(0);
    expect(s.profile.allTimePoints).toBeGreaterThan(0);
    expect(s.scope).toBe('friends');
    expect(s.onboardStep).toBeNull();
  });

  it('resets to live with nothing seeded at all', () => {
    // A live account's rows come from the server. Anything seeded here would
    // be local fiction the sync layer would then try to reconcile.
    const s = reducer(base, { type: 'RESET', mode: 'live' });
    expect(s.account).toBe('live');
    expect(s.myTasks).toHaveLength(0);
    expect(Object.keys(s.people)).toHaveLength(0);
    expect(s.moments).toHaveLength(0);
    expect(s.history).toHaveLength(0);
    expect(s.yearLevels).toHaveLength(0);
    expect(s.profile.allTimePoints).toBe(0);
    expect(s.onboardStep).toBeNull();
  });

  it('marks read only the notifications the account actually has', () => {
    const fresh: State = { ...base, account: 'fresh' };
    expect(reducer(fresh, { type: 'READ_ALL_NOTIFS' }).notifRead).toEqual({});
    expect(
      Object.keys(reducer(base, { type: 'READ_ALL_NOTIFS' }).notifRead),
    ).toHaveLength(WORLD.seeded.notifications.length);
  });
});

describe('hydration', () => {
  it('rebuilds the directory a payload predating it never had', () => {
    // Seven people and the four Oz bots, who are in every demo directory
    // because the Global feed renders before you know anybody.
    expect(Object.keys(hydrate({ account: 'seeded' }).people)).toHaveLength(11);
  });

  /**
   * The Global feed is seeded for the demo modes and server-filled for a live
   * one, so a payload that predates the slice must not inherit the wrong world.
   */
  it('does not hand a live account the demo’s Global feed', () => {
    // Seen on device: an account upgrading across the build that added this
    // slice opened on four fictional posts credited to "Someone".
    expect(hydrate({ account: 'live' }).globalPosts).toEqual([]);
  });

  it('still seeds it for a demo account, which has no server to ask', () => {
    expect(hydrate({ account: 'seeded' }).globalPosts).toHaveLength(GLOBAL_MOMENTS.length);
  });

  it('keeps a live feed that was actually stored', () => {
    const stored = [{ ...GLOBAL_MOMENTS[0]!, id: 'from-disk' }];
    expect(hydrate({ account: 'live', globalPosts: stored }).globalPosts).toEqual(stored);
  });

  it('refuses a stored selfId on a demo account', () => {
    // An edited payload pointing self at Maya would otherwise hand her your
    // live week in the ranking and author your notes under her name.
    expect(hydrate({ account: 'seeded', selfId: 'maya' }).selfId).toBe('you');
    expect(hydrate({ account: 'fresh', selfId: 'dre' }).selfId).toBe('you');
  });

  it('keeps a stored selfId on a live account, where identity is real', () => {
    const uid = '00000000-0000-4000-8000-00000000000b';
    expect(hydrate({ account: 'live', selfId: uid }).selfId).toBe(uid);
  });

  it('never restores a session', () => {
    expect(hydrate({ account: 'live', session: { status: 'ready', userId: 'u1' } }).session).toEqual({
      status: 'off',
    });
  });

  it('leaves a live account with no session pointing self at nobody', () => {
    // The sentinel is safe only because it can never collide: profile ids are
    // uuids, and a live account's directory starts empty. So until the session
    // resolves, no real person is rendered as you.
    const s = hydrate({ account: 'live' });
    expect(s.selfId).toBe('you');
    expect(s.people.you).toBeUndefined();
    expect(Object.keys(s.people)).toHaveLength(0);
  });

  it('gives the restored directory a null prototype', () => {
    // Off disk it came through JSON.parse and carries Object.prototype, where
    // a lookup for `toString` returns the inherited function rather than
    // missing — so the resolver's stranger fallback would never fire.
    const restored = hydrate({
      account: 'seeded',
      people: JSON.parse('{"maya":{"id":"maya","name":"Maya Chen","first":"Maya","initials":"MC"}}'),
    });
    expect(Object.getPrototypeOf(restored.people)).toBeNull();
    expect((restored.people as Record<string, unknown>).toString).toBeUndefined();
  });
});

describe('task ids', () => {
  it('are client-minted uuids, so a retried write collides instead of duplicating', () => {
    const staked = run(
      base,
      { type: 'SET_DRAFT', value: 'Swim' },
      { type: 'ADD_TASK', aud: 'friends' },
    );
    const logged = run(
      base,
      { type: 'SET_COMPOSER_VAL', value: 'Walked' },
      { type: 'SUBMIT_COMPOSER' },
    );
    const suggested = reducer(base, {
      type: 'ADD_SUGGESTION',
      suggestion: { id: 's1', tag: 'X', title: 'Stretch', sub: '', pts: 20, cat: 'Fitness' },
    });

    for (const s of [staked, logged, suggested]) {
      expect(s.myTasks[s.myTasks.length - 1].id).toMatch(UUID);
    }
  });

  it('never repeats', () => {
    const s = run(
      base,
      { type: 'SET_DRAFT', value: 'One' },
      { type: 'ADD_TASK', aud: 'friends' },
      { type: 'SET_DRAFT', value: 'Two' },
      { type: 'ADD_TASK', aud: 'friends' },
    );
    const ids = s.myTasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the session', () => {
  const ready = { status: 'ready', userId: 'u1' } as const;

  it('moves state', () => {
    const s = reducer(base, { type: 'SESSION', session: ready });
    expect(s.session).toEqual(ready);
  });

  it('is never written to disk', () => {
    // Derived from the auth client on every launch. Persisting it would let an
    // edited payload claim a user id this install never signed in as.
    expect(Object.keys(pick({ ...base, session: ready }))).not.toContain('session');
  });

  it('ignores a session equal to the one already held', () => {
    // ensureSession both resolves and broadcasts, so the same value arrives
    // twice on a cold start — and every dispatch re-renders every screen.
    const s = reducer(base, { type: 'SESSION', session: ready });
    expect(reducer(s, { type: 'SESSION', session: { status: 'ready', userId: 'u1' } })).toBe(s);
  });
});

describe('merging rows from the server', () => {
  const maya = personOf('maya', 'Maya Chen');

  it('returns the same state object when nothing is new', () => {
    // Identity, so useReducer bails out of the render. A poll that found
    // nothing is the common case and has to cost nothing.
    const known = base.people.maya!;
    expect(reducer(base, { type: 'SERVER_MERGE', merge: { people: [known] } })).toBe(base);
    expect(reducer(base, { type: 'SERVER_MERGE', merge: {} })).toBe(base);
    expect(reducer(base, { type: 'SERVER_MERGE', merge: { selfId: base.selfId } })).toBe(base);
  });

  it('adds someone new without touching who was already there', () => {
    const jo = personOf('00000000-0000-4000-8000-0000000000aa', 'Jo Ramos');
    const s = reducer(base, { type: 'SERVER_MERGE', merge: { people: [jo] } });
    expect(s).not.toBe(base);
    expect(s.people[jo.id]?.name).toBe('Jo Ramos');
    expect(s.people.maya).toBe(base.people.maya);
    expect(Object.getPrototypeOf(s.people)).toBeNull();
  });

  it('does not close a sheet the user has open', () => {
    // A row arriving from someone else's phone is not a route change. This is
    // why SERVER_MERGE is not GO_PLACE, which spreads CLEARED.
    const busy: State = {
      ...base,
      sheet: { type: 'person', id: 'maya' },
      note: 'half typed',
      planOpen: true,
      notifOpen: true,
    };
    const s = reducer(busy, { type: 'SERVER_MERGE', merge: { people: [{ ...maya, name: 'Maya C.' }] } });
    expect(s.sheet).toEqual({ type: 'person', id: 'maya' });
    expect(s.note).toBe('half typed');
    expect(s.planOpen).toBe(true);
    expect(s.notifOpen).toBe(true);
  });

  describe('tasks', () => {
    /** What a pull produces: `rowToTask` cannot answer for pairs or comments. */
    const asRow = (t: Task, over: Partial<Task> = {}): Task => ({
      ...t,
      pair: [],
      pairKind: null,
      cmts: [],
      ...over,
    });

    beforeEach(__resetOutboxForTests);
    afterEach(__resetOutboxForTests);

    it('folds server rows into the week', () => {
      const [first] = base.myTasks;
      const s = reducer(base, {
        type: 'SERVER_MERGE',
        merge: { tasks: base.myTasks.map((t) => asRow(t, { done: true })) },
      });

      expect(s).not.toBe(base);
      expect(s.myTasks.every((t) => t.done)).toBe(true);
      // The row is the same task, not a second copy of it.
      expect(s.myTasks.filter((t) => t.id === first.id)).toHaveLength(1);
    });

    it('leaves a task with unsent local edits exactly as it is', () => {
      const mine = { ...base.myTasks[0], title: 'Typed on a plane' };
      const local: State = { ...base, myTasks: [mine, ...base.myTasks.slice(1)] };
      // The queue is what makes it dirty, and the reducer asks the queue —
      // nothing about this row in state says the server has not seen it.
      enqueue('task.upsert', `task:${mine.id}`, { task: mine, weekStart: '2026-08-10' });

      const s = reducer(local, {
        type: 'SERVER_MERGE',
        merge: { tasks: local.myTasks.map((t) => asRow(t, { title: 'Whatever the server had' })) },
      });

      expect(s.myTasks.find((t) => t.id === mine.id)).toBe(mine);
      // …and the rows with nothing queued for them did take the server's copy,
      // so this is not passing because the merge was ignored wholesale.
      expect(s.myTasks.filter((t) => t.title === 'Whatever the server had').length).toBe(
        base.myTasks.length - 1,
      );
    });

    it('returns the same state object when the rows change nothing', () => {
      const s = reducer(base, {
        type: 'SERVER_MERGE',
        merge: { people: [base.people.maya!], tasks: base.myTasks.map((t) => asRow(t)) },
      });
      expect(s).toBe(base);
    });
  });

  describe('reactions', () => {
    // Two real rows, and the keys the app writes for things that are not rows.
    const TARGET = '55555555-5555-4555-8555-555555555555';
    const OTHER_TARGET = '66666666-6666-4666-8666-666666666666';
    const cheer = (targetId: string): ReactionRef => ({ targetId, kind: 'cheer' });

    beforeEach(__resetOutboxForTests);
    afterEach(__resetOutboxForTests);

    it('lights a cheer made on another device', () => {
      const s = reducer(base, { type: 'SERVER_MERGE', merge: { reactions: [cheer(TARGET)] } });
      expect(s.acted[`${TARGET}:cheer`]).toBe(true);
    });

    it('puts out a cheer taken back on another device', () => {
      // The absence is the whole message. A union merge could never express it,
      // and the cheer would stay lit on this phone for the life of the install.
      const lit: State = { ...base, acted: { [`${TARGET}:cheer`]: true } };
      const s = reducer(lit, { type: 'SERVER_MERGE', merge: { reactions: [] } });
      expect(s.acted[`${TARGET}:cheer`]).toBeUndefined();
    });

    it('never touches a key the server cannot speak for', () => {
      // A fixture moment, a public post, and your own win. None of them is a row
      // in `reactions`, so the server's silence about them says nothing — and
      // treating it as authority would put out three taps the user can see.
      const local: State = {
        ...base,
        acted: { 'g1:cheer': true, 'mywin:share': true, 'f1:cheer': true, 'maya0:nod': true },
      };
      const s = reducer(local, { type: 'SERVER_MERGE', merge: { reactions: [] } });
      expect(s).toBe(local);
      expect(s.acted).toEqual(local.acted);
    });

    it('keeps a cheer that is still sitting in the queue', () => {
      // Tapped a second ago; the pull that is answering here was issued before
      // it. The queue is the record of what the server has not been told, and it
      // outranks a reply that predates the tap.
      const local: State = { ...base, acted: { [`${TARGET}:cheer`]: true } };
      enqueue('reaction.add', `reaction:${TARGET}:cheer`, { targetId: TARGET, kind: 'cheer' });

      const s = reducer(local, { type: 'SERVER_MERGE', merge: { reactions: [] } });
      expect(s.acted[`${TARGET}:cheer`]).toBe(true);
    });

    it('does not re-light a cheer whose withdrawal is still queued', () => {
      // The mirror image, and the reason the queue wins in both directions: the
      // row is still on the server because the delete has not gone out yet.
      enqueue('reaction.remove', `reaction:${TARGET}:cheer`, { targetId: TARGET, kind: 'cheer' });

      const s = reducer(base, { type: 'SERVER_MERGE', merge: { reactions: [cheer(TARGET)] } });
      expect(s.acted[`${TARGET}:cheer`]).toBeUndefined();
    });

    it('returns the same state object when the reactions change nothing', () => {
      const local: State = {
        ...base,
        acted: { [`${TARGET}:cheer`]: true, [`${OTHER_TARGET}:cheer`]: true, 'g1:cheer': true },
      };
      const s = reducer(local, {
        type: 'SERVER_MERGE',
        merge: { reactions: [cheer(OTHER_TARGET), cheer(TARGET)] },
      });
      expect(s).toBe(local);
    });
  });

  describe('notes', () => {
    const NOTE = '77777777-7777-4777-8777-777777777777';
    const author = '88888888-8888-4888-8888-888888888888';
    const pulled = (over: Partial<PulledNote> & Pick<PulledNote, 'target'>): PulledNote => ({
      id: NOTE,
      authorId: author,
      body: 'Strong week.',
      at: '2026-08-10T09:00:00Z',
      ...over,
    });

    it('puts a note from another device on the task it names', () => {
      const [task] = base.myTasks;
      const s = reducer(base, {
        type: 'SERVER_MERGE',
        merge: { notes: [pulled({ target: { taskId: task.id } })] },
      });

      const merged = s.myTasks.find((t) => t.id === task.id)!;
      expect(merged.cmts.map((c) => c.t)).toEqual([...task.cmts.map((c) => c.t), 'Strong week.']);
      // Append-only: the note that was already there is the same object.
      expect(merged.cmts[0]).toBe(task.cmts[0]);
      // …and no other thread was rebuilt.
      expect(s.myTasks[1]).toBe(base.myTasks[1]);
    });

    it('puts a note addressed to someone in their thread', () => {
      const s = reducer(base, {
        type: 'SERVER_MERGE',
        merge: { notes: [pulled({ target: { recipientId: 'maya' }, body: 'Proud of you.' })] },
      });
      expect(s.personNotes.maya?.map((n) => n.t)).toEqual(['Proud of you.']);
      expect(s.personNotes.maya?.[0].k).toBe(author);
      expect(s.myTasks).toBe(base.myTasks);
    });

    it('never says the same note twice', () => {
      const [task] = base.myTasks;
      const row = pulled({ target: { taskId: task.id } });
      const once = reducer(base, { type: 'SERVER_MERGE', merge: { notes: [row] } });
      // The same row again, which is what every pull after the first delivers.
      const twice = reducer(once, { type: 'SERVER_MERGE', merge: { notes: [row] } });
      expect(twice).toBe(once);
    });

    it('keeps a local note that has no id', () => {
      // It predates the id field, so it can never have been sent and there is
      // nothing on the wire it could be matched against. Dropping it would
      // delete something the user is looking at.
      const [task] = base.myTasks;
      const s = reducer(base, {
        type: 'SERVER_MERGE',
        merge: { notes: [pulled({ target: { taskId: task.id } })] },
      });
      const merged = s.myTasks.find((t) => t.id === task.id)!;
      expect(merged.cmts.filter((c) => !c.id)).toHaveLength(task.cmts.length);
    });

    it('lands on a task that arrived in the same merge', () => {
      // A row and its thread come back from the same pull. Folding the notes
      // into the reconciled tasks rather than the old ones is what lets one
      // commit carry both.
      const row: Task = {
        id: '99999999-9999-4999-8999-999999999999',
        day: 2,
        title: 'staked on the other phone',
        cat: 'Fitness',
        pts: 40,
        done: false,
        aud: 'friends',
        pair: [],
        pairKind: null,
        cmts: [],
        source: 'staked',
      };
      const s = reducer(base, {
        type: 'SERVER_MERGE',
        merge: { tasks: [...base.myTasks, row], notes: [pulled({ target: { taskId: row.id } })] },
      });
      expect(s.myTasks.find((t) => t.id === row.id)?.cmts.map((c) => c.t)).toEqual(['Strong week.']);
    });
  });

  it('carries rows, never an identity', () => {
    // A merge must not be able to say who you are. Identity is settled by the
    // session that authenticated; letting a server payload move selfId would
    // reopen the substitution the SESSION branch exists to close.
    const uid = '00000000-0000-4000-8000-00000000000b';
    const live: State = { ...base, account: 'live', selfId: 'you' };
    const s = reducer(live, {
      type: 'SERVER_MERGE',
      merge: { selfId: uid } as never,
    });
    expect(s.selfId).toBe('you');
  });
});

describe('who you are comes from the session', () => {
  const uid = '00000000-0000-4000-8000-00000000000b';

  it('adopts the authenticated user id when the session becomes ready', () => {
    const live: State = { ...base, account: 'live', selfId: 'you' };
    const s = reducer(live, {
      type: 'SESSION',
      session: { status: 'ready', userId: uid },
    });
    expect(s.selfId).toBe(uid);
  });

  it('leaves selfId alone while the session is still resolving', () => {
    const live: State = { ...base, account: 'live', selfId: uid };
    const s = reducer(live, { type: 'SESSION', session: { status: 'signing-in' } });
    expect(s.selfId).toBe(uid);
    const off = reducer(live, { type: 'SESSION', session: { status: 'offline' } });
    expect(off.selfId).toBe(uid);
  });
});

describe('config', () => {
  it('defaults to the friends audience', () => {
    expect(DEFAULT_CONFIG.defaultAudience).toBe('friends');
  });
});

describe('week rollover', () => {
  const next = weekAfter(base.week);
  const detected = { type: 'ROLLOVER_DETECTED', to: next } as Action;

  it('asks rather than rewriting anything', () => {
    const s = reducer(base, detected);
    expect(s.pendingRollover?.to.number).toBe(next.number);
    expect(s.week.number).toBe(base.week.number);
    expect(s.myTasks).toEqual(base.myTasks);
    expect(s.history).toEqual(base.history);
  });

  it('does nothing when the week has not moved', () => {
    expect(reducer(base, { type: 'ROLLOVER_DETECTED', to: base.week })).toBe(base);
  });

  it('does not interrupt onboarding', () => {
    const onboarding: State = { ...base, onboardStep: 'onboarding' };
    expect(reducer(onboarding, detected).pendingRollover).toBeNull();
  });

  it('only asks once', () => {
    const once = reducer(base, detected);
    expect(reducer(once, detected)).toBe(once);
  });

  it('archives the closed week and carries only what you picked', () => {
    const closed = run(base, { type: 'TOGGLE_TASK', id: 'm2' }, detected);
    const s = reducer(closed, { type: 'COMMIT_ROLLOVER', carryIds: ['m4'] });

    expect(s.week.number).toBe(next.number);
    expect(s.pendingRollover).toBeNull();
    expect(s.myTasks.map((t) => t.title)).toEqual(['Read 100 pages']);
    expect(s.myTasks[0].done).toBe(false);

    const record = s.history[0];
    expect(record.n).toBe(base.week.number);
    expect(record.done).toBe(2); // m1 was already done, m2 just closed
    expect(record.total).toBe(base.myTasks.length);
    expect(record.points).toBe(90);
  });

  it('starts the new week with nobody having cheered it yet', () => {
    // The count is this week's rows, so carrying it over would credit the new
    // week with last week's cheers until the next pull corrected it.
    const live = { ...base, account: 'live' as const, profile: { ...base.profile, cheersReceived: 6 } };
    const closed = run(live, { type: 'TOGGLE_TASK', id: 'm2' }, detected);

    expect(reducer(closed, { type: 'COMMIT_ROLLOVER', carryIds: [] }).profile.cheersReceived).toBe(0);
  });

  it('leaves the demo’s cheer count alone — the control', () => {
    // The demo's is a fixture with no pull behind it, so clearing it would
    // empty a number the seeded account is supposed to show.
    const closed = run(base, { type: 'TOGGLE_TASK', id: 'm2' }, detected);

    expect(reducer(closed, { type: 'COMMIT_ROLLOVER', carryIds: [] }).profile.cheersReceived).toBe(
      base.profile.cheersReceived,
    );
  });

  it('advances the running totals', () => {
    const closed = run(base, { type: 'TOGGLE_TASK', id: 'm2' }, detected);
    const s = reducer(closed, { type: 'COMMIT_ROLLOVER', carryIds: [] });

    expect(s.profile.allTimePoints).toBe(base.profile.allTimePoints + 90);
    expect(s.profile.weeksIn).toBe(base.profile.weeksIn + 1);
    expect(s.profile.currentStreak).toBe(base.profile.currentStreak + 1);
    expect(s.yearLevels).toHaveLength(base.yearLevels.length + 1);
  });

  it('breaks the streak when nothing closed, and records a quiet week', () => {
    const nothingDone: State = {
      ...base,
      myTasks: base.myTasks.map((t) => ({ ...t, done: false })),
    };
    const s = run(nothingDone, detected, { type: 'COMMIT_ROLLOVER', carryIds: [] });
    expect(s.profile.currentStreak).toBe(0);
    expect(s.history[0].quiet).toBe(true);
    expect(s.yearLevels[s.yearLevels.length - 1]).toBe(0);
  });

  it('counts a perfect week and keeps the longest streak', () => {
    const allDone: State = { ...base, myTasks: base.myTasks.map((t) => ({ ...t, done: true })) };
    const s = run(allDone, detected, { type: 'COMMIT_ROLLOVER', carryIds: [] });
    expect(s.profile.perfectWeeks).toBe(base.profile.perfectWeeks + 1);
    expect(s.yearLevels[s.yearLevels.length - 1]).toBe(3);
    expect(s.profile.longestStreak).toBeGreaterThanOrEqual(base.profile.longestStreak);
  });

  it('resets the week-scoped slices but keeps what is yours', () => {
    const busy = run(
      base,
      { type: 'ACT', id: 'f1', kind: 'cheer' },
      { type: 'READ_NOTIF', id: 'n1' },
      { type: 'OPEN_SHEET', sheet: { type: 'person', id: 'maya' } },
      { type: 'SET_NOTE', value: 'hi' },
      { type: 'SEND_NOTE' },
      detected,
    );
    const s = reducer(busy, { type: 'COMMIT_ROLLOVER', carryIds: [] });

    expect(s.acted).toEqual({});
    expect(s.notifRead).toEqual({});
    expect(s.usedSugg).toEqual({});
    // Things you said to people are not week-scoped.
    expect(s.personNotes.maya).toHaveLength(1);
    expect(s.account).toBe('seeded');
  });

  it('works on a fresh account with nothing staked', () => {
    const s = run(freshState, { type: 'ROLLOVER_DETECTED', to: weekAfter(freshState.week) },
      { type: 'COMMIT_ROLLOVER', carryIds: [] });
    expect(s.history[0].total).toBe(0);
    expect(s.history[0].points).toBe(0);
    expect(s.profile.allTimePoints).toBe(0);
    expect(Number.isFinite(s.profile.bestWeekPoints)).toBe(true);
  });

  it('ignores a commit that was never prompted', () => {
    expect(reducer(base, { type: 'COMMIT_ROLLOVER', carryIds: [] })).toBe(base);
  });
});
