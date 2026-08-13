/**
 * The Monday reminder — the only notification this build can actually send.
 *
 * A cheer needs remote push and a paid Apple programme. This is local, needs
 * neither, and is the second preview the onboarding screen has always drawn.
 */
import {
  askForReminders,
  cancelWeekReminder,
  nextMonday,
  reminderBody,
  scheduleWeekReminder,
} from '../reminders';
import { fakeNotifications, __resetForTests } from '../../__mocks__/expo-notifications';

beforeEach(() => __resetForTests());

describe('when it fires', () => {
  it('lands on the next Monday morning', () => {
    // A Wednesday.
    expect(nextMonday(new Date(2026, 7, 12, 21, 0)).toISOString()).toBe(
      new Date(2026, 7, 17, 8, 0).toISOString(),
    );
  });

  it('skips a Monday that has already happened today', () => {
    // 9am on a Monday: today's 8am is gone, so the reminder is next week's.
    // Without this the notification would be scheduled into the past, where
    // iOS delivers it immediately — a "your week opens today" at 9:01am on the
    // day it already opened.
    expect(nextMonday(new Date(2026, 7, 17, 9, 0)).toISOString()).toBe(
      new Date(2026, 7, 24, 8, 0).toISOString(),
    );
  });

  it('still takes today when Monday has not got there yet', () => {
    expect(nextMonday(new Date(2026, 7, 17, 6, 0)).toISOString()).toBe(
      new Date(2026, 7, 17, 8, 0).toISOString(),
    );
  });
});

describe('what it says', () => {
  it('reads out the week and what is on the line', () => {
    expect(reminderBody(33, 35)).toBe('Week 33 opens today. You staked 35 pts — time to move.');
  });

  it('says "pt" for one, because "1 pts" is the tell of a template', () => {
    expect(reminderBody(33, 1)).toContain('1 pt —');
  });

  it('does not claim a stake nobody made', () => {
    expect(reminderBody(33, 0)).toBe('Week 33 opens today. Nothing staked yet.');
  });
});

describe('permission', () => {
  it('schedules nothing until it is granted', async () => {
    await scheduleWeekReminder(33, 35);

    // The button is the only place that asks. Scheduling without permission is
    // how you get an app that silently does nothing and looks like it works.
    expect(fakeNotifications.scheduled()).toHaveLength(0);
  });

  it('schedules once granted', async () => {
    fakeNotifications.grantOnAsk();
    expect(await askForReminders()).toBe('granted');

    await scheduleWeekReminder(33, 35, new Date(2026, 7, 12, 21, 0));

    const [pending] = fakeNotifications.scheduled();
    expect(pending.content.body).toContain('You staked 35 pts');
    expect(pending.trigger.date.toISOString()).toBe(new Date(2026, 7, 17, 8, 0).toISOString());
  });

  it('reports a refusal rather than pretending', async () => {
    expect(await askForReminders()).toBe('denied');
    expect(fakeNotifications.prompts()).toBe(1);
  });

  it('does not prompt twice after a refusal', async () => {
    await askForReminders();
    await askForReminders();

    // iOS shows its prompt once. Asking again resolves from the stored answer,
    // so a caller that treats denial as retryable just re-reads the same no.
    expect(fakeNotifications.prompts()).toBe(1);
  });
});

describe('keeping the sentence true', () => {
  beforeEach(() => fakeNotifications.alreadyGranted());

  it('replaces the pending one rather than stacking', async () => {
    await scheduleWeekReminder(33, 35);
    await scheduleWeekReminder(33, 75);

    expect(fakeNotifications.scheduled()).toHaveLength(1);
    expect(fakeNotifications.scheduled()[0].content.body).toContain('75 pts');
  });

  it('follows a rollover onto the new week', async () => {
    await scheduleWeekReminder(33, 35);
    await scheduleWeekReminder(34, 0);

    // The one thing nobody could explain away: last week's number, read out on
    // the morning the new week opens.
    expect(fakeNotifications.scheduled()[0].content.body).toBe(
      'Week 34 opens today. Nothing staked yet.',
    );
  });

  it('cancels cleanly when there is nothing scheduled', async () => {
    await expect(cancelWeekReminder()).resolves.toBeUndefined();
  });
});
