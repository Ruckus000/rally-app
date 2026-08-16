/**
 * Signing out has to take this phone's address with it.
 *
 * A token left behind belongs to an account that has left the device, so the
 * next cheer that account receives arrives on a phone somebody else is now
 * holding — a stranger's name and a stranger's week, on your lock screen. It is
 * the worst thing this feature can do, and the only defence is one call in the
 * right order.
 *
 * "The right order" is the whole subject here: `unregister_device` deletes the
 * row matching `auth.uid()`, so it needs a session that `signOut` is about to
 * destroy. Nothing about that ordering is visible from reading either function.
 */
import { fakeSupabase } from '../../__mocks__/@supabase/supabase-js';
import { fakeNotifications, fakePush, __resetForTests } from '../../__mocks__/expo-notifications';
import { fakeConstants } from '../../__mocks__/expo-constants';
import { fakeDevice } from '../../__mocks__/expo-device';
import { getSupabase, __resetSupabaseForTests } from '../../lib/supabase';
import { ensureSession, signOutEverywhere, __resetSessionForTests } from '../session';

const PROJECT = '8ea00fe8-1b14-4c07-af19-896ec6950ae6';

/** A phone that can actually receive a push, which is the only interesting case. */
function aRealPhoneWithPermission() {
  fakeNotifications.alreadyGranted();
  fakeConstants.easConfigProject(PROJECT);
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  fakeSupabase.reset();
  __resetSupabaseForTests();
  __resetSessionForTests();
  __resetForTests();
  fakeConstants.reset();
  fakeDevice.reset();
});

/** Registers this device under the current session, as the app does. */
async function registerHere(): Promise<string> {
  const session = await ensureSession();
  const me = session.status === 'ready' ? session.userId : '';
  await getSupabase().rpc('register_device', {
    p_token: fakePush.token(),
    p_platform: 'ios',
  });
  return me;
}

describe('leaving an account', () => {
  it('deletes this device’s row', async () => {
    aRealPhoneWithPermission();
    await registerHere();
    expect(fakeSupabase.rows('device_tokens')).toHaveLength(1);

    await signOutEverywhere();

    expect(fakeSupabase.rows('device_tokens')).toEqual([]);
  });

  it('does it while the session still exists', async () => {
    // The ordering, asserted directly. `unregister_device` matches on
    // `auth.uid()`, so running it after `signOut` deletes nothing at all and
    // fails completely silently — the row survives, and so does the bug.
    aRealPhoneWithPermission();
    await registerHere();

    await signOutEverywhere();

    const order = fakeSupabase.calls
      .filter((c) => c.table === 'unregister_device' || c.method === 'auth.signOut')
      .map((c) => c.table ?? c.method);
    // Both present, and in this order. Asserting only the first element would
    // pass on a list that never contained the sign-out at all.
    expect(order).toEqual(['unregister_device', 'auth.signOut']);
  });

  it('still signs out when the delete cannot go through', async () => {
    // Offline. Being unable to tidy up is not a reason to keep somebody signed
    // in to an account they asked to leave.
    aRealPhoneWithPermission();
    await registerHere();
    fakeSupabase.goOffline();

    await expect(signOutEverywhere()).resolves.toBeUndefined();
  });

  it('signs out cleanly when there was never a token', async () => {
    // No permission, so `getPushToken` answers null and there is nothing to
    // forget. The common case, and it must not throw on the way out.
    await ensureSession();

    await expect(signOutEverywhere()).resolves.toBeUndefined();
    expect(fakeSupabase.calls.some((c) => c.table === 'unregister_device')).toBe(false);
  });
});

describe('the row a failed sign-out leaves behind', () => {
  it('is repaired by whoever registers on this phone next', async () => {
    // The offline case above has to leave something behind, so this is what
    // stops that being permanent: `register_device` moves the row rather than
    // adding one, which is why the token is the primary key. The moment
    // anybody signs in here, the stale address becomes theirs.
    aRealPhoneWithPermission();
    const first = await registerHere();
    fakeSupabase.goOffline();
    await signOutEverywhere();
    fakeSupabase.goOnline();

    const second = await registerHere();

    expect(second).not.toBe(first);
    expect(fakeSupabase.rows('device_tokens')).toEqual([
      expect.objectContaining({ token: fakePush.token(), profile_id: second }),
    ]);
  });
});
