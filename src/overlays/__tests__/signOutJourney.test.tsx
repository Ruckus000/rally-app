/**
 * The one thing none of the sign-out tests actually check: that `App` draws
 * the recovery door once you're in the state sign-out leaves you in.
 *
 * `state/__tests__/signOutAction.test.ts` proves `SIGN_OUT` sets
 * `onboardStep: 'onboarding'`. `overlays/__tests__/SettingsOverlay.test.tsx`
 * proves that dispatch only fires on `{ ok: true }`. Neither renders `App` —
 * they stop at the reducer and at the overlay in isolation. But the reducer
 * being right is not the same thing as the shell doing something with it:
 * `src/App.tsx` has to notice `state.onboardStep` and mount `OnboardOverlay`,
 * which has to be on step 0 (Welcome), which has to render a "Continue with
 * Apple" control that is actually enabled rather than the coming-soon husk
 * Android gets. Delete the `state.onboardStep ? <OnboardOverlay .../> : null`
 * line from `src/App.tsx` and every other sign-out test still passes — the
 * reducer output and the overlay's own logic are both untouched. Only this
 * test would catch it, because only this test renders the real `App` and
 * looks for the button on screen.
 *
 * Driven from `restored`, not from a live sign-out tap. The tap is a native
 * `Alert` confirm with no rendered button under jest-expo, and
 * `SettingsOverlay.test.tsx` already drives that confirm and proves the
 * dispatch is conditional on it — redoing that here through the full `App`
 * would cost a second Alert-spying rig to re-prove a wire that test already
 * owns. Landing directly in the post-sign-out state and asserting what's on
 * screen is the smaller test, and it pins the actual gap: the shell's
 * rendering, not the reducer's output or the confirm's guard.
 *
 * `persist={false}` and `sync={false}` match the rest of the suite (see
 * `SettingsOverlay.test.tsx`, `secureAccount.test.tsx`) — nothing here needs
 * disk or a live session, and leaving them on would mean this test reaching
 * for the Supabase mock's `channel()`, which throws.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { App } from '../../App';

describe('after signing out', () => {
  it('shows the Apple recovery door, enabled', async () => {
    render(<App persist={false} sync={false} restored={{ onboardStep: 'onboarding' }} />);
    // Nothing async should be in flight here, but the rest of the suite
    // awaits a tick after mounting `App`-adjacent trees before asserting, and
    // there's no reason for this test to be the one exception.
    await screen.findByText('Rally');

    // jest-expo's default `Platform.OS` is 'ios', where Apple is real and the
    // control's accessible name says so. Asserting that rather than assuming
    // it, per the task brief — if this suite ever runs under Android's
    // default, the coming-soon label is the correct one to expect instead,
    // and this line documents which branch actually ran.
    expect(Platform.OS).toBe('ios');

    const appleButton = screen.getByLabelText('Continue with Apple, to sign back in');
    expect(appleButton.props.accessibilityState?.disabled).not.toBe(true);
  });
});
