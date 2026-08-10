/**
 * Render-level tests. The reducer tests prove the rules; these prove the
 * screens actually wire them up — that a tap reaches the right action and the
 * result reaches the screen.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../App';
import { CURRENT_WEEK } from '../data/week';

/** Join the demo circle, which is what seeds the populated fixtures. */
function open(options?: { config?: React.ComponentProps<typeof App>['config'] }) {
  render(<App config={options?.config} persist={false} />);
  fireEvent.press(screen.getByText('Join The Basement'));
  // Joining lands on the onboarding Plan step; step past it into the app.
  fireEvent.press(screen.getByText('Start my week'));
}

/** Decline the invite, which is what produces an empty first-run account. */
function openFresh() {
  render(<App persist={false} />);
  fireEvent.press(screen.getByText('Skip for now'));
}

const goToPersonal = () => fireEvent.press(screen.getByText('Personal'));
const goToFriends = () => fireEvent.press(screen.getByText('Friends'));
const goToGlobal = () => fireEvent.press(screen.getByText('Global'));

describe('shell', () => {
  it('shows the week from the week context, not a literal', () => {
    open();
    expect(screen.getByText(CURRENT_WEEK.label)).toBeTruthy();
    expect(screen.getByText(`${CURRENT_WEEK.dateRange} · ${CURRENT_WEEK.todayName}`)).toBeTruthy();
  });

  it('lands on your own week after onboarding, and switches scope', () => {
    open();
    expect(screen.getByText('Ship the portfolio site')).toBeTruthy();
    goToFriends();
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
    goToFriends();
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
    goToFriends();
    expect(screen.queryByText(/Tomás’s week didn’t finish/)).toBeNull();
  });

  it('shows the quiet item by default', () => {
    open();
    goToFriends();
    expect(screen.getByText(/Tomás’s week didn’t finish/)).toBeTruthy();
  });
});

describe('plan', () => {
  it('opens from the FAB and refuses an empty stake', () => {
    open();
    fireEvent.press(screen.getByLabelText('Plan your week'));
    expect(screen.getByText('Write it down first')).toBeTruthy();
  });

  it('prices the stake from the chosen category', () => {
    open();
    fireEvent.press(screen.getByLabelText('Plan your week'));
    fireEvent.changeText(screen.getByLabelText('What will you do?'), 'Swim on Sunday');
    fireEvent.press(screen.getByLabelText('Work, 45 points'));
    expect(screen.getByText(/Stake it on .* · \+45 pts/)).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Home, 25 points'));
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
    fireEvent.press(screen.getByLabelText('Week 32, 6 of 7 done, 190 pts'));
    expect(screen.getByText('Ship newsletter draft')).toBeTruthy();
    expect(screen.getByText('Back to today')).toBeTruthy();
  });

  it('labels the current week differently', () => {
    open();
    fireEvent.press(screen.getByLabelText('Me'));
    fireEvent.press(screen.getByText('See this week’s ledger'));
    expect(screen.getByText('Not yet')).toBeTruthy();
    expect(screen.getByText(`Stake Week ${CURRENT_WEEK.number + 1}`)).toBeTruthy();
  });
});

describe('a genuinely empty first run', () => {
  it('shows nothing staked on your own week', () => {
    openFresh();
    goToPersonal();
    expect(screen.getByText('Nothing staked yet')).toBeTruthy();
    expect(screen.getByText('The week doesn’t count itself.')).toBeTruthy();
  });

  it('asks you to bring someone in rather than showing an empty feed', () => {
    openFresh();
    goToFriends();
    expect(screen.getByText('Nobody here yet')).toBeTruthy();
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

    expect(screen.getByText('Nothing staked yet')).toBeTruthy();
  });
});

describe('the global feed', () => {
  it('is public, so a fresh account still sees it', () => {
    openFresh();
    goToGlobal();
    expect(screen.getByText('Day 77 — still going')).toBeTruthy();
  });

  it('explains the strangers and offers a way out when you have no circle', () => {
    openFresh();
    goToGlobal();
    expect(screen.getByText(/These are strangers/)).toBeTruthy();
    fireEvent.press(screen.getByText('Invite someone'));
    expect(screen.getByText('Grow the circle')).toBeTruthy();
  });

  it('drops the nudge once you have a circle', () => {
    open();
    goToGlobal();
    expect(screen.getByText('Day 77 — still going')).toBeTruthy();
    expect(screen.queryByText(/These are strangers/)).toBeNull();
  });

  // The arithmetic is pinned in selectors.test.ts; what this proves is that the
  // sheet's cheer button — a dynamic dispatch a grep would miss — really does
  // fire with the global post's id and reaches YOU GAVE.
  it('cheering a stranger from the detail sheet still counts on Me', () => {
    open();
    fireEvent.press(screen.getByLabelText('Me'));
    expect(screen.getByText('12')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Week'));
    goToGlobal();
    fireEvent.press(screen.getByLabelText('@kwon.builds: Day 77 — still going'));
    fireEvent.press(screen.getByText('Cheer kwon.builds'));
    fireEvent.press(screen.getByLabelText('Close'));

    fireEvent.press(screen.getByLabelText('Me'));
    expect(screen.getByText('13')).toBeTruthy();
  });

  it('keeps a note left on a stranger’s post, and counts it', () => {
    open();
    goToGlobal();
    fireEvent.press(screen.getByLabelText('@kwon.builds: Day 77 — still going'));
    fireEvent.changeText(screen.getByLabelText('Say something…'), 'Respect.');
    fireEvent.press(screen.getByLabelText('Send note'));

    expect(screen.getByText('Respect.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Close'));
    // The public count moves the way the cheer count does: 12 -> 13.
    expect(screen.getByText('13')).toBeTruthy();
  });
});
