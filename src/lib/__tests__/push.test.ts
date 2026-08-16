/**
 * The push token, and the four separate reasons there isn't one.
 *
 * Each null branch here is a real "push doesn't work" report with a completely
 * different cause, and the function deliberately flattens them all to null —
 * so these tests are where the four stay told apart. The dangerous one is the
 * simulator: every device pass in this project runs on one, and a token minted
 * there is an address nothing lives at.
 */
import { getPushToken } from '../push';
import { fakeNotifications, fakePush, __resetForTests } from '../../__mocks__/expo-notifications';
import { fakeConstants } from '../../__mocks__/expo-constants';
import { fakeDevice } from '../../__mocks__/expo-device';

const PROJECT = '8ea00fe8-1b14-4c07-af19-896ec6950ae6';

beforeEach(() => {
  __resetForTests();
  fakeConstants.reset();
  fakeDevice.reset();
});

describe('when there is an address', () => {
  it('mints one on a real phone that granted permission', async () => {
    fakeNotifications.alreadyGranted();
    fakeConstants.easConfigProject(PROJECT);

    expect(await getPushToken()).toEqual({
      token: fakePush.token(),
      platform: 'ios',
    });
  });

  it('reads the project id out of the manifest too', async () => {
    // A release build has no `easConfig`; the id is baked into `extra`.
    // Reading only one of the two places works in exactly half of builds.
    fakeNotifications.alreadyGranted();
    fakeConstants.manifestProject(PROJECT);

    expect((await getPushToken())?.token).toBe(fakePush.token());
  });
});

describe('when there is not', () => {
  it('refuses a simulator, which can never receive a push', async () => {
    // The one that matters most here: every device pass in this project runs
    // on a simulator, so without this check the app would happily register an
    // address that no notification can ever reach — and the table would fill
    // with them.
    fakeNotifications.alreadyGranted();
    fakeConstants.easConfigProject(PROJECT);
    fakeDevice.asSimulator();

    expect(await getPushToken()).toBeNull();
  });

  it('says nothing without permission, rather than prompting', async () => {
    // Asking is `askForReminders`'s job, at the moment the user taps the
    // button that says we will. A token fetch that prompted would raise the
    // OS dialog from wherever this happened to be called.
    fakeConstants.easConfigProject(PROJECT);

    expect(await getPushToken()).toBeNull();
    expect(fakeNotifications.prompts()).toBe(0);
  });

  it('survives having no project id at all', async () => {
    // Before `eas init` there is nothing to mint against and the underlying
    // call throws. This is the single most common cause of "registration
    // silently does nothing", and it must not surface as a crash.
    fakeNotifications.alreadyGranted();

    expect(await getPushToken()).toBeNull();
  });

  it('survives the mint itself failing', async () => {
    // APNs unreachable, offline, credentials not yet set up. A phone that
    // cannot be reached reads its cheers in the app, which is what it did
    // before any of this existed.
    fakeNotifications.alreadyGranted();
    fakeConstants.easConfigProject(PROJECT);
    fakePush.failsToMint();

    expect(await getPushToken()).toBeNull();
  });
});
