/**
 * Whose name the app puts on your own profile, and what it offers you to send
 * a friend.
 *
 * Both used to be fixtures on every account. The Me card rendered `ME.name`, so
 * a live user was called "Alex Rivera" whoever they were; the invite sheet
 * offered `ME.inviteLink`, whose code `close_circle_join_hole` had already
 * rotated away and whose shape `circles_invite_code_entropy` now forbids. Every
 * live case below has a demo counterpart, because "read the directory instead"
 * would otherwise be indistinguishable from "delete the fixture everywhere".
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Share } from 'react-native';

import { StoreProvider, type CircleRef } from '../../state/store';
import { indexPeople, personOf } from '../../data/people';
import { ME } from '../../data/fixtures';
import { seedProfile } from '../../data/seed';
import { MeScreen } from '../MeScreen';
import { DetailSheet } from '../../overlays/DetailSheet';

const ME_ID = '11111111-1111-4111-8111-111111111111';
const CIRCLE: CircleRef = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'The Basement',
  inviteCode: 'the-basement-a1b2c3d4e5f60718',
};

const liveMe = (over: { circle?: CircleRef | null; name?: string } = {}) =>
  render(
    <StoreProvider
      persist={false}
      sync={false}
      restored={{
        account: 'live',
        selfId: ME_ID,
        people: indexPeople([personOf(ME_ID, over.name ?? 'Maya Chen')]),
        circle: over.circle === undefined ? CIRCLE : over.circle,
      }}
    >
      <MeScreen />
    </StoreProvider>,
  );

const demoMe = () =>
  render(
    <StoreProvider persist={false} sync={false} restored={{ account: 'seeded' }}>
      <MeScreen />
    </StoreProvider>,
  );

const inviteSheet = (account: 'live' | 'seeded', circle: CircleRef | null = CIRCLE) =>
  render(
    <StoreProvider
      persist={false}
      sync={false}
      restored={{
        account,
        selfId: account === 'live' ? ME_ID : undefined,
        circle: account === 'live' ? circle : null,
        sheet: { type: 'invite', id: null },
      }}
    >
      <DetailSheet bottomInset={0} />
    </StoreProvider>,
  );

describe('the name on your own profile', () => {
  it('is the one you set, on a live account', () => {
    liveMe();

    expect(screen.getByText('Maya Chen')).toBeTruthy();
    expect(screen.queryByText(ME.name)).toBeNull();
  });

  it('is still the fixture on the demo — the control', () => {
    // Without this, deleting `ME` from the screen outright would pass the test
    // above while quietly emptying the demo everyone sees first.
    demoMe();

    expect(screen.getByText(ME.name)).toBeTruthy();
  });

  it('shows the circle you are in rather than a machine-generated handle', () => {
    liveMe();

    expect(screen.getByText('The Basement')).toBeTruthy();
    // `anon_6e8dd5641ace` is not an identity, and the live handle is never
    // rewritten — showing it would be showing an address that is not yours.
    expect(screen.queryByText(ME.handle)).toBeNull();
  });
});

describe('renaming yourself', () => {
  it('commits what you type, which is all the push needs', () => {
    liveMe();

    fireEvent.press(screen.getByLabelText('Maya Chen. Change your name.'));
    fireEvent.changeText(screen.getByLabelText('Your name'), 'Maya C.');
    fireEvent(screen.getByLabelText('Your name'), 'submitEditing');

    // The directory is the whole contract: the engine watches it, so landing
    // here is what queues `profile.update`. See engine.test.tsx.
    expect(screen.getByText('Maya C.')).toBeTruthy();
  });

  it('keeps the old name when you open the field and change nothing', () => {
    liveMe();

    fireEvent.press(screen.getByLabelText('Maya Chen. Change your name.'));
    fireEvent(screen.getByLabelText('Your name'), 'blur');

    expect(screen.getByText('Maya Chen')).toBeTruthy();
  });

  it('is not offered on the demo, where there is nowhere honest to put it', () => {
    demoMe();

    expect(screen.queryByLabelText(/Change your name/)).toBeNull();
  });
});

describe('the invite code', () => {
  it('is the real one, on a live account', () => {
    inviteSheet('live');

    expect(screen.getByLabelText(`Invite code ${CIRCLE.inviteCode}`)).toBeTruthy();
    // The rotated-away code that used to be here, and the URL shape that
    // implies a website nobody has built.
    expect(screen.queryByText(ME.inviteLink)).toBeNull();
  });

  it('shares the code itself, not a toast that pretends to copy', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    inviteSheet('live');

    fireEvent.press(screen.getByLabelText('Share invite code'));

    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining(CIRCLE.inviteCode) }),
    );
    share.mockRestore();
  });

  it('offers to start a circle when you have none, instead of a dead end', () => {
    // Riding solo through onboarding used to be permanent: this sheet was the
    // only invite surface and onboarding the only place a circle could be made.
    inviteSheet('live', null);

    expect(screen.getByLabelText('Circle name')).toBeTruthy();
    expect(screen.getByLabelText('Create circle')).toBeTruthy();
  });

  it('leaves the demo alone — the control', () => {
    inviteSheet('seeded');

    expect(screen.getByText(ME.inviteLink)).toBeTruthy();
    expect(screen.queryByLabelText('Circle name')).toBeNull();
  });
});

describe('the cheer exchange line', () => {
  const exchange = (cheersReceived: number) =>
    render(
      <StoreProvider
        persist={false}
        sync={false}
        restored={{
          account: 'live',
          selfId: ME_ID,
          people: indexPeople([personOf(ME_ID, 'Maya Chen')]),
          profile: { ...seedProfile('live'), cheersReceived },
        }}
      >
        <MeScreen />
      </StoreProvider>,
    );

  it('says "cheer" for one', () => {
    // Only reachable now that cheers received are counted at all: the number
    // was a seed constant, so this branch could never render a 1.
    exchange(1);

    expect(screen.getByText(/^1 cheer behind\./)).toBeTruthy();
  });

  it('promises a cheer reaches someone’s phone, which it now does', () => {
    // This test used to assert the opposite, and was right to: there was no
    // push, so the handoff's line was a promise the build could not keep and
    // the copy was softened to match. `push_notification()` fires on the
    // notification row, the `push` function delivers it, and the device
    // registers its token through the outbox — so the promise is the app's
    // again, and the line went back to what was written.
    exchange(1);

    expect(screen.getByText(/lands on their phone, with your name on it/)).toBeTruthy();
  });

  it('says "cheers" for more than one — the control', () => {
    exchange(3);

    expect(screen.getByText(/^3 cheers behind\./)).toBeTruthy();
  });
});
