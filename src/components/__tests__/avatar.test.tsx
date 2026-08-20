/**
 * When a face is drawn, and — much more importantly — when it is not.
 *
 * The whole avatar feature rests on one sentence: bytes render only when the
 * state is `ready` and a signed URL is in hand. Every other case draws
 * initials, and initials are the design rather than a failure (`HANDOFF.md`:
 * *avatars are generated initials on tinted circles*). Two of the cases below
 * are security properties and not cosmetics:
 *
 *  - **`pending`** is an image the screener has not judged. Rendering it to
 *    anybody, its owner included, makes a screenshot the distribution channel
 *    for exactly the picture this feature exists to hold back.
 *  - **`refused`** is one the screener said no to. The object is already gone
 *    server-side; a client that would still render a URL for it is a client
 *    that would render a cached one.
 *
 * The signing layer is real here — only `lib/supabase` is faked — so what is
 * asserted is the path from `Person.avatarPath` to an `<Image>`, not a mock of
 * it agreeing with itself.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { Avatar } from '../Avatar';
import { resetAvatarUrls } from '../../lib/avatarUrl';
import { personOf, type AvatarState, type Person } from '../../data/people';

const ME = '11111111-1111-4111-8111-111111111111';
const PATH = `${ME}/photo.jpg`;
const SIGNED = 'https://example.test/avatars/photo.jpg?token=abc';

const mockSign = jest.fn();

jest.mock('../../lib/supabase', () => ({
  hasSupabaseConfig: () => true,
  getSupabase: () => ({
    storage: {
      from: () => ({
        createSignedUrl: (path: string, ttl: number) => mockSign(path, ttl),
      }),
    },
  }),
}));

/**
 * The directory, faked at the one seam `Avatar` reads it through. A real
 * `StoreProvider` would work and would put a reducer, a persistence effect and
 * an account mode between this test and the two lines it is about.
 */
const mockDirectory: { people: Person[] } = { people: [] };
jest.mock('../../state/store', () => {
  // Resolved inside the factory: Jest hoists `jest.mock` above the imports, so
  // anything referenced here has to be fetched when the mock actually runs.
  const people = jest.requireActual('../../data/people') as typeof import('../../data/people');
  return {
    usePeople: () =>
      people.makePeople(people.indexPeople(mockDirectory.people), '11111111-1111-4111-8111-111111111111'),
  };
});

const person = (extra: Partial<Person>): void => {
  mockDirectory.people = [{ ...personOf(ME, 'Maya Chen'), ...extra }];
};

/** Rendered and given the microtask the signing round trip needs. */
const show = async () => {
  render(<Avatar who={ME} />);
  await act(async () => {});
};

beforeEach(() => {
  resetAvatarUrls();
  mockSign.mockReset();
  mockSign.mockResolvedValue({ data: { signedUrl: SIGNED }, error: null });
  mockDirectory.people = [];
});

describe('initials, which is most of the time', () => {
  const fallsBack = async (why: string, extra: Partial<Person>) => {
    person(extra);
    await show();
    expect(screen.getByText('MC')).toBeTruthy();
    expect(screen.queryByTestId('avatar-photo')).toBeNull();
    expect(why).toBeTruthy();
  };

  it('draws initials for somebody who has never uploaded anything', () =>
    fallsBack('no path, no state', {}));

  it('draws initials while a photo is being screened', async () => {
    await fallsBack('pending', { avatarPath: PATH, avatarState: 'pending' });
    // And asks for no URL at all. Signing an unscreened object would put a
    // working link to it in memory, one `if` away from a screen.
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('draws initials for a photo the screener refused', async () => {
    await fallsBack('refused', { avatarPath: PATH, avatarState: 'refused' });
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('draws initials when the state says ready but there is no path', () =>
    fallsBack('ready with nothing behind it', { avatarState: 'ready' as AvatarState }));

  it('draws initials when the URL cannot be signed', async () => {
    mockSign.mockResolvedValue({ data: null, error: { message: 'expired' } });
    await fallsBack('signing failed', { avatarPath: PATH, avatarState: 'ready' });
    expect(mockSign).toHaveBeenCalled();
  });

  it('falls back to initials when the image itself fails to load', async () => {
    person({ avatarPath: PATH, avatarState: 'ready' });
    await show();

    // A URL that expired between signing and fetching, or an object deleted
    // underneath it. What must never happen is the torn-image glyph.
    await act(async () => {
      fireEvent(screen.getByTestId('avatar-photo'), 'error');
    });

    expect(screen.queryByTestId('avatar-photo')).toBeNull();
    expect(screen.getByText('MC')).toBeTruthy();
  });
});

describe('the face, when there is one', () => {
  it('renders the signed image once the photo is ready', async () => {
    person({ avatarPath: PATH, avatarState: 'ready' });
    await show();

    expect(screen.getByTestId('avatar-photo').props.source).toEqual({ uri: SIGNED });
    expect(screen.queryByText('MC')).toBeNull();
    expect(mockSign).toHaveBeenCalledWith(PATH, expect.any(Number));
  });

  it('is still named after the person, not after the file', async () => {
    person({ avatarPath: PATH, avatarState: 'ready' });
    await show();

    // The photo is as decorative as the initials were: same accessible name.
    expect(screen.getByLabelText('Maya Chen')).toBeTruthy();
  });
});
