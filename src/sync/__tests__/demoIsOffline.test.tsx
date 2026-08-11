/**
 * The rule the whole local-first design rests on: the demo accounts never
 * touch the network. Everywhere else that rule is enforced by one boolean
 * expression in `StoreProvider`, which is exactly the kind of thing that gets
 * refactored into being wrong. This asserts it from the outside.
 *
 * It spies on the module boundary rather than on `fetch`, because a Supabase
 * client is expensive and stateful the moment it is constructed — a websocket,
 * a refresh timer and a gotrue instance — so "was it built at all" is the
 * honest question, not "did a request go out".
 *
 * Every case renders with `persist sync` deliberately. The obvious
 * `persist={false}` makes all of this pass for the wrong reason: the gate is
 * `persist && sync && account === 'live' && hasSupabaseConfig()`, so a false
 * `persist` short-circuits before the account is ever consulted, and the suite
 * stays green even with the account check deleted outright.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { App } from '../../App';
import * as supabaseModule from '../../lib/supabase';
import { captureBackPress } from '../../test/backPress';

describe('the demo accounts are genuinely offline', () => {
  let getSupabase: jest.SpyInstance;
  let back: ReturnType<typeof captureBackPress>;
  const realEnv = { ...process.env };

  /** Onboarding's front door: the demo, and the empty account you get by leaving. */
  const lookAround = () => fireEvent.press(screen.getByLabelText('Look around first'));

  beforeEach(() => {
    back = captureBackPress();
    // Jest never loads .env, so without this `hasSupabaseConfig()` is false and
    // every assertion below passes for the wrong reason — the gate would be
    // shut by missing config rather than by the account mode. The control at
    // the bottom of this file is what caught that.
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    getSupabase = jest.spyOn(supabaseModule, 'getSupabase');
  });

  afterEach(() => {
    back.restore();
    getSupabase.mockRestore();
    process.env = { ...realEnv };
  });

  it('never builds a client while walking the whole flow into the demo', () => {
    render(<App persist sync />);
    lookAround();
    fireEvent.press(screen.getByLabelText('Move more'));
    fireEvent.press(screen.getByLabelText('Continue with 1 focus'));
    fireEvent.changeText(screen.getByLabelText('Your name'), 'Alex');
    fireEvent.press(screen.getByLabelText('Continue'));
    fireEvent.press(screen.getByLabelText('Morning walk, every day, 35 points'));
    fireEvent.press(screen.getByLabelText('Stake 35 pts'));
    fireEvent.press(screen.getByLabelText('Ride solo for now'));
    fireEvent.press(screen.getByLabelText('Maybe later'));
    fireEvent.press(screen.getByLabelText('Enter your week'));

    expect(getSupabase).not.toHaveBeenCalled();
  });

  it('never builds a client on the empty account either', () => {
    render(<App persist sync />);
    // Leaving by the front door, which is what grants an empty local account.
    back.press();

    expect(getSupabase).not.toHaveBeenCalled();
  });

  it('never builds a client while the app is walked end to end', () => {
    render(<App persist sync />);
    lookAround();
    back.press();
    back.press();

    fireEvent.press(screen.getByText('Circle'));
    fireEvent.press(screen.getByText('Me'));
    fireEvent.press(screen.getByText('Week'));

    expect(getSupabase).not.toHaveBeenCalled();
  });

  it('DOES build one in live mode — the control, so the three above mean something', async () => {
    // Without this, all of the above would pass just as happily if the client
    // were never wired up at all, or if the env vars were simply missing.
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t, _m, buttons) =>
        buttons?.find((b) => b.text === 'Go live')?.onPress?.(),
      );

    render(<App persist sync />);
    back.press();
    fireEvent.press(screen.getByText('Me'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Switch to live mode'));
    });

    expect(getSupabase).toHaveBeenCalled();
    alert.mockRestore();
  });
});
