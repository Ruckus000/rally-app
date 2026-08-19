/**
 * The doors onto reporting and blocking, and the door back out again.
 *
 * `ReportSheet` was already written and already tested, and until now it was
 * unreachable: nothing in the app dispatched `OPEN_REPORT`. A flow nobody can
 * start is the same as no flow, so what is worth proving here is not the sheet
 * — that is `ReportSheet.test.tsx`'s job — but the four things around it:
 *
 * 1. The entry points exist, on the task sheet, the person sheet and a note.
 * 2. They are *absent* where the server would refuse. `block_person` raises on
 *    a bot and on yourself, and `blocks_not_self` raises under it. A control
 *    that opens a flow ending in a raised exception is worse than no control,
 *    so the assertions here are as much about what is missing as what is there.
 * 3. Blocking from the person sheet reaches both halves — the reducer and the
 *    outbox. Only one of them makes the block survive the app being closed.
 * 4. The blocked list can name people it has never pulled. The migration's own
 *    argument for shipping this list is that "a block you cannot find is a
 *    block you cannot lift", and a row that renders the total lookup's
 *    "Someone" for a uuid the directory has never seen is a row that cannot be
 *    told from any other. That one has bitten this codebase before.
 *
 * Rendered through the real `StoreProvider` with `persist` and `sync` off, and
 * seeded through `restored`, which is the store's only seam for standing a
 * component up mid-flow.
 */
import React from 'react';
import { Alert, AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StoreProvider, useStore } from '../../state/store';
import { DetailSheet } from '../DetailSheet';
import { SettingsOverlay } from '../SettingsOverlay';
import { DEMO_PEOPLE, indexPeople, personOf } from '../../data/people';
import { pending, __resetOutboxForTests } from '../../sync/outbox';
import type { Moment, Note, Task } from '../../data/fixtures';

const MAYA = 'maya';
const DRE = 'dre';
const BOT = 'tinman';
const SELF = 'you';
/** A blocked account the directory has never heard of — the whole point of §4. */
const STRANGER = '9c3f1d2e-0000-4000-8000-abcdefabcdef';

/** The demo cast, plus one person the server would call a bot. */
const PEOPLE = indexPeople([
  ...DEMO_PEOPLE,
  personOf(BOT, 'Tin Man', { bot: true }),
]);

const note = (k: string, w: string, t: string, id?: string): Note => ({ k, w, t, id });

const moment = (who: string, cmts: Note[] = []): Moment => ({
  id: 'm1',
  who,
  kind: 'big',
  time: '2h',
  day: 1,
  title: 'Ran the whole loop',
  cmts,
});

const myTask = (): Task => ({
  id: 't1',
  day: 1,
  title: 'Ship the thing',
  cat: 'Work',
  pts: 45,
  done: false,
  aud: 'friends',
  pair: [],
  pairKind: null,
  cmts: [],
  source: 'staked',
});

let seenState: ReturnType<typeof useStore>['state'];

function Watch() {
  const { state } = useStore();
  React.useEffect(() => {
    seenState = state;
  });
  return null;
}

/**
 * Awaited, like every other overlay suite here: `useReducedMotion` asks the OS
 * a question that resolves a microtask after render, and letting it settle
 * inside `act` is the difference between a clean run and a wall of warnings.
 */
const mount = async (restored: Record<string, unknown>, node: React.ReactNode) => {
  const tree = render(
    <StoreProvider
      persist={false}
      sync={false}
      restored={{ account: 'seeded', people: PEOPLE, ...restored }}
    >
      <Watch />
      {node}
    </StoreProvider>,
  );
  await act(async () => {});
  return tree;
};

const sheet = (restored: Record<string, unknown>) =>
  mount(restored, <DetailSheet bottomInset={0} />);

const settings = (restored: Record<string, unknown>) =>
  mount({ settingsOpen: true, ...restored }, <SettingsOverlay topInset={0} />);

beforeEach(() => {
  __resetOutboxForTests();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/* ── the task sheet ──────────────────────────────────────────────────────── */

describe('reporting a post', () => {
  it('opens the report sheet on the post you are looking at', async () => {
    await sheet({ sheet: { type: 'task', id: 'm1' }, moments: [moment(MAYA)] });

    fireEvent.press(screen.getByLabelText('Report this post'));

    expect(seenState.reportTarget).toEqual({ kind: 'task', id: 'm1', who: MAYA });
  });

  it('is not offered on your own week — there is nobody to report', async () => {
    await sheet({ sheet: { type: 'task', id: 't1' }, myTasks: [myTask()] });

    expect(screen.queryByLabelText(/^Report/)).toBeNull();
  });

  it('is not offered on a bot, which the server would refuse to block', async () => {
    await sheet({ sheet: { type: 'task', id: 'm1' }, moments: [moment(BOT)] });

    expect(screen.queryByLabelText(/^Report/)).toBeNull();
  });
});

/* ── the person sheet ────────────────────────────────────────────────────── */

describe('reporting and blocking a person', () => {
  it('opens the report sheet on them', async () => {
    await sheet({ sheet: { type: 'person', id: MAYA } });

    fireEvent.press(screen.getByLabelText('Report Maya Chen'));

    expect(seenState.reportTarget).toEqual({ kind: 'profile', id: MAYA, who: MAYA });
  });

  it('asks before blocking, and does nothing at all until it is answered', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await sheet({ sheet: { type: 'person', id: MAYA } });

    fireEvent.press(screen.getByLabelText('Block Maya Chen'));

    expect(alert).toHaveBeenCalled();
    expect(seenState.blocked).toEqual([]);
    expect(pending()).toHaveLength(0);
  });

  it('blocks both halves once it is: the reducer and the outbox', async () => {
    // Only the queue survives the app closing. A block that moved local state
    // and nothing else comes back on the next pull as no block at all.
    let confirm: (() => void) | undefined;
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      confirm = buttons?.find((b) => b.style === 'destructive')?.onPress as () => void;
    });
    await sheet({ sheet: { type: 'person', id: MAYA } });

    fireEvent.press(screen.getByLabelText('Block Maya Chen'));
    await act(async () => {
      confirm?.();
    });

    expect(seenState.blocked).toEqual([MAYA]);
    expect(pending().map((e) => e.op)).toContain('block.add');
    // The sheet you blocked from was full of the person you just blocked.
    expect(seenState.sheet).toBeNull();
  });

  it('offers neither on yourself', async () => {
    await sheet({ sheet: { type: 'person', id: SELF } });

    expect(screen.queryByLabelText(/^Report/)).toBeNull();
    expect(screen.queryByLabelText(/^Block/)).toBeNull();
  });

  it('offers neither on a bot', async () => {
    await sheet({ sheet: { type: 'person', id: BOT } });

    expect(screen.queryByLabelText(/^Report/)).toBeNull();
    expect(screen.queryByLabelText(/^Block/)).toBeNull();
  });
});

/* ── a note in a thread ──────────────────────────────────────────────────── */

describe('reporting a note', () => {
  it('is a long press on the note itself, not a button on every one', async () => {
    await sheet({
      sheet: { type: 'task', id: 'm1' },
      moments: [moment(MAYA, [note(DRE, 'Dre', 'Machine.', 'n1')])],
    });

    fireEvent(screen.getByLabelText('Note from Dre: Machine.'), 'longPress');

    expect(seenState.reportTarget).toEqual({ kind: 'note', id: 'n1', who: DRE });
  });

  it('leaves your own notes alone', async () => {
    await sheet({
      sheet: { type: 'task', id: 'm1' },
      moments: [moment(MAYA, [note(SELF, 'You', 'On it.', 'n2')])],
    });

    expect(screen.queryByLabelText('Note from You: On it.')).toBeNull();
  });

  it('leaves a note with no id alone, because there is nothing to file against', async () => {
    // Fixture notes predate ids. A report filed against `undefined` is a row
    // the server would take and nobody could ever act on.
    await sheet({
      sheet: { type: 'task', id: 'm1' },
      moments: [moment(MAYA, [note(DRE, 'Dre', 'No id here.')])],
    });

    expect(screen.queryByLabelText('Note from Dre: No id here.')).toBeNull();
  });
});

/* ── the way back ────────────────────────────────────────────────────────── */

describe('the blocked list', () => {
  it('says something human when there is nobody on it', async () => {
    await settings({ blocked: [] });

    expect(screen.queryByLabelText(/^Unblock/)).toBeNull();
    expect(screen.getByText(/Nobody/)).toBeTruthy();
  });

  it('names the people it knows', async () => {
    await settings({ blocked: [MAYA] });

    expect(screen.getByText('Maya Chen')).toBeTruthy();
    expect(screen.getByLabelText('Unblock Maya Chen')).toBeTruthy();
  });

  it('lifts a block in both halves', async () => {
    await settings({ blocked: [MAYA] });

    fireEvent.press(screen.getByLabelText('Unblock Maya Chen'));

    expect(seenState.blocked).toEqual([]);
    expect(pending().map((e) => e.op)).toContain('block.remove');
  });

  /**
   * The row this whole section is for. `people.name()` is total and answers
   * "Someone" for an id it has never seen, and a list of identical "Someone"s
   * is a list you cannot use to lift the right block. The name comes from the
   * directory or it is not claimed at all.
   */
  it('does not invent a name for someone it has never pulled', async () => {
    await settings({ blocked: [STRANGER] });

    expect(screen.queryByText('Someone')).toBeNull();
    // Enough of the uuid to tell two rows apart, the way the account row does.
    expect(screen.getByText(/9c3f1d2e/)).toBeTruthy();
    expect(screen.getByLabelText(/^Unblock/)).toBeTruthy();
  });

  it('still lifts a block on someone it cannot name', async () => {
    await settings({ blocked: [STRANGER] });

    fireEvent.press(screen.getByLabelText(/^Unblock/));

    expect(seenState.blocked).toEqual([]);
    expect(pending().map((e) => e.payload)).toContainEqual({ blockedId: STRANGER });
  });
});
