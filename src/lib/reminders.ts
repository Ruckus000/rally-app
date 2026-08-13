/**
 * The Monday reminder, and the only notification this app can actually send.
 *
 * A cheer landing on someone's lock screen needs *remote* push, which needs
 * APNs and a paid Apple developer programme. This is the other half of the
 * screen that promises it: a **local** notification, scheduled on the device,
 * which needs neither — and which the design already draws, "Week 33 opens
 * today. You staked 35 pts."
 *
 * One reminder is scheduled at a time, for the next Monday, carrying the
 * numbers as they stand when it is scheduled. Not a repeating trigger, because
 * a repeat cannot update its own text: it would still be reading out this
 * week's points a month from now. Rescheduling on every change keeps the
 * sentence true, and the cost of the app never being opened again is one
 * accurate reminder rather than an endless stream of stale ones.
 */
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';

/** 8am local. Early enough to be the start of the day, late enough not to wake anyone. */
const HOUR = 8;
/** `Date.getDay()`: Sunday is 0, so Monday is 1. */
const MONDAY = 1;

/**
 * Tagged so this module only ever cancels its own. `cancelAllScheduled…` would
 * take anything a later feature schedules with it.
 */
const REMINDER = 'rally.week-opens';

export type ReminderPermission = 'granted' | 'denied';

/**
 * Ask, once, at the moment the user taps the button that says we will.
 *
 * iOS only shows its prompt the first time; afterwards this resolves from the
 * existing answer without showing anything, which is why the caller must treat
 * a `denied` as final rather than asking again.
 */
export async function askForReminders(): Promise<ReminderPermission> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return 'granted';
  // `canAskAgain: false` means iOS will not show the prompt, so requesting is
  // a no-op that resolves denied — asked anyway, because the answer is the same
  // and branching here would only duplicate what the OS already decides.
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted ? 'granted' : 'denied';
}

export async function hasReminderPermission(): Promise<boolean> {
  return (await Notifications.getPermissionsAsync()).granted;
}

/** The next Monday at 8am, or the one after if this Monday's has already gone. */
export function nextMonday(from: Date): Date {
  const at = new Date(from.getFullYear(), from.getMonth(), from.getDate(), HOUR, 0, 0, 0);
  const days = (MONDAY - at.getDay() + 7) % 7;
  at.setDate(at.getDate() + days);
  if (at.getTime() <= from.getTime()) at.setDate(at.getDate() + 7);
  return at;
}

/** What the design draws. Plural handled, because "1 pts" is the tell of a template. */
export function reminderBody(weekNumber: number, points: number): string {
  return points > 0
    ? `Week ${weekNumber} opens today. You staked ${points} ${points === 1 ? 'pt' : 'pts'} — time to move.`
    : `Week ${weekNumber} opens today. Nothing staked yet.`;
}

/**
 * Replace the pending reminder with one that reads correctly for right now.
 *
 * Silent when permission was never granted: scheduling would throw on some
 * platforms and succeed-into-nothing on others, and neither is worth a branch
 * at the call sites.
 */
export async function scheduleWeekReminder(
  weekNumber: number,
  points: number,
  now: Date = new Date(),
): Promise<void> {
  if (!(await hasReminderPermission())) return;

  await cancelWeekReminder();
  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER,
    content: { title: 'Rally', body: reminderBody(weekNumber, points) },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: nextMonday(now) },
  });
}

export async function cancelWeekReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(REMINDER).catch(() => {
    // Nothing scheduled under that id. Cancelling something absent is the
    // normal case on a first run, not a failure worth surfacing.
  });
}

/**
 * Keep the pending reminder's sentence true.
 *
 * Runs on the week and the staked total, which are the only two things it says.
 * Deliberately not on every state change: rescheduling is a round trip to the
 * OS, and a reminder that reads correctly does not need rewriting because a
 * sheet opened.
 *
 * A rollover changes both at once and is the case that matters most — the old
 * week's number in Monday's reminder would be the one thing nobody could
 * explain away.
 */
export function useWeekReminder(weekNumber: number, stakedPoints: number): void {
  useEffect(() => {
    void scheduleWeekReminder(weekNumber, stakedPoints);
  }, [weekNumber, stakedPoints]);
}
