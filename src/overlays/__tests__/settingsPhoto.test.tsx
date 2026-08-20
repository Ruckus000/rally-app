/**
 * The Settings row that sets a photo, pinned at the two places it can quietly
 * do harm.
 *
 * The first is `previousPath`. Replacing a photo is a delete plus an insert —
 * there is no update policy on the bucket — so the row has to hand
 * `pickAndUploadAvatar` the object the profile points at *now*, or the old
 * bytes stay in a bucket that every signed-in account can read, under a name
 * nothing points at and nobody will ever look for. Nothing on screen changes
 * when this is wrong, which is exactly why it is asserted here.
 *
 * The second is what a refusal says. `IMAGE_BLOCKED_COPY` and nothing else:
 * the model's own sentence is diagnostic, it never leaves the edge function,
 * and a client that rendered it would be arguing with somebody about their
 * photograph on the strength of a sentence written by a language model.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { StoreProvider, useStore } from '../../state/store';
import { SettingsOverlay } from '../SettingsOverlay';
import { personOf, type AvatarState } from '../../data/people';
import { IMAGE_BLOCKED_COPY } from '../../../supabase/functions/_shared/imageVerdict.mjs';

const ME = '11111111-1111-4111-8111-111111111111';
const OLD = `${ME}/old.jpg`;
const NEW = `${ME}/new.jpg`;

const mockPick = jest.fn();
const mockClear = jest.fn();
jest.mock('../../lib/avatarUpload', () => ({
  pickAndUploadAvatar: (previousPath?: string | null) => mockPick(previousPath),
  clearAvatar: (path?: string | null) => mockClear(path),
}));

/** The signing layer, so an avatar with a path does not reach for a client. */
jest.mock('../../lib/supabase', () => ({
  hasSupabaseConfig: () => true,
  getSupabase: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: 'https://example.test/x' }, error: null }),
      }),
    },
  }),
}));

let seen: ReturnType<typeof useStore>['state'];
function Watch() {
  const { state } = useStore();
  React.useEffect(() => {
    seen = state;
  });
  return null;
}

/** A live account whose own row is in the directory, as a pull leaves it. */
const mount = async (avatar: { avatarPath?: string; avatarState?: AvatarState }) => {
  render(
    <StoreProvider
      persist={false}
      sync={false}
      restored={{
        settingsOpen: true,
        account: 'live',
        selfId: ME,
        people: { [ME]: { ...personOf(ME, 'Alex Rivera'), ...avatar } },
      }}
    >
      <Watch />
      <SettingsOverlay topInset={0} />
    </StoreProvider>,
  );
  await act(async () => {});
};

const press = async (label: string | RegExp) => {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(label));
  });
};

beforeEach(() => {
  mockPick.mockReset();
  mockClear.mockReset();
  mockPick.mockResolvedValue({ ok: true, path: NEW });
  mockClear.mockResolvedValue(true);
});

describe('replacing a photo', () => {
  it('hands the upload the object the profile points at now', async () => {
    await mount({ avatarPath: OLD, avatarState: 'ready' });

    await press('Replace your photo');

    // Without this argument the old object is never deleted. It is not visible
    // anywhere — it is just still there, readable by name, forever.
    expect(mockPick).toHaveBeenCalledWith(OLD);
  });

  it('remembers the new path, so a second replace does not orphan it either', async () => {
    await mount({ avatarPath: OLD, avatarState: 'ready' });

    await press('Replace your photo');
    await press('Replace your photo');

    expect(mockPick).toHaveBeenNthCalledWith(2, NEW);
    expect(seen.people[ME]).toMatchObject({ avatarPath: NEW, avatarState: 'ready' });
  });

  it('asks with nothing to replace when there is no photo yet', async () => {
    await mount({});

    await press('Add a photo');

    expect(mockPick).toHaveBeenCalledWith(undefined);
  });
});

describe('a photo the screener refused', () => {
  it('says the one line, and does not say why', async () => {
    mockPick.mockResolvedValue({ ok: false, reason: 'blocked' });
    await mount({});

    await press('Add a photo');

    expect(screen.getByText(IMAGE_BLOCKED_COPY)).toBeTruthy();
    // The model's own words are the thing this must never render. Nothing on
    // the page may name a category, a policy, or a reason.
    expect(screen.queryByText(/nudity|violence|policy|because/i)).toBeNull();
    // And the local copy follows the server, which has already deleted it.
    expect(seen.people[ME]).toMatchObject({ avatarState: 'refused' });
    expect(seen.people[ME]?.avatarPath).toBeUndefined();
  });

  it('says it again on a page opened later, from the state alone', async () => {
    await mount({ avatarState: 'refused' });

    expect(screen.getByText(IMAGE_BLOCKED_COPY)).toBeTruthy();
    // Still offers another photo — a refusal is about one picture.
    expect(screen.getByLabelText('Add a photo')).toBeTruthy();
  });
});

describe('a photo still being screened', () => {
  it('says so, and offers no way to pretend otherwise', async () => {
    await mount({ avatarPath: NEW, avatarState: 'pending' });

    expect(screen.getByText(/Checking your photo/)).toBeTruthy();
    expect(screen.queryByLabelText(/photo$/)).toBeNull();
    expect(screen.queryByTestId('avatar-photo')).toBeNull();
  });
});

describe('removing a photo', () => {
  it('deletes the object as well as the row', async () => {
    await mount({ avatarPath: OLD, avatarState: 'ready' });

    await press('Remove your photo');

    expect(mockClear).toHaveBeenCalledWith(OLD);
    expect(seen.people[ME]?.avatarPath).toBeUndefined();
    expect(seen.people[ME]?.avatarState).toBeUndefined();
  });

  it('keeps saying there is a photo when the delete failed', async () => {
    mockClear.mockResolvedValue(false);
    await mount({ avatarPath: OLD, avatarState: 'ready' });

    await press('Remove your photo');

    // Showing it gone would be a lie the next pull corrects by bringing the
    // photo back.
    expect(seen.people[ME]).toMatchObject({ avatarPath: OLD, avatarState: 'ready' });
    expect(screen.getByText(/still there/i)).toBeTruthy();
  });
});

describe('a demo account', () => {
  it('is not offered a photo at all, because nothing here reaches a server', async () => {
    render(
      <StoreProvider persist={false} sync={false} restored={{ settingsOpen: true, account: 'seeded' }}>
        <SettingsOverlay topInset={0} />
      </StoreProvider>,
    );
    await act(async () => {});

    expect(screen.queryByLabelText('Add a photo')).toBeNull();
  });
});
