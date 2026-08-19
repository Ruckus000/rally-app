/**
 * The one row that turns a throwaway account into one you can get back.
 *
 * Driven through the real `MeScreen` and the real `linkApple`, because the
 * interesting behaviour is not that a button exists — it is that **the row
 * removes itself** when the link lands. That is the user's only confirmation, and
 * it depends on three separate things agreeing: gotrue flipping `is_anonymous`,
 * `session.ts` re-reading it, and the store's `SESSION` comparison noticing a
 * change where the status and the uuid are both identical. The last of those was
 * missing when this was written, and nothing else in the suite would have caught
 * it.
 *
 * Mounted with `persist sync` deliberately, not with the pair turned off. The
 * store only subscribes to session changes when the whole gate
 * (`persist && sync && account === 'live' && hasSupabaseConfig()`) is satisfied,
 * so with them off `linkApple` succeeds, announces, and nothing is listening —
 * the row would sit there and the test would be asserting the absence of a
 * subscription rather than the presence of a bug.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StoreProvider, useStore, type Action } from '../../state/store';
import { MeScreen } from '../MeScreen';
import { fakeSupabase } from '../../__mocks__/@supabase/supabase-js';
import { fakeApple } from '../../__mocks__/expo-apple-authentication';
import { __resetSupabaseForTests } from '../../lib/supabase';
import { __resetSessionForTests, ensureSession, type SessionState } from '../../sync/session';

let dispatch: (a: Action) => void;

function Harness() {
  const store = useStore();
  React.useEffect(() => {
    dispatch = store.dispatch;
  }, [store.dispatch]);
  return <MeScreen />;
}

const realEnv = { ...process.env };

beforeEach(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  fakeSupabase.reset();
  fakeApple.reset();
  __resetSupabaseForTests();
  __resetSessionForTests();
});

afterEach(() => {
  process.env = { ...realEnv };
});

const mount = (account: 'live' | 'seeded' = 'live') =>
  render(
    <StoreProvider persist sync restored={{ account }}>
      <Harness />
    </StoreProvider>,
  );

const row = () =>
  screen.queryByLabelText('Secure this account with Apple, so you can sign back in');

/**
 * Let the provider's own sign-in settle, then hand back what it landed on.
 *
 * `ensureSession` is awaited rather than assumed: it is idempotent and shares one
 * attempt between callers, so this resolves to the same session the provider is
 * subscribing to rather than racing a second one into existence. `linkApple`
 * guards on `session.ts`'s module state, which is exactly what this establishes —
 * a test that only dispatched `SESSION` into the store would render the row and
 * then have the tap refuse, passing for entirely the wrong reason.
 */
const signIn = async (): Promise<SessionState> => {
  let session: SessionState = { status: 'off' };
  await act(async () => {
    session = await ensureSession();
  });
  return session;
};

describe('who is offered it', () => {
  it('offers it to a live account that cannot be got back', async () => {
    mount();
    await signIn();

    expect(row()).not.toBeNull();
  });

  it('does not offer it to the demo, where there is no account to secure', async () => {
    mount('seeded');
    await signIn();

    expect(row()).toBeNull();
  });

  it('does not offer it to an account that is already secured', async () => {
    mount();
    const session = await signIn();
    if (session.status !== 'ready') throw new Error('expected a session');

    act(() => dispatch({ type: 'SESSION', session: { ...session, anonymous: false } }));

    expect(row()).toBeNull();
  });
});

describe('securing it', () => {
  it('removes the row, which is the only confirmation there is', async () => {
    mount();
    await signIn();
    expect(row()).not.toBeNull();

    await act(async () => {
      fireEvent.press(row() as never);
    });

    // Fails if the store's `SESSION` comparison ignores `anonymous`: the link
    // succeeds, gotrue updates the user, and the row sits there regardless.
    expect(row()).toBeNull();
  });

  it('keeps the account it started with', async () => {
    mount();
    const before = await signIn();
    if (before.status !== 'ready') throw new Error('expected a session');

    await act(async () => {
      fireEvent.press(row() as never);
    });

    // Every task and membership is owned by this uuid. A link that replaced it
    // would strand all of it, which is why this is not a sign-in.
    expect(fakeSupabase.ownerOfIdentity('apple-identity-token')).toBe(before.userId);
  });

  it('says nothing at all when the sheet is dismissed, and keeps offering', async () => {
    mount();
    await signIn();
    fakeApple.cancels();

    await act(async () => {
      fireEvent.press(row() as never);
    });

    // No line of copy: changing your mind is not an error.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(row()).not.toBeNull();
  });

  it('explains a taken Apple ID, because that one is actionable', async () => {
    mount();
    await signIn();
    fakeSupabase.identityOwnedBy('apple-identity-token', 'somebody-else');

    await act(async () => {
      fireEvent.press(row() as never);
    });

    expect(screen.getByText(/already on another Rally account/)).toBeTruthy();
    // Still anonymous, so the offer stands.
    expect(row()).not.toBeNull();
  });
});
