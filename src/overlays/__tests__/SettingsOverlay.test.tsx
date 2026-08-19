/**
 * What the page shows to each kind of account, and the one thing it must never
 * get wrong.
 *
 * Rendered through the real `StoreProvider` with `persist` and `sync` off:
 * nothing here needs a live session, because the guards take the session as a
 * value and the sequence is tested on its own. What is worth asserting here is
 * that the rules reach the screen — in particular that sign-out renders
 * *disabled* rather than absent when the session is unresolved, which is the
 * difference between a control that looks broken and one that explains itself.
 *
 * The session arrives by dispatch rather than through `restored`, because
 * `hydrate` deliberately refuses one off disk — a stored session would be an
 * unauthenticated claim to a user id — and silently replaces whatever it is
 * handed with `{ status: 'off' }`. Passing one in the restored payload would
 * therefore test the *offline* branch four times over and pass while doing it.
 *
 * The last block is the one that matters. `attemptSignOut` refuses while
 * anything is still queued, and `SIGN_OUT` wipes the device — so a dispatch
 * that happens regardless of the outcome destroys unsent work silently. That
 * contract lives in a comment in `settings/signOut.ts` and in one `if` in the
 * overlay; this pins the `if`.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StoreProvider, useStore } from '../../state/store';
import { accountLine, SettingsOverlay } from '../SettingsOverlay';
import * as signOutModule from '../settings/signOut';
import type { SessionState } from '../../sync/session';

const ME = '11111111-1111-4111-8111-111111111111';

/**
 * Puts a session into the store the only way the app itself can. Rendered as a
 * sibling of the overlay, so the effect has run by the time `render` returns.
 */
function Session({ session }: { session: SessionState }) {
  const { dispatch } = useStore();
  React.useEffect(() => {
    dispatch({ type: 'SESSION', session });
  }, [dispatch, session]);
  return null;
}

/**
 * Awaited, and every test here is async because of it. The notifications row
 * asks the OS whether it has permission, which resolves a microtask after the
 * render — outside `act`, where React rightly complains and the row is still
 * showing "Checking…". Letting it settle first is both quieter and closer to
 * what anybody actually looking at the page would see.
 */
const mount = async (restored: Record<string, unknown>, session?: SessionState) => {
  const tree = render(
    <StoreProvider persist={false} sync={false} restored={{ settingsOpen: true, ...restored }}>
      {session ? <Session session={session} /> : null}
      <SettingsOverlay topInset={0} />
    </StoreProvider>,
  );
  await act(async () => {});
  return tree;
};

const live = (session: SessionState) => mount({ account: 'live', selfId: ME }, session);

describe('what a demo account sees', () => {
  it('has no sign-out, because there is no account to leave', async () => {
    await mount({ account: 'seeded' });
    expect(screen.queryByLabelText('Sign out')).toBeNull();
  });

  it('still gets a page, and it says what kind of account this is', async () => {
    await mount({ account: 'seeded' });
    expect(screen.getByText(/Demo/i)).toBeTruthy();
  });
});

describe('what a secured live account sees', () => {
  it('is offered sign-out', async () => {
    await live({ status: 'ready', userId: ME, anonymous: false });
    expect(screen.getByLabelText('Sign out')).toBeTruthy();
  });

  it('is not offered Apple linking, having already done it', async () => {
    await live({ status: 'ready', userId: ME, anonymous: false });
    expect(screen.queryByLabelText(/Secure this account/)).toBeNull();
  });
});

describe('what an anonymous live account sees', () => {
  it('is not offered sign-out, which it could not come back from', async () => {
    await live({ status: 'ready', userId: ME, anonymous: true });
    expect(screen.queryByLabelText('Sign out')).toBeNull();
  });
});

describe('when the session has not resolved', () => {
  it('shows sign-out disabled rather than removing it', async () => {
    await live({ status: 'offline' });
    const row = screen.getByLabelText('Sign out');
    expect(row.props.accessibilityState?.disabled).toBe(true);
  });

  it('says why', async () => {
    await live({ status: 'offline' });
    expect(screen.getByText(/needs a connection/i)).toBeTruthy();
  });
});

describe('closing', () => {
  it('has a close control', async () => {
    await mount({ account: 'seeded' });
    expect(screen.getByLabelText('Close settings')).toBeTruthy();
  });
});

/**
 * The one sentence that says what this account is.
 *
 * Pinned per branch rather than through the page, because four of the five are
 * ordinary copy and the fifth is a requirement. On Android nothing can be
 * secured, so by `signOutVisible` nothing can sign out either — the Leaving
 * section is absent for every Android account, and an absence with no reason
 * given reads as a feature that got dropped rather than one that cannot exist.
 * This line is the only place the app says why, and it is the only line in the
 * app that whoever wrote it cannot see on the phone they wrote it on.
 */
describe('what the page says this account is', () => {
  const READY = { status: 'ready', userId: ME, anonymous: false } as const;
  const ANON = { status: 'ready', userId: ME, anonymous: true } as const;

  it('tells the demo that none of it is real', () => {
    expect(accountLine('seeded', { status: 'off' }, 'ios')).toMatch(/reaches a server/i);
  });

  it('does not guess while the session is still resolving', () => {
    expect(accountLine('live', { status: 'offline' }, 'ios')).toBe(
      'Signed in. Checking this account\u2026',
    );
  });

  it('tells a secured account it can be got back', () => {
    expect(accountLine('live', READY, 'ios')).toBe(
      'Signed in, and this account can be got back with Apple.',
    );
  });

  it('points an anonymous iOS account at the row that fixes it', () => {
    const line = accountLine('live', ANON, 'ios');
    expect(line).toMatch(/can\u2019t be got back yet/);
    expect(line).toMatch(/Secure it below/);
  });

  it('tells an anonymous Android account why there is no sign-out either', () => {
    const line = accountLine('live', ANON, 'android');
    // Both halves, and the second is the load-bearing one: without it the page
    // silently offers an Android account neither a way to secure itself nor a
    // way to leave, and says nothing about either.
    expect(line).toMatch(/iOS-only/);
    expect(line).toMatch(/no sign-out here/);
    // And it must not be the iOS line, which promises a row that is not there.
    expect(line).not.toMatch(/Secure it below/);
  });
});

/**
 * The contract: `SIGN_OUT` is dispatched **only** on `{ ok: true }`.
 *
 * `attemptSignOut` is the thing that knows whether leaving is safe, and it is
 * stubbed here rather than driven, because what is under test is not the flush
 * sequence — `settings/__tests__/signOut.test.ts` owns that — but whether this
 * screen honours the answer it is given. So the answer is dictated and the
 * *store* is the assertion: signed out, or untouched.
 *
 * The confirm is a native `Alert`, which has no rendered button to press under
 * jest-expo. It is driven by spying on `Alert.alert` and calling the
 * destructive button's own `onPress` out of the captured arguments — the same
 * function the OS would call, so the only thing skipped is the OS drawing it.
 */
describe('signing out only when it is safe', () => {
  let alert: jest.SpyInstance;
  let seen: { account: string | null; onboardStep: string | null } = {
    account: null,
    onboardStep: null,
  };

  // Captured in an effect rather than during render: writing to an outer
  // variable while rendering is a side effect, and lint says so. Effects run
  // inside `act`, so `seen` is current by the time anything asserts on it.
  function Harness() {
    const { state } = useStore();
    React.useEffect(() => {
      seen = { account: state.account, onboardStep: state.onboardStep };
    });
    return <SettingsOverlay topInset={0} />;
  }

  const mountLive = async () => {
    render(
      <StoreProvider
        persist={false}
        sync={false}
        restored={{ settingsOpen: true, account: 'live', selfId: ME, onboardStep: null }}
      >
        <Session session={{ status: 'ready', userId: ME, anonymous: false }} />
        <Harness />
      </StoreProvider>,
    );
    // Same reason `mount` above is awaited: the reminders row settles first.
    await act(async () => {});
  };

  /** Tap Sign out, then answer the confirm the way the user would. */
  const confirmSignOut = async () => {
    fireEvent.press(screen.getByLabelText('Sign out'));
    const buttons = alert.mock.calls[0]?.[2] as
      | { text: string; style?: string; onPress?: () => void }[]
      | undefined;
    const go = buttons?.find((b) => b.style === 'destructive');
    if (!go?.onPress) throw new Error('no destructive button on the confirm');
    await act(async () => {
      go.onPress?.();
    });
  };

  beforeEach(() => {
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('wipes the device when the work is all sent', async () => {
    jest.spyOn(signOutModule, 'attemptSignOut').mockResolvedValue({ ok: true });
    await mountLive();
    expect(seen.account).toBe('live');

    await confirmSignOut();

    expect(seen.account).toBeNull();
    expect(seen.onboardStep).toBe('onboarding');
  });

  it('leaves everything exactly where it was when work is still queued', async () => {
    jest.spyOn(signOutModule, 'attemptSignOut').mockResolvedValue({ ok: false, unsent: 2 });
    await mountLive();

    await confirmSignOut();

    // The state is the real assertion: a dispatch here would have taken two
    // unsent rows off the phone and told nobody.
    expect(seen.account).toBe('live');
    expect(seen.onboardStep).toBeNull();

    // And the person is told why nothing happened, in the words the module owns.
    const second = alert.mock.calls[1];
    expect(second).toBeTruthy();
    expect(String(second[1])).toContain(signOutModule.unsentLine(2));
  });
});
