/**
 * The other end of Wave D: getting back in on a device that has never seen you.
 *
 * The assertion that matters least is "it signed in". The two that matter are
 * that it **does not walk you through onboarding again** — you already have a
 * name, a circle and a week on the server, and the flow overwriting them would
 * undo the recovery it just performed — and that it **does not leave a second
 * account behind**.
 *
 * That second one is a property of ordering, not of any single call. Flipping the
 * account to `live` starts the provider's anonymous sign-in, so signing in with
 * Apple after that point mints a throwaway user and a `profiles` row first. Apple
 * goes first precisely so `ensureSession` finds itself already `ready` and does
 * nothing, and counting rows is the only way to see the difference.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { App } from '../../../App';
import { fakeSupabase } from '../../../__mocks__/@supabase/supabase-js';
import { fakeApple } from '../../../__mocks__/expo-apple-authentication';
import { captureBackPress } from '../../../test/backPress';
import { __resetSupabaseForTests } from '../../../lib/supabase';
import { __resetSessionForTests } from '../../../sync/session';
import { __resetOutboxForTests } from '../../../sync/outbox';
import { __resetForTests as __resetNotificationsForTests } from '../../../__mocks__/expo-notifications';

let back: ReturnType<typeof captureBackPress>;
const realEnv = { ...process.env };

beforeEach(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  back = captureBackPress();
  fakeSupabase.reset();
  fakeApple.reset();
  __resetSupabaseForTests();
  __resetSessionForTests();
  __resetOutboxForTests();
  __resetNotificationsForTests();
});

afterEach(() => {
  back.restore();
  process.env = { ...realEnv };
});

const mount = () => render(<App persist sync />);

const tapApple = async () => {
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Continue with Apple, to sign back in'));
  });
};

/**
 * An account that already attached this Apple id, and a device that knows
 * nothing about it — which is what a reinstall is.
 */
const anAccountExists = (userId: string) => {
  fakeSupabase.seed({ profiles: [{ id: userId, handle: 'anon_existing', name: 'Dre' }] });
  fakeSupabase.identityOwnedBy('apple-identity-token', userId);
};

const EXISTING = '00000000-0000-4000-8000-0000000000aa';

it('signs back into the account the Apple id belongs to, and leaves the flow', async () => {
  anAccountExists(EXISTING);
  mount();

  await tapApple();

  // Out of onboarding entirely: screen 0's own actions are gone.
  expect(screen.queryByLabelText('Look around first')).toBeNull();
  // And into the app, on the tab `SKIP_ONBOARD` lands a live account on.
  expect(screen.queryByLabelText('Continue with Apple, to sign back in')).toBeNull();
});

it('does not mint a second account on the way in', async () => {
  anAccountExists(EXISTING);
  mount();

  await tapApple();

  // One row, and it is the one that was already there. Two rows means the
  // anonymous sign-in got in first and this recovered into the wrong order.
  const profiles = fakeSupabase.rows('profiles');
  expect(profiles).toHaveLength(1);
  expect(profiles[0].id).toBe(EXISTING);
});

it('never asks Apple for anything until the button is pressed', async () => {
  anAccountExists(EXISTING);
  mount();

  await act(async () => {});

  // Landing on the Welcome screen must not open a system sheet at anybody.
  expect(fakeApple.calls()).toBe(0);
});

it('stays put, and says nothing, when the sheet is dismissed', async () => {
  anAccountExists(EXISTING);
  fakeApple.cancels();
  mount();

  await tapApple();

  // Still on screen 0, with no line of copy — changing your mind is not an error.
  expect(screen.queryByLabelText('Look around first')).not.toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('explains a failure that is not a cancellation', async () => {
  anAccountExists(EXISTING);
  fakeApple.fails('no network');
  mount();

  await tapApple();

  expect(screen.getByText(/Couldn’t reach Apple just now/)).toBeTruthy();
  expect(screen.queryByLabelText('Look around first')).not.toBeNull();
});
