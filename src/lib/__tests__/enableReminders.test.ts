/**
 * The seam where a permission grant becomes two consequences.
 *
 * This is the function both Onboarding and Settings call so a "yes" always
 * means the same thing: the reminder gets scheduled *and* the device gets
 * registered for push. The bug it replaced flipped the permission in Settings
 * and did neither of those — the row said "On. Monday morning, with what you
 * staked." while nothing was scheduled until something else happened to
 * change. These tests are here, not just on `reminders.ts` or `push.ts` in
 * isolation, because the thing that broke was the pairing.
 */
import { enableReminders } from '../enableReminders';
import { fakeNotifications, fakePush, __resetForTests } from '../../__mocks__/expo-notifications';
import { fakeConstants } from '../../__mocks__/expo-constants';
import { fakeDevice } from '../../__mocks__/expo-device';
import { __resetOutboxForTests, pending } from '../../sync/outbox';

const PROJECT = '8ea00fe8-1b14-4c07-af19-896ec6950ae6';

beforeEach(() => {
  __resetForTests();
  fakeConstants.reset();
  fakeDevice.reset();
  __resetOutboxForTests();
});

describe('on a grant', () => {
  it('schedules the week reminder and registers the push token', async () => {
    fakeNotifications.grantOnAsk();
    fakeConstants.easConfigProject(PROJECT);

    const answer = await enableReminders(33, 35);

    expect(answer).toBe('granted');

    const [scheduled] = fakeNotifications.scheduled();
    expect(scheduled.content.body).toContain('You staked 35 pts');

    const queued = pending();
    expect(queued).toHaveLength(1);
    expect(queued[0].op).toBe('device.register');
    expect(queued[0].payload).toEqual({ token: fakePush.token(), platform: 'ios' });
  });

  it('still schedules when there is no address to register — a simulator, say', async () => {
    // `getPushToken` returning null (no device, no permission yet at the OS
    // level for push specifically, no project id, or a failed mint) is an
    // ordinary answer, not a reason to skip the reminder.
    fakeNotifications.grantOnAsk();
    fakeDevice.asSimulator();

    const answer = await enableReminders(33, 35);

    expect(answer).toBe('granted');
    expect(fakeNotifications.scheduled()).toHaveLength(1);
    expect(pending()).toHaveLength(0);
  });
});

describe('on a refusal', () => {
  it('schedules nothing and registers nothing, and reports the refusal', async () => {
    fakeConstants.easConfigProject(PROJECT);

    const answer = await enableReminders(33, 35);

    expect(answer).toBe('denied');
    expect(fakeNotifications.scheduled()).toHaveLength(0);
    expect(pending()).toHaveLength(0);
  });
});
