/**
 * Onboarding that was interrupted after the circle was already joined.
 *
 * `join_circle_by_code` commits the membership row the moment it is called —
 * it is not an outbox op, because the answer is the point. Everything else
 * about the flow is local and unpersisted: the name, the stakes, and the fact
 * that you joined at all live in `OnboardOverlay`'s React state, while
 * `onboardStep` is on disk. So a force-quit between joining and finishing
 * leaves a member whose app has to be told, by the server, what it is already
 * part of.
 *
 * It was not being told. Reported from a two-device run: the Me screen offered
 * to start a circle to somebody who was in one, and the row was in the
 * database the whole time.
 *
 * Driven through the real screens and mounted exactly once. A remount would
 * build a fresh engine with empty baselines, which is the one thing that made
 * this bug invisible in every other test — and on a real phone, the reason it
 * looked intermittent.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { App } from '../../App';
import { fakeSupabase } from '../../__mocks__/@supabase/supabase-js';
import { __resetSupabaseForTests } from '../../lib/supabase';
import { __resetSessionForTests, currentUserId } from '../session';
import { __resetOutboxForTests } from '../outbox';

const HOST = '22222222-2222-4222-8222-222222222222';
const CIRCLE = '33333333-3333-4333-8333-333333333333';

const press = (label: string) => fireEvent.press(screen.getByLabelText(label));

const settle = async (ms = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(async () => {
  jest.useFakeTimers();
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  fakeSupabase.reset();
  __resetSupabaseForTests();
  __resetSessionForTests();
  __resetOutboxForTests();
  // The queue outlives the module reset, and a leftover entry hydrates under a
  // different anonymous user on the next mount.
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

it('keeps the circle you already joined when onboarding starts over', async () => {
  // The relaunch: `account` and `onboardStep` are what persistence restores,
  // and `circle` is deliberately not among them — it is refetched every time.
  render(<App persist sync restored={{ account: 'live', onboardStep: 'onboarding' }} />);
  await settle();

  const me = currentUserId() as string;
  expect(me).not.toBeNull();

  // The join that went through before the app was killed. Committed on the
  // server, with nothing on this device left to remember it.
  fakeSupabase.seed({
    profiles: [{ id: HOST, handle: 'maya', name: 'Maya' }],
    circles: [
      { id: CIRCLE, name: 'The Basement', invite_code: 'basement-0123456789abcdef', created_by: HOST },
    ],
    circle_members: [
      { circle_id: CIRCLE, profile_id: HOST },
      { circle_id: CIRCLE, profile_id: me },
    ],
  });
  await settle(60_000);

  // Onboarding restarts at the welcome screen, because the flow's own state
  // was never on disk. This tap is the trigger: it reseeds the world, which
  // clears the circle the pull above had just filled in.
  press('Get started');
  await settle();
  press('Skip');
  fireEvent.changeText(screen.getByLabelText('Your name'), 'Maya Chen');
  press('Continue');
  press('Morning walk, every day, 35 points');
  press('Stake 35 pts');

  // The circle step, which has forgotten. Skipping it is the honest thing for
  // this user to do — they do not remember joining either — and it must not
  // cost them the circle they are in.
  press('Skip');
  press('Skip');
  await settle(60_000);

  // Not "Solo for now.", which is what the receipt announced while the header
  // behind it was already naming the circle.
  expect(screen.getByLabelText(/Your circle, The Basement/)).toBeTruthy();

  await act(async () => {
    press('Enter your week');
  });
  await settle(60_000);
  press('Me');

  // The symptom as it was reported: the Me screen headed "Your week, on the
  // record" — the line it falls back to with no circle — for somebody the
  // server had as a member. The name appears more than once here (the header
  // and the profile card), and both of them were wrong.
  expect(screen.queryByText('Your week, on the record')).toBeNull();
  expect(screen.getAllByText('The Basement').length).toBeGreaterThan(0);
});
