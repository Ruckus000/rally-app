/**
 * This device's address, for the half of notifications that arrives when the
 * app is closed.
 *
 * The other half lives in `reminders.ts` and needs none of this: a local
 * notification is scheduled by the OS on this device and never leaves it. A
 * cheer is the opposite — it starts on somebody else's phone, so something has
 * to know where to send it, and that something is the token minted here.
 *
 * Deliberately thin. It fetches a string and says which platform it is for;
 * everything about *storing* it is the outbox's business, because registration
 * happens moments after a permission prompt, which is exactly when someone is
 * most likely to be on a bad connection.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

/** Matches `device_tokens_platform_known`. Anything else the server rejects. */
export type PushPlatform = 'ios' | 'android';

export type PushToken = { token: string; platform: PushPlatform };

/**
 * The EAS project id, which `getExpoPushTokenAsync` requires and does not
 * default. Read from both places the manifest can put it: `easConfig` in a
 * development build, `expoConfig.extra` in a release one.
 */
function projectId(): string | undefined {
  const fromEas = Constants.easConfig?.projectId;
  const fromExtra = Constants.expoConfig?.extra?.eas?.projectId;
  return (typeof fromEas === 'string' && fromEas) || (typeof fromExtra === 'string' && fromExtra)
    ? ((fromEas || fromExtra) as string)
    : undefined;
}

/**
 * The Expo push token for this install, or null if this device cannot have one.
 *
 * Null is an ordinary answer, not a failure, and it has four causes worth
 * naming because each one silently produced "push doesn't work" for somebody:
 *
 *  - **A simulator.** It cannot receive remote push at all. There is no way to
 *    test this feature on one, and no amount of correct code changes that.
 *  - **No permission.** Asked for elsewhere, at the moment the user taps the
 *    button that says we will.
 *  - **No `projectId`.** Before `eas init` there is nothing to mint a token
 *    against, and the underlying call throws rather than returning empty.
 *  - **A platform we do not build for.** `web` would fail the server's check
 *    constraint, so it never gets that far.
 *
 * Never throws. A phone that cannot be reached is a phone that opens the app
 * and reads its cheers there, which is what it did before any of this existed.
 */
export async function getPushToken(): Promise<PushToken | null> {
  // A simulator returns a token-shaped string on some Expo versions and throws
  // on others; neither can ever receive a push, so it is refused up front
  // rather than stored as an address nothing lives at.
  if (!Device.isDevice) return null;

  const platform = Platform.OS;
  if (platform !== 'ios' && platform !== 'android') return null;

  if (!(await Notifications.getPermissionsAsync()).granted) return null;

  const id = projectId();
  if (!id) return null;

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    return data ? { token: data, platform } : null;
  } catch {
    // APNs unreachable, no network, credentials not yet set up. All of them
    // mean "no address today", and the next foreground asks again.
    return null;
  }
}
