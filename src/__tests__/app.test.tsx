/**
 * Render-level tests. The reducer tests prove the rules; these prove the
 * screens actually wire them up — that a tap reaches the right action and the
 * result reaches the screen.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { App } from '../App';
import { CURRENT_WEEK } from '../data/week';

/** Skip onboarding and land on a given tab/scope. */
function open(options?: { config?: React.ComponentProps<typeof App>['config'] }) {
  render(<App config={options?.config} />);
  fireEvent.press(screen.getByText('Skip for now'));
}

const goToPersonal = () => fireEvent.press(screen.getByText('Personal'));

describe('shell', () => {
  it('shows the week from the week context, not a literal', () => {
    open();
    expect(screen.getByText(CURRENT_WEEK.label)).toBeTruthy();
    expect(screen.getByText(`${CURRENT_WEEK.dateRange} · ${CURRENT_WEEK.todayName}`)).toBeTruthy();
  });

  it('starts on the friends feed and switches scope', () => {
    open();
    expect(screen.getByText('7 of 7 — the entire thing')).toBeTruthy();
    goToPersonal();
    expect(screen.getByText('Ship the portfolio site')).toBeTruthy();
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
    render(<App config={{ showRank: true, defaultAudience: 'friends', quietComebacks: false }} />);
    fireEvent.press(screen.getByText('Skip for now'));
    expect(screen.queryByText(/Tomás’s week didn’t finish/)).toBeNull();
  });

  it('shows the quiet item by default', () => {
    open();
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
