/**
 * The flow as a user meets it: seven screens, a back button that steps rather
 * than escapes, and a first week that is really staked at the end of it.
 *
 * Rendered through `App` rather than through `OnboardOverlay` on its own —
 * everything worth asserting here is what onboarding leaves behind, and that
 * only exists once the store and the app behind it are in the picture.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { App } from '../../../App';
import * as supabaseModule from '../../../lib/supabase';
import { captureBackPress } from '../../../test/backPress';
import { fakeSupabase } from '../../../__mocks__/@supabase/supabase-js';
import { __resetSupabaseForTests } from '../../../lib/supabase';
import { __resetSessionForTests } from '../../../sync/session';
import { __resetOutboxForTests, pending } from '../../../sync/outbox';


let back: ReturnType<typeof captureBackPress>;

beforeEach(() => {
  back = captureBackPress();
});

afterEach(() => {
  back.restore();
});

/** Screen 0's local route in: the demo, granted on the tap. */
const lookAround = () => fireEvent.press(screen.getByLabelText('Look around first'));
const press = (label: string) => fireEvent.press(screen.getByLabelText(label));

/** Steps 1 and 2, which every later screen needs answered. */
function reachTheStake() {
  lookAround();
  press('Move more');
  press('Continue with 1 focus');
  fireEvent.changeText(screen.getByLabelText('Your name'), 'Alex Rivera');
  press('Continue');
}

describe('the onboarding flow', () => {
  it('walks all seven screens and lands in the week', () => {
    render(<App persist={false} sync={false} />);

    expect(screen.getByText('Your week, on the record.')).toBeTruthy();
    lookAround();

    expect(screen.getByText('What are you here to move?')).toBeTruthy();
    press('Move more');
    press('Continue with 1 focus');

    expect(screen.getByText('Put a name on it.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Your name'), 'Alex Rivera');
    // The handle fills in as you type, which is the point of the screen.
    expect(screen.getByText('@alexrivera')).toBeTruthy();
    press('Continue');

    expect(screen.getByText('What will you close this week?')).toBeTruthy();
    press('Run 5k, ×2 this week, 40 points');
    press('Gym session, ×3 this week, 45 points');
    press('Stake 85 pts');

    expect(screen.getByText('Don’t do this alone.')).toBeTruthy();
    press('I have an invite. A friend sent you a circle code');
    fireEvent.changeText(screen.getByLabelText('Circle code'), 'RALLY-7Q2M');
    press('Join');

    expect(screen.getByText('Cheers land here.')).toBeTruthy();
    press('Allow notifications');

    expect(screen.getByText('STAKED')).toBeTruthy();
    // The celebration is announced as one sentence rather than eight fragments.
    expect(screen.getByLabelText(/85 points on the line/)).toBeTruthy();
    expect(screen.getByLabelText(/2 commitments\. Your circle, The Basement/)).toBeTruthy();
    press('Enter your week');

    // Out of the flow and onto your own week.
    expect(screen.queryByText('STAKED')).toBeNull();
    expect(screen.getByLabelText('Plan your week')).toBeTruthy();
  });

  it('turns what you staked into real tasks on the week', () => {
    render(<App persist={false} sync={false} />);
    reachTheStake();
    press('Run 5k, ×2 this week, 40 points');
    // Your own words count too, and are already ticked.
    fireEvent.changeText(screen.getByLabelText('Add your own commitment'), 'Call my sister');
    press('Add commitment');
    press('Stake 65 pts');
    press('Ride solo for now');
    press('Maybe later');
    press('Enter your week');

    fireEvent.press(screen.getByText('Personal'));
    expect(screen.getByLabelText('Run 5k')).toBeTruthy();
    expect(screen.getByLabelText('Call my sister')).toBeTruthy();
    expect(screen.getByText('0 of 2 done')).toBeTruthy();
  });

  it('steps back from the stake to the name, keeping what was typed', () => {
    render(<App persist={false} sync={false} />);
    reachTheStake();

    press('Back');
    expect(screen.getByText('Put a name on it.')).toBeTruthy();
    expect(screen.getByLabelText('Your name').props.value).toBe('Alex Rivera');
  });

  it('does not let hardware back skip the flow', () => {
    render(<App persist={false} sync={false} />);
    lookAround();
    press('Move more');
    press('Continue with 1 focus');

    back.press();
    expect(screen.getByText('What are you here to move?')).toBeTruthy();
    back.press();
    expect(screen.getByText('Your week, on the record.')).toBeTruthy();

    // Only the front door dismisses — and the demo it granted survives.
    back.press();
    expect(screen.queryByText('Your week, on the record.')).toBeNull();
    expect(screen.getByText('Ship the portfolio site')).toBeTruthy();
  });

  it('skips the intents forward rather than out, and suggests the defaults', () => {
    render(<App persist={false} sync={false} />);
    lookAround();

    press('Skip');
    expect(screen.getByText('Put a name on it.')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Your name'), 'Alex Rivera');
    press('Continue');

    // move, focus and health — what someone who told us nothing gets offered.
    expect(screen.getByLabelText('Run 5k, ×2 this week, 40 points')).toBeTruthy();
    expect(screen.getByLabelText('No phone before noon, every day, 40 points')).toBeTruthy();
    expect(screen.getByLabelText('In bed by 11, ×5 nights, 40 points')).toBeTruthy();
  });

  it('sends the primary action to live mode', () => {
    // `sync={false}` keeps the session effect out of it: what's asserted is
    // that the tap flips the account, which is the only thing that starts a
    // sign-in — there is no second path.
    render(<App persist={false} sync={false} />);
    fireEvent.press(screen.getByLabelText('Get started'));
    press('Skip');
    fireEvent.changeText(screen.getByLabelText('Your name'), 'Alex Rivera');
    press('Continue');
    press('Morning walk, every day, 35 points');
    press('Stake 35 pts');

    // The circle step has its own suite below — it is the one screen in this
    // flow that waits on a server, so it cannot be asserted with sync off.
    press('Ride solo for now');
    press('Maybe later');
    press('Enter your week');

    fireEvent.press(screen.getByLabelText('Me'));
    expect(screen.getByText('Live')).toBeTruthy();
  });

  /**
   * The circle step on a live account, against the strict fake. It is the only
   * screen in the flow that waits on a server, so it is the only one where the
   * server's answer — including a refusal — is part of the behaviour.
   */
  describe('the circle step, live', () => {
    const reachTheCircle = async () => {
      render(<App persist sync />);
      fireEvent.press(screen.getByLabelText('Get started'));
      // The session has to land before a SECURITY DEFINER call can name a caller.
      await act(async () => {});
      press('Skip');
      fireEvent.changeText(screen.getByLabelText('Your name'), 'Maya Chen');
      press('Continue');
      press('Morning walk, every day, 35 points');
      press('Stake 35 pts');
    };

    beforeEach(() => {
      process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
      fakeSupabase.reset();
      __resetSupabaseForTests();
      __resetSessionForTests();
      __resetOutboxForTests();
    });

    afterEach(() => {
      delete process.env.EXPO_PUBLIC_SUPABASE_URL;
      delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    });

    it('creates a real circle and carries its name to the last screen', async () => {
      await reachTheCircle();

      press('Start a circle. Name it, then invite your people');
      fireEvent.changeText(screen.getByLabelText('Circle name'), 'The Basement');
      await act(async () => {
        press('Create');
      });

      // A row, with the caller in it — not a message saying circles are closed.
      expect(fakeSupabase.rows('circles')).toHaveLength(1);
      expect(fakeSupabase.rows('circle_members')).toHaveLength(1);

      press('Maybe later');
      // The name you gave it, announced as one sentence — not "solo for now".
      expect(screen.getByLabelText(/Your circle, The Basement/)).toBeTruthy();
    });

    /**
     * The regression from the two-device run. Both accounts came out of
     * onboarding called "Someone", because creating a circle kicks a pull and
     * the merge it produced overwrote the typed name before anything had queued
     * it. Driven through the real screens rather than raw dispatches, since the
     * bug was in *when* the flow queues, which a dispatch cannot reproduce.
     */
    it('keeps the name you typed even though creating a circle kicks a pull', async () => {
      await reachTheCircle();

      press('Start a circle. Name it, then invite your people');
      fireEvent.changeText(screen.getByLabelText('Circle name'), 'The Basement');
      await act(async () => {
        press('Create');
      });
      press('Maybe later');
      await act(async () => {
        press('Enter your week');
      });

      // Queued, not merely typed. The push itself needs a drain cycle and this
      // suite runs on real timers — engine.test.tsx owns what happens on the
      // wire. What this layer owns is *when* the flow tells the queue, and that
      // the merge racing it cannot take the name back.
      expect(pending().filter((e) => e.op === 'profile.update')).toEqual([
        expect.objectContaining({ payload: { name: 'Maya Chen' } }),
      ]);

      fireEvent.press(screen.getByLabelText('Me'));
      expect(screen.getByText('Maya Chen')).toBeTruthy();
    });

    it('says so when the code names nothing, and stays on the step', async () => {
      await reachTheCircle();

      press('I have an invite. A friend sent you a circle code');
      fireEvent.changeText(screen.getByLabelText('Circle code'), 'basement-0000000000000000');
      await act(async () => {
        press('Join');
      });

      expect(screen.getByText(/didn’t work/)).toBeTruthy();
      // Still on the circle step: advancing would mean telling someone they had
      // joined a circle that does not exist.
      expect(screen.getByLabelText('Ride solo for now')).toBeTruthy();
      expect(fakeSupabase.rows('circle_members')).toHaveLength(0);
    });
  });

  it('reaches the demo without ever building a supabase client', () => {
    // The gate is `persist && sync && account === 'live' && hasSupabaseConfig()`,
    // so this renders with both on and configures the env — otherwise it would
    // pass for the wrong reason. See demoIsOffline.test.tsx, which owns the rule.
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    const getSupabase = jest.spyOn(supabaseModule, 'getSupabase');

    render(<App persist sync />);
    lookAround();
    back.press();
    back.press();

    expect(screen.getByText('Ship the portfolio site')).toBeTruthy();
    expect(getSupabase).not.toHaveBeenCalled();

    getSupabase.mockRestore();
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  });
});
