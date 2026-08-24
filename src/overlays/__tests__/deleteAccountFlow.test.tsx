/**
 * From the Settings row to the Welcome screen, and back again.
 *
 * Three things here cannot be caught anywhere else.
 *
 *   1. **The row is offered where sign-out is not.** An anonymous account —
 *      which is every Android install — has no way out of this app except this
 *      control. `guards.test.ts` pins the rule; this pins that the rule reaches
 *      the screen, because a `signOutVisible` copy-pasted into the JSX would
 *      satisfy the first and fail the second.
 *
 *   2. **`DELETION_SCHEDULED` is dispatched only on success.** The dispatch
 *      wipes the device. Fire it for a request that never landed and somebody
 *      is standing at the Welcome screen believing their account is going, with
 *      their week off the phone and nothing on the server that agrees.
 *
 *   3. **"Get started" with a deletion pending signs out first.** This is the
 *      subtlest bug in the feature and it leaves no trace when it happens.
 *      `endSessionLocally` deliberately leaves a valid session on disk, and
 *      `resolveSession` prefers a stored session to signing in — so without the
 *      explicit sign-out, the button that means "walk away and start again"
 *      silently returns you to the account you just asked to destroy.
 *
 * The confirm is a native `Alert`, which has no rendered button under
 * jest-expo. It is driven the way `SettingsOverlay.test.tsx` drives sign-out:
 * spy on `Alert.alert`, find the destructive button in the captured arguments,
 * and call its own `onPress` — the same function the OS would call, so the only
 * thing skipped is the OS drawing it.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StoreProvider, useStore } from '../../state/store';
import { SettingsOverlay } from '../SettingsOverlay';
import { OnboardOverlay } from '../OnboardOverlay';
import * as deleteModule from '../settings/deleteAccount';
import * as sessionModule from '../../sync/session';
import type { SessionState } from '../../sync/session';

const ME = '11111111-1111-4111-8111-111111111111';
const AT = '2026-08-24T09:00:00.000Z';
const READY_ANON: SessionState = { status: 'ready', userId: ME, anonymous: true };

function Session({ session }: { session: SessionState }) {
  const { dispatch } = useStore();
  React.useEffect(() => {
    dispatch({ type: 'SESSION', session });
  }, [dispatch, session]);
  return null;
}

let seen: ReturnType<typeof useStore>['state'];

function Watch() {
  const { state } = useStore();
  React.useEffect(() => {
    seen = state;
  });
  return null;
}

const settings = async (
  restored: Record<string, unknown> = {},
  session: SessionState = READY_ANON,
) => {
  render(
    <StoreProvider
      persist={false}
      sync={false}
      restored={{ settingsOpen: true, account: 'live', selfId: ME, onboardStep: null, ...restored }}
    >
      <Session session={session} />
      <Watch />
      <SettingsOverlay topInset={0} />
    </StoreProvider>,
  );
  await act(async () => {});
};

const welcome = async (restored: Record<string, unknown> = {}) => {
  render(
    <StoreProvider
      persist={false}
      sync={false}
      restored={{ account: null, onboardStep: 'onboarding', ...restored }}
    >
      <Watch />
      <OnboardOverlay topInset={0} bottomInset={0} />
    </StoreProvider>,
  );
  await act(async () => {});
};

/** Walk to the confirm screen and answer the alert the way the user would. */
const confirmDelete = async (alert: jest.SpyInstance) => {
  fireEvent.press(screen.getByLabelText('Delete my account'));
  const buttons = alert.mock.calls[0]?.[2] as
    | { text: string; style?: string; onPress?: () => void }[]
    | undefined;
  const go = buttons?.find((b) => b.style === 'destructive');
  if (!go?.onPress) throw new Error('no destructive button on the confirm');
  await act(async () => {
    go.onPress?.();
  });
};

// ─── the row ───────────────────────────────────────────────────────────────

describe('the row a live account is offered', () => {
  it('is there for an anonymous account, which has no sign-out at all', async () => {
    await settings();

    expect(screen.queryByLabelText(/^Sign out/)).toBeNull();
    expect(screen.getByLabelText('Delete my account')).toBeTruthy();
  });

  it('is absent from a demo account', async () => {
    await settings({ account: 'seeded' }, { status: 'off' });
    expect(screen.queryByLabelText(/^Delete my account/)).toBeNull();
  });

  it('renders disabled, not missing, when the session has not resolved', async () => {
    // Same rule the whole page follows: a control that comes and goes with
    // connectivity reads as a bug, and this is the row somebody goes looking
    // for once they have decided to leave.
    await settings({}, { status: 'offline' });

    const rowNode = screen.getByLabelText(/^Delete my account\. This needs a connection/);
    expect(rowNode.props.accessibilityState?.disabled).toBe(true);
  });
});

// ─── the screen ────────────────────────────────────────────────────────────

describe('the confirm screen', () => {
  it('says what goes and what stays before anything is asked', async () => {
    await settings();
    fireEvent.press(screen.getByLabelText('Delete my account'));

    expect(screen.getByText('What goes')).toBeTruthy();
    expect(screen.getByText('What stays')).toBeTruthy();
    // The one somebody is most likely to be surprised by, and the one the
    // privacy policy is on the hook for.
    expect(screen.getByText(/safety record/)).toBeTruthy();
  });

  it('goes back to settings without doing anything', async () => {
    await settings();
    fireEvent.press(screen.getByLabelText('Delete my account'));
    fireEvent.press(screen.getByLabelText('Keep my account'));

    expect(screen.getByText('Settings')).toBeTruthy();
    expect(seen.deletionAt).toBeNull();
    expect(seen.account).toBe('live');
  });
});

// ─── the dispatch ──────────────────────────────────────────────────────────

describe('scheduling only happens when the server said so', () => {
  let alert: jest.SpyInstance;

  beforeEach(() => {
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('wipes the device to onboarding and keeps the date', async () => {
    jest.spyOn(deleteModule, 'attemptScheduleDeletion').mockResolvedValue({ ok: true, at: AT });
    await settings();
    fireEvent.press(screen.getByLabelText('Delete my account'));
    expect(seen.account).toBe('live');

    await confirmDelete(alert);

    expect(seen.account).toBeNull();
    expect(seen.onboardStep).toBe('onboarding');
    // The one field that survives the wipe, and the reason it is persisted.
    expect(seen.deletionAt).toBe(AT);
  });

  it('leaves everything exactly where it was when it failed', async () => {
    // The state is the real assertion. A dispatch here would have taken
    // somebody's week off the phone for a request the server never saw.
    jest.spyOn(deleteModule, 'attemptScheduleDeletion').mockResolvedValue({ ok: false });
    await settings();
    fireEvent.press(screen.getByLabelText('Delete my account'));

    await confirmDelete(alert);

    expect(seen.account).toBe('live');
    expect(seen.onboardStep).toBeNull();
    expect(seen.deletionAt).toBeNull();
    expect(screen.getByText(/didn’t reach the server/)).toBeTruthy();
  });

  it('does nothing at all if the alert is cancelled', async () => {
    const schedule = jest
      .spyOn(deleteModule, 'attemptScheduleDeletion')
      .mockResolvedValue({ ok: true, at: AT });
    await settings();
    fireEvent.press(screen.getByLabelText('Delete my account'));
    fireEvent.press(screen.getByLabelText('Delete my account'));

    expect(schedule).not.toHaveBeenCalled();
  });
});

// ─── the way back ──────────────────────────────────────────────────────────

describe('the Welcome screen a scheduled deletion lands on', () => {
  afterEach(() => jest.restoreAllMocks());

  it('offers nothing extra when no deletion is pending', async () => {
    await welcome();
    expect(screen.queryByLabelText('Keep my account')).toBeNull();
  });

  it('names the date and offers the account back', async () => {
    await welcome({ deletionAt: AT });

    expect(screen.getByLabelText('Keep my account')).toBeTruthy();
    expect(screen.getByText(new RegExp(deleteModule.deletionDateLine(AT)))).toBeTruthy();
  });

  it('puts the account back when the server agrees', async () => {
    jest.spyOn(deleteModule, 'attemptCancelDeletion').mockResolvedValue(true);
    await welcome({ deletionAt: AT });

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Keep my account'));
    });

    expect(seen.deletionAt).toBeNull();
    expect(seen.account).toBe('live');
    expect(seen.onboardStep).toBeNull();
  });

  it('keeps the offer on screen when the server did not answer', async () => {
    // Failing closed. Clearing the marker on a failed cancel would hide the
    // only control that can save the account, for an account still scheduled.
    jest.spyOn(deleteModule, 'attemptCancelDeletion').mockResolvedValue(false);
    await welcome({ deletionAt: AT });

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Keep my account'));
    });

    expect(seen.deletionAt).toBe(AT);
    expect(seen.account).toBeNull();
  });
});

// ─── the trapdoor ──────────────────────────────────────────────────────────

describe('starting again while a deletion is pending', () => {
  afterEach(() => jest.restoreAllMocks());

  it('revokes the stored session first, so it cannot be the old account', async () => {
    // The bug this exists for leaves no trace: `endSessionLocally` left a
    // usable session on disk, and `resolveSession` prefers a stored session to
    // signing in. Without this call, "Get started" hands somebody back the
    // account they just asked to destroy, and nothing on screen says so.
    const signOut = jest.spyOn(sessionModule, 'signOutEverywhere').mockResolvedValue(undefined);
    await welcome({ deletionAt: AT });

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Get started'));
    });

    expect(signOut).toHaveBeenCalled();
    expect(seen.deletionAt).toBeNull();
    expect(seen.account).toBe('live');
  });

  it('does not sign out when no deletion is pending, which is every other launch', async () => {
    const signOut = jest.spyOn(sessionModule, 'signOutEverywhere').mockResolvedValue(undefined);
    await welcome();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Get started'));
    });

    expect(signOut).not.toHaveBeenCalled();
    expect(seen.account).toBe('live');
  });
});
