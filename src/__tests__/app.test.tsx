/**
 * Render-level tests. The reducer tests prove the rules; these prove the
 * screens actually wire them up — that a tap reaches the right action and the
 * result reaches the screen.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { App } from '../App';
import { liveWeek } from '../data/week';
import { captureBackPress } from '../test/backPress';

/**
 * These tests are about the app behind onboarding — the week, the circle, the
 * ledger — so both helpers take the shortest honest route through the flow and
 * leave the flow itself to `overlays/onboard/__tests__/flow.test.tsx`.
 *
 * Backing out is that route. Onboarding's front door grants the account the
 * moment you choose it, and leaving from the door keeps what it granted without
 * staking a first week on top of the fixtures these tests are written against.
 */
let back: ReturnType<typeof captureBackPress>;

beforeEach(() => {
  back = captureBackPress();
});

afterEach(() => {
  back.restore();
});

/** The demo account: "Look around first" is what seeds the populated fixtures. */
function open(options?: { config?: React.ComponentProps<typeof App>['config'] }) {
  render(<App config={options?.config} persist={false} />);
  fireEvent.press(screen.getByLabelText('Look around first'));
  // Step 1 back to the front door, then out of it — the demo it granted stays.
  back.press();
  back.press();
}

/** Closing the front door without choosing is what leaves an empty account. */
function openFresh() {
  render(<App persist={false} />);
  back.press();
}

/** The first Oz post, spelled once. */
const OZ_POST = 'Walk 30 minutes every morning';

const goToPersonal = () => fireEvent.press(screen.getByText('Personal'));
/** One tab now: the circle and the public feed are one list. */
const goToFeed = () => fireEvent.press(screen.getByText('Feed'));

describe('shell', () => {
  it('shows the week from the week context, not a literal', () => {
    open();
    // The app reads the real clock now, so the assertion has to as well.
    const week = liveWeek();
    expect(screen.getByText(week.label)).toBeTruthy();
    expect(screen.getByText(`${week.dateRange} · ${week.todayName}`)).toBeTruthy();
  });

  it('lands on your own week after onboarding, and switches scope', () => {
    open();
    expect(screen.getByText('Ship the portfolio site')).toBeTruthy();
    goToFeed();
    expect(screen.getByText('7 of 7 — the entire thing')).toBeTruthy();
  });

  it('moves between tabs', () => {
    open();
    fireEvent.press(screen.getByLabelText('Circle'));
    expect(screen.getByText('Top performers this week')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Me'));
    expect(screen.getByText('Alex Rivera')).toBeTruthy();
  });
});

describe('week feed', () => {
  it('closes a task and moves it out of STILL OPEN', () => {
    open();
    goToPersonal();
    expect(screen.getByText('1 of 6 done')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Ship the portfolio site'));
    expect(screen.getByText('2 of 6 done')).toBeTruthy();
  });

  it('shows the perfect-week card only once everything is closed', () => {
    open();
    goToPersonal();
    expect(screen.queryByText('Post it to the circle')).toBeNull();
    [
      'Ship the portfolio site',
      'Therapy homework',
      'Read 100 pages',
      'Inbox zero by Friday',
      'Meal prep for the week',
    ].forEach((title) => fireEvent.press(screen.getByLabelText(title)));
    expect(screen.getByText('Post it to the circle')).toBeTruthy();
    expect(screen.getByText('All 6 of it.')).toBeTruthy();
  });

  it('turns a zero cheer count into the verb, and back again', () => {
    open();
    goToFeed();
    // Sofia's quiet win has no cheers yet.
    expect(screen.getAllByLabelText('Cheer').length).toBeGreaterThan(0);
    fireEvent.press(screen.getAllByLabelText('Cheer')[0]);
    expect(screen.getByLabelText('Take back your cheer')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Take back your cheer'));
    expect(screen.getAllByLabelText('Cheer').length).toBeGreaterThan(0);
  });
});

describe('circle', () => {
  it('shows follow-through as the row metric, never points', () => {
    open();
    fireEvent.press(screen.getByLabelText('Circle'));
    expect(screen.getByText('67% · 4 of 6 · 🔥 4w')).toBeTruthy();
    expect(screen.queryByText(/\bpts\b/)).toBeNull();
  });

  it('honours showRank: false', () => {
    open({ config: { showRank: false, defaultAudience: 'friends', quietComebacks: true } });
    fireEvent.press(screen.getByLabelText('Circle'));
    expect(screen.getByText('7 people, checking in on each other')).toBeTruthy();
  });
});

describe('config', () => {
  it('honours quietComebacks: false by dropping the quiet item', () => {
    open({ config: { showRank: true, defaultAudience: 'friends', quietComebacks: false } });
    goToFeed();
    expect(screen.queryByText(/Tomás’s week didn’t finish/)).toBeNull();
  });

  it('shows the quiet item by default', () => {
    open();
    goToFeed();
    expect(screen.getByText(/Tomás’s week didn’t finish/)).toBeTruthy();
  });
});

describe('plan', () => {
  it('opens from the FAB and refuses an empty stake', () => {
    open();
    fireEvent.press(screen.getByLabelText('Plan your week'));
    expect(screen.getByText('Write it down first')).toBeTruthy();
  });

  it('falls back to the category price when nothing rates the goal', () => {
    // A demo account makes no network calls at all, so nothing is ever rated
    // here and the composer shows what the category has always been worth.
    // This is also what a live account sees with the network off, which is the
    // property that matters: staking never waits on a model.
    open();
    fireEvent.press(screen.getByLabelText('Plan your week'));
    fireEvent.changeText(screen.getByLabelText('What will you do?'), 'Swim on Sunday');
    fireEvent.press(screen.getByLabelText('Work'));
    expect(screen.getByText(/Stake it on .* · \+45 pts/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Home'));
    expect(screen.getByText(/Stake it on .* · \+25 pts/)).toBeTruthy();
  });

  it('unstakes a task', () => {
    open();
    fireEvent.press(screen.getByLabelText('Plan your week'));
    expect(screen.getByText('Staked · 6')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Unstake Read 100 pages'));
    expect(screen.getByText('Staked · 5')).toBeTruthy();
  });

  it('loads a stake into the composer for editing', () => {
    open();
    goToPersonal();
    fireEvent.press(screen.getByLabelText('Open Ship the portfolio site'));
    fireEvent.press(screen.getByLabelText('Edit Ship the portfolio site'));
    expect(screen.getByText('Editing a stake')).toBeTruthy();
    expect(screen.getByLabelText('What will you do?').props.value).toBe('Ship the portfolio site');
  });
});

describe('notifications', () => {
  it('badges only the needs-you tier and clears per item', () => {
    open();
    expect(screen.getByLabelText('Notifications, 3 needing you')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Notifications, 3 needing you'));
    fireEvent.press(screen.getByText('Mark all read'));
    fireEvent.press(screen.getByLabelText('Close notifications'));
    expect(screen.getByLabelText('Notifications')).toBeTruthy();
  });
});

describe('ledger', () => {
  it('opens a historical week with that week’s data', () => {
    open();
    fireEvent.press(screen.getByLabelText('Me'));
    // Derived, like the test below it. The history is seeded relative to the
    // live week, so a hardcoded number is only right until the next Monday —
    // and CI runs in UTC, which turns that into a build that fails on a date
    // rather than on a change.
    const lastWeek = liveWeek().number - 1;
    fireEvent.press(screen.getByLabelText(`Week ${lastWeek}, 6 of 7 done, 190 pts`));
    expect(screen.getByText('Ship newsletter draft')).toBeTruthy();
    expect(screen.getByText('Back to today')).toBeTruthy();
  });

  it('labels the current week differently', () => {
    open();
    fireEvent.press(screen.getByLabelText('Me'));
    fireEvent.press(screen.getByText('See this week’s ledger'));
    expect(screen.getByText('Not yet')).toBeTruthy();
    expect(screen.getByText(`Stake Week ${liveWeek().number + 1}`)).toBeTruthy();
  });
});

describe('a genuinely empty first run', () => {
  it('shows nothing staked on your own week', () => {
    openFresh();
    goToPersonal();
    expect(screen.getByText('Nothing staked yet')).toBeTruthy();
    expect(screen.getByText('The week doesn’t count itself.')).toBeTruthy();
  });

  it('asks you to bring someone in, under a feed that is not empty', () => {
    // This used to be the "Nobody here yet" empty state, because the circle's
    // feed was its own tab and an account with no circle had nothing in it.
    // Merged, there is always the public half to read — so the ask is a footer
    // under real content rather than a page saying nothing.
    openFresh();
    goToFeed();
    expect(screen.getByText(OZ_POST)).toBeTruthy();
    expect(screen.getByText('Invite someone')).toBeTruthy();
  });

  it('shows a circle of one', () => {
    openFresh();
    fireEvent.press(screen.getByLabelText('Circle'));
    expect(screen.getByText('A circle of one')).toBeTruthy();
    expect(screen.queryByText('Top performers this week')).toBeNull();
  });

  it('has no bell badge and a written notifications empty state', () => {
    openFresh();
    expect(screen.getByLabelText('Notifications')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Notifications'));
    expect(screen.getByText('Nothing needs you')).toBeTruthy();
    expect(screen.queryByText('Mark all read')).toBeNull();
  });

  it('zeroes the profile instead of showing the demo numbers', () => {
    openFresh();
    fireEvent.press(screen.getByLabelText('Me'));
    // A fresh profile legitimately has several zeros; what matters is that
    // none of the demo's numbers survived.
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.queryByText('2,840')).toBeNull();
    expect(screen.queryByText('37')).toBeNull();
    expect(screen.queryByText('5w record')).toBeNull();
    expect(screen.getByText('Starts here')).toBeTruthy();
    expect(screen.getByText('No streak yet. Close a week and it starts.')).toBeTruthy();
    expect(screen.getByText(/This is your first week/)).toBeTruthy();
    // You haven't joined a circle, so don't claim membership of one.
    expect(screen.getByText('@alexrivera')).toBeTruthy();
    expect(screen.queryByText(/The Basement/)).toBeNull();
    expect(screen.getByText('Nothing exchanged yet. A cheer is one tap.')).toBeTruthy();
    // Personal bests read as em-dashes, never as a bare zero.
    expect(screen.getAllByText('—').length).toBe(4);
  });

  it('has no best week to beat, and no NaN in the Plan hero', () => {
    openFresh();
    fireEvent.press(screen.getByLabelText('Plan your week'));
    expect(screen.getByText('Nothing to beat yet. This is the one that sets the bar.')).toBeTruthy();
    expect(screen.queryByText(/BEST/)).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
    // Nobody to pair with, and nothing to pick back up.
    expect(screen.queryByText('In it with me')).toBeNull();
    expect(screen.queryByText('Pick it back up')).toBeNull();
  });

  it('still lets you stake your first task', () => {
    openFresh();
    fireEvent.press(screen.getByLabelText('Plan your week'));
    fireEvent.changeText(screen.getByLabelText('What will you do?'), 'Walk every morning');
    fireEvent.press(screen.getByText(/Stake it on/));
    expect(screen.getByText('Staked · 1')).toBeTruthy();
  });
});

describe('reset', () => {
  it('offers both a fresh start and the demo', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    open();
    fireEvent.press(screen.getByLabelText('Me'));
    fireEvent.press(screen.getByLabelText('Reset app data'));

    const buttons = spy.mock.calls[0][2] ?? [];
    expect(buttons.map((b) => b.text)).toEqual(['Cancel', 'Fresh start', 'Reload demo']);
    spy.mockRestore();
  });

  it('empties the account when fresh start is chosen', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    open();
    fireEvent.press(screen.getByLabelText('Me'));
    fireEvent.press(screen.getByLabelText('Reset app data'));
    const buttons = spy.mock.calls[0][2] ?? [];
    act(() => buttons.find((b) => b.text === 'Fresh start')?.onPress?.());
    spy.mockRestore();

    // An emptied account opens on Global, because the two tabs that would be
    // about you have nothing in them yet.
    expect(screen.getByText(OZ_POST)).toBeTruthy();
    goToPersonal();
    expect(screen.getByText('Nothing staked yet')).toBeTruthy();
  });
});

/**
 * The four accounts on the Global feed are openly fictional now — Oz
 * characters rather than `@kwon.builds`, and rows of the same shape as any
 * other week, so the feed is drawn by the component the Friends feed uses.
 */
describe('the feed', () => {
  it('is public, so a fresh account still sees it', () => {
    openFresh();
    goToFeed();
    expect(screen.getByText(OZ_POST)).toBeTruthy();
    // Named, not "Someone": the demo directory carries the Oz cast for exactly
    // this account, which knows nobody else at all.
    expect(screen.getByText('Dorothy Gale')).toBeTruthy();
  });

  it('is where a brand-new account lands, with no tap at all', () => {
    // The two tabs that would be about you are empty on a first launch: no
    // week staked, no circle joined. This one has something in it.
    openFresh();
    expect(screen.getByText(OZ_POST)).toBeTruthy();
  });

  it('reads newest first, not grouped by whoever posted', () => {
    // On device it came back in four blocks of one name — three cards from the
    // Tin Man in a row, which reads as one person shouting rather than as four
    // people having a week. The Friends feed has always sorted; this did not.
    openFresh();
    goToFeed();
    const cards = screen.getAllByLabelText(/^(Dorothy Gale|The Scarecrow|Tin Man|Cowardly Lion), /);
    const times = cards.map((c) => c.props.accessibilityLabel);
    expect(times[0]).toContain('Dorothy Gale');
    expect(times[times.length - 1]).toContain('Cowardly Lion');
  });

  it('is one of two tabs, the circle and the public feed having merged', () => {
    openFresh();
    const tabs = screen.getAllByRole('tab');
    expect(within(tabs[0]).getByText('Personal')).toBeTruthy();
    expect(within(tabs[1]).getByText('Feed')).toBeTruthy();
    // The scope row ends there — tabs[2] is the bottom nav, which shares the
    // role. Global and Friends are gone rather than merely renamed.
    expect(within(tabs[2]).getByText('Week')).toBeTruthy();
  });

  /**
   * The whole feature: with both halves in one list, the label is the only
   * thing that says which is which. Both directions are asserted, so swapping
   * them fails rather than half-passing.
   */
  it('labels your circle Friends and the bots Follow', () => {
    open();
    goToFeed();
    expect(screen.getByLabelText(`Dorothy Gale, Follow: ${OZ_POST}`)).toBeTruthy();
    expect(screen.getByLabelText(/^Sofia Park, Friends: /)).toBeTruthy();
  });

  it('interleaves the two halves rather than stacking them', () => {
    // Friends-first would be the two feeds one above the other, which is what
    // merging them was meant to stop.
    open();
    goToFeed();
    const labels = screen
      .getAllByLabelText(/, (Friends|Follow): /)
      .map((c) => (c.props.accessibilityLabel.includes(', Follow: ') ? 'follow' : 'circle'));
    expect(new Set(labels).size).toBe(2);
    // At least one changeover in each direction — a stacked feed has one.
    const flips = labels.filter((k, i) => i > 0 && k !== labels[i - 1]).length;
    expect(flips).toBeGreaterThan(1);
  });

  it('says the bots are not real, and offers a way out when you have no circle', () => {
    openFresh();
    goToFeed();
    expect(screen.getByText(/marked Follow are not real/)).toBeTruthy();
    fireEvent.press(screen.getByText('Invite someone'));
    expect(screen.getByText('Grow the circle')).toBeTruthy();
  });

  it('drops the nudge once you have a circle', () => {
    open();
    goToFeed();
    expect(screen.getByText(OZ_POST)).toBeTruthy();
    expect(screen.queryByText(/marked Follow are not real/)).toBeNull();
  });

  // The arithmetic is pinned in selectors.test.ts; what this proves is that the
  // sheet's cheer button — a dynamic dispatch a grep would miss — really does
  // fire with the global post's id and reaches YOU GAVE.
  it('cheering a stranger from the detail sheet still counts on Me', () => {
    open();
    fireEvent.press(screen.getByLabelText('Me'));
    expect(screen.getByText('12')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Week'));
    goToFeed();
    fireEvent.press(screen.getByLabelText(`Dorothy Gale, Follow: ${OZ_POST}`));
    fireEvent.press(screen.getByText('Cheer Dorothy'));
    fireEvent.press(screen.getByLabelText('Close'));

    fireEvent.press(screen.getByLabelText('Me'));
    expect(screen.getByText('13')).toBeTruthy();
  });

  it('keeps a note left on a bot’s post, and counts it on the card', () => {
    open();
    goToFeed();
    fireEvent.press(screen.getByLabelText(`Dorothy Gale, Follow: ${OZ_POST}`));
    fireEvent.changeText(screen.getByLabelText('Say something…'), 'Respect.');
    fireEvent.press(screen.getByLabelText('Send note'));

    expect(screen.getByText('Respect.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Close'));
    // The count is the thread's real length now. It used to be a fixture's
    // `comments: 12` with your note added on top — a number that counted
    // eleven replies nobody ever wrote.
    //
    // Scoped to Dorothy's card: the circle's cards are in this list too now,
    // and one of them has always carried a single note of its own.
    const card = screen.getByLabelText(`Dorothy Gale, Follow: ${OZ_POST}`);
    expect(within(card).getByLabelText('1 notes')).toBeTruthy();

    // And it is still there when you go back in, which is the "keeps" half.
    fireEvent.press(screen.getByLabelText(`Dorothy Gale, Follow: ${OZ_POST}`));
    expect(screen.getByText('Respect.')).toBeTruthy();
  });
});
