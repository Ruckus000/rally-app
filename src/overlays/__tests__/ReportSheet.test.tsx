/**
 * The report sheet, which is the one screen in this app where being wrong is
 * expensive.
 *
 * Four things are worth proving here and the rest is decoration:
 *
 * 1. Reporting and blocking are separate acts. Someone who reports a post has
 *    not asked to never see that person again, and the sheet must not decide
 *    that for them — so the assertion is that after a report and nothing else,
 *    `state.blocked` is still empty.
 * 2. Cancelling does nothing. Not "nothing much": no queue entry, no reported
 *    id, no block. It is asserted by driving the control rather than by reading
 *    the reducer, because the reducer being right is no help if the button is
 *    wired to the wrong action.
 * 3. Both writes queue. The outbox is checked directly, which is what "works
 *    offline" means here — there is no server in a unit test and there does not
 *    need to be one.
 * 4. The copy. `no moderation team` and the sentence about the circle are both
 *    load-bearing: the first is the promise this app cannot keep and therefore
 *    must not make, and the second is what stops a working block from looking
 *    broken when the blocked person keeps appearing on the leaderboard.
 *
 * Rendered through the real `StoreProvider` with `persist` and `sync` off. The
 * target arrives in `restored` — `reportTarget` is session state, so nothing on
 * disk ever carries one, but `restored` is the store's only seam for standing a
 * component up mid-flow and that is what it is doing here.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StoreProvider, useStore } from '../../state/store';
import { ReportSheet } from '../ReportSheet';
import { pending, __resetOutboxForTests } from '../../sync/outbox';
import type { ReportTarget } from '../../state/store';

const MAYA = 'maya';
const TASK: ReportTarget = { kind: 'task', id: 'f1', who: MAYA };
const PROFILE: ReportTarget = { kind: 'profile', id: MAYA, who: MAYA };

let seenState: ReturnType<typeof useStore>['state'];

function Watch() {
  const { state } = useStore();
  React.useEffect(() => {
    seenState = state;
  });
  return null;
}

/**
 * Awaited, and so every test here is async. `useReducedMotion` asks the OS a
 * question that resolves a microtask after render; letting it settle inside
 * `act` is the difference between a clean run and a wall of warnings about a
 * state update nobody wrote.
 */
const mount = async (target: ReportTarget, restored: Record<string, unknown> = {}) => {
  const tree = render(
    <StoreProvider
      persist={false}
      sync={false}
      restored={{ account: 'seeded', reportTarget: target, ...restored }}
    >
      <Watch />
      <ReportSheet />
    </StoreProvider>,
  );
  await act(async () => {});
  return tree;
};

/** The two taps that get from a fresh sheet to a filed report. */
const file = (reason = 'Spam') => {
  fireEvent.press(screen.getByLabelText(reason));
  fireEvent.press(screen.getByLabelText('File this report'));
};

beforeEach(() => {
  __resetOutboxForTests();
  // Reduced motion on, which makes the sheet's entrance a `setValue` instead of
  // a running animation. Nothing here asserts on the slide, and an animation
  // ticking after the test body has finished is ten act() warnings about a
  // state update nobody in this file wrote.
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('picking a reason', () => {
  it('offers exactly the six the migration allows', async () => {
    await mount(TASK);
    // The labels are this file's words; the values they send are the check
    // constraint's. Both are asserted — the label list here, the value below
    // in "what reaches the queue" — because a picker that shows six options and
    // sends a seventh string would fail at the database and nowhere earlier.
    [
      'Harassment or bullying',
      'Spam',
      'Sexual content',
      'Violence or threats',
      'Self-harm',
      'Something else',
    ].forEach((label) => expect(screen.getByLabelText(label)).toBeTruthy());
  });

  it('will not file until one is picked', async () => {
    await mount(TASK);
    fireEvent.press(screen.getByLabelText('File this report'));
    expect(seenState.reported).toEqual([]);
    expect(pending()).toHaveLength(0);
  });
});

describe('filing it', () => {
  it('hides the thing locally', async () => {
    await mount(TASK);
    file();
    expect(seenState.reported).toContain('f1');
  });

  it('queues the report with the constraint’s own value for the reason', async () => {
    await mount(TASK);
    file('Self-harm');
    const entry = pending().find((e) => e.op === 'report.file');
    expect(entry?.payload).toMatchObject({
      subjectKind: 'task',
      subjectId: 'f1',
      reason: 'self_harm',
    });
  });

  it('does not block anyone', async () => {
    await mount(TASK);
    file();
    expect(seenState.blocked).toEqual([]);
    expect(pending().some((e) => e.op === 'block.add')).toBe(false);
  });

  it('says what happened, and promises no review', async () => {
    await mount(TASK);
    file();
    expect(screen.getByText(/hidden from you/i)).toBeTruthy();
    expect(screen.getByText(/no moderation team/i)).toBeTruthy();
  });
});

describe('cancelling', () => {
  it('does nothing at all, even with a reason already picked', async () => {
    await mount(TASK);
    fireEvent.press(screen.getByLabelText('Spam'));
    fireEvent.press(screen.getByLabelText('Cancel'));
    expect(seenState.reportTarget).toBeNull();
    expect(seenState.reported).toEqual([]);
    expect(seenState.blocked).toEqual([]);
    expect(pending()).toHaveLength(0);
  });
});

describe('blocking, which is its own decision', () => {
  it('is offered only after a second confirmation', async () => {
    await mount(TASK);
    file();
    fireEvent.press(screen.getByLabelText(`Block ${'Maya Chen'}`));
    // Standing on the confirm is not blocking. Nothing has been written yet.
    expect(seenState.blocked).toEqual([]);
    fireEvent.press(screen.getByLabelText('Confirm block'));
    expect(seenState.blocked).toEqual([MAYA]);
  });

  it('queues the block', async () => {
    await mount(TASK);
    file();
    fireEvent.press(screen.getByLabelText('Block Maya Chen'));
    fireEvent.press(screen.getByLabelText('Confirm block'));
    expect(pending().find((e) => e.op === 'block.add')?.payload).toMatchObject({
      blockedId: MAYA,
    });
  });

  it('backing out of the confirm leaves them unblocked', async () => {
    await mount(TASK);
    file();
    fireEvent.press(screen.getByLabelText('Block Maya Chen'));
    fireEvent.press(screen.getByLabelText('Not now'));
    expect(seenState.blocked).toEqual([]);
    expect(pending().some((e) => e.op === 'block.add')).toBe(false);
  });

  it('says the circle is a separate thing, and what would change it', async () => {
    await mount(TASK);
    file();
    fireEvent.press(screen.getByLabelText('Block Maya Chen'));
    expect(screen.getByText(/circle/i)).toBeTruthy();
    expect(screen.getByText(/ranked list/i)).toBeTruthy();
    // It used to end "Rally has no way to do that yet", which stopped being
    // true the moment Settings grew a leave row.
    expect(screen.getByText(/leaving a circle/i)).toBeTruthy();
    expect(screen.getByText(/Settings is where you do it/i)).toBeTruthy();
    expect(screen.queryByText(/no way to do that yet/i)).toBeNull();
  });

  it('is not offered on a bot, which the database refuses anyway', async () => {
    await mount(
      { kind: 'task', id: 'oz1', who: 'dorothy' },
      { people: { dorothy: { id: 'dorothy', name: 'Dorothy Gale', first: 'Dorothy', initials: 'DG', bot: true } } },
    );
    file();
    expect(screen.queryByLabelText(/^Block /)).toBeNull();
  });

  it('is not offered on yourself', async () => {
    await mount({ kind: 'task', id: 'mine', who: 'you' }, { selfId: 'you' });
    file();
    expect(screen.queryByLabelText(/^Block /)).toBeNull();
  });
});

describe('reporting a person rather than a post', () => {
  it('does not claim to have hidden them, because it has not', async () => {
    await mount(PROFILE);
    file();
    expect(seenState.blocked).toEqual([]);
    expect(screen.getByText(/Blocking does/)).toBeTruthy();
  });
});
