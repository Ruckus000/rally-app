/**
 * Step 5 promises what cheers actually do — and the promise has moved once.
 *
 * While there was no push, "they wait in the app" was the honest line, and this
 * file existed to stop anybody writing a lock-screen claim the build could not
 * keep. Push works now: an APNs key, a deployed `push` function, and this very
 * screen's Allow button registering the device token. So the understated
 * version became the wrong one, and the test flipped with the copy rather than
 * being quietly deleted.
 *
 * Both directions are pinned, because both are real ways to be wrong here. This
 * screen is where a person decides whether to grant a permission, and copy that
 * oversells costs their trust while copy that undersells costs them the feature.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { NotificationsScreen } from '../NotificationsScreen';

const show = () =>
  render(
    <NotificationsScreen
      stakeSum={35}
      hasPicks
      weekNumber={33}
      onAllow={() => {}}
      onLater={() => {}}
    />,
  );

describe('the notifications step', () => {
  it('promises the cheer arrives when it is sent, which it now does', () => {
    show();
    expect(screen.getByText(/the moment they send it/)).toBeTruthy();
  });

  it('no longer says a cheer merely waits until you open the app', () => {
    // The old promise. Leaving it in place would mean the one screen asking for
    // a notification permission is the screen arguing you do not need one.
    show();
    expect(screen.queryByText(/waiting when you open Rally/)).toBeNull();
  });

  it('still shows both of the things Allow actually grants', () => {
    // The cheer is remote push, the Monday line is a local reminder. One tap
    // turns on both, so both are previewed — and neither preview is a promise
    // the build cannot keep.
    show();
    expect(screen.getByText(/cheered "Run 5k"/)).toBeTruthy();
    expect(screen.getByText(/Week 33 opens today/)).toBeTruthy();
  });
});
