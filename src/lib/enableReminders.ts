/**
 * One permission grant, two consequences — in one place, because two screens ask.
 *
 * Onboarding has always done this: ask, and if the answer is yes, schedule the
 * Monday reminder *and* register this device for push. The Settings page asks
 * the same question and needs the same two consequences, and for a while it did
 * only the first half of the first one — it flipped the permission and scheduled
 * nothing, while the row said "On. Monday morning, with what you staked." The
 * next reminder would not exist until `useWeekReminder`'s inputs changed or the
 * app restarted. Same species of bug as the button that could not work: the UI
 * asserting something that is not true yet.
 *
 * Its own module rather than an addition to `reminders.ts`, which is
 * deliberately a device concern with no network in it at all — registering a
 * push token is a write to the server, and `queueDeviceToken` belongs to the
 * outbox. This is the seam where those two meet, and naming it is cheaper than
 * explaining twice why they happen together.
 */
import { askForReminders, scheduleWeekReminder, type ReminderPermission } from './reminders';
import { getPushToken } from './push';
import { queueDeviceToken } from '../sync/engine';

export async function enableReminders(
  weekNumber: number,
  stakedPoints: number,
): Promise<ReminderPermission> {
  const answer = await askForReminders();
  if (answer !== 'granted') return answer;

  await scheduleWeekReminder(weekNumber, stakedPoints);

  // Queued, not awaited against the UI: this runs on whatever connection the
  // user happens to have at the moment they tapped, and the outbox is what
  // makes that survivable. Null on a simulator, or before the credentials
  // exist — both mean "no address today", not an error.
  const device = await getPushToken();
  if (device) queueDeviceToken(device.token, device.platform);

  return answer;
}
