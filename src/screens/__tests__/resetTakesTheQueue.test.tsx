/**
 * "This clears everything you've done and starts over" — including the work
 * that has not left the device.
 *
 * That promise was kept by accident. `seedFor` pinned `selfId` back to the demo
 * sentinel, which moved the identity `store.tsx`'s `lastSelfId` effect watches,
 * which called `clearOutbox`. Nothing said so, and the one existing test for it
 * (`sync/__tests__/outbox.test.ts`, "what a reset has to take with it") calls
 * `clearOutbox()` directly — so it would have kept passing if the effect ever
 * stopped firing. Which it now has: `selfId` survives a reseed, and on the
 * live→live path `state.account` does not move either, so neither effect fires.
 *
 * This drives the real control instead, because the guarantee now lives at the
 * call site and the call site is the only thing that can be wrong.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { App } from '../../App';
import { fakeSupabase } from '../../__mocks__/@supabase/supabase-js';
import { __resetSupabaseForTests } from '../../lib/supabase';
import { __resetSessionForTests } from '../../sync/session';
import { __resetOutboxForTests, pending } from '../../sync/outbox';

const settle = async () => {
  await act(async () => {});
};

beforeEach(async () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  fakeSupabase.reset();
  __resetSupabaseForTests();
  __resetSessionForTests();
  __resetOutboxForTests();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

it('takes unsent work with it, on the path where nothing else would', async () => {
  // Live, and staying live: `RESET { mode: 'live' }` is what the "Live" control
  // next to this one dispatches, and it is the one path where `state.account`
  // does not change either. Both of the store's queue-clearing effects sit this
  // one out.
  render(<App persist sync restored={{ account: 'live', onboardStep: null, tab: 'me' }} />);
  await settle();

  // Offline, so the queue is guaranteed to still be holding it when we reset —
  // otherwise a drain could empty it first and the test would pass for a reason
  // that has nothing to do with the reset.
  // Offline, so the queue is still holding it when the reset happens —
  // otherwise a drain could empty it first and this would pass for a reason
  // that has nothing to do with the reset. A name change is the write this
  // screen has to hand, and it is a real one: `profile.update`.
  fakeSupabase.goOffline();
  fireEvent.press(screen.getByLabelText('Someone. Change your name.'));
  fireEvent.changeText(screen.getByLabelText('Your name'), 'Maya Chen');
  await act(async () => {
    fireEvent(screen.getByLabelText('Your name'), 'blur');
  });
  expect(pending().map((e) => e.op)).toContain('profile.update');

  let goLive: (() => void) | undefined;
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    goLive = buttons?.find((b) => b.style === 'destructive')?.onPress as () => void;
  });
  fireEvent.press(screen.getByLabelText('Switch to live mode'));
  await act(async () => {
    goLive?.();
  });

  // The whole assertion. Without the explicit clear these entries survive the
  // wipe and drain under an auth session that never changed — successfully,
  // which is the bad part: the goal the user just erased comes back.
  expect(pending()).toEqual([]);
});
