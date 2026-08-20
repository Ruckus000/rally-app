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
import { Alert, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StoreProvider, useStore } from '../../state/store';
import { accountLine, SettingsOverlay } from '../SettingsOverlay';
import * as signOutModule from '../settings/signOut';
import { fakeNotifications, __resetForTests } from '../../__mocks__/expo-notifications';
import * as sessionModule from '../../sync/session';
import { pending, __resetOutboxForTests } from '../../sync/outbox';
import { appleTrouble } from '../../lib/appleCopy';
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
/**
 * The store as it stands, for the assertions that are about state rather than
 * pixels. Captured in an effect: writing to an outer variable during render is
 * a side effect and lint says so.
 */
let seenState: ReturnType<typeof useStore>['state'];

function Watch() {
  const { state } = useStore();
  React.useEffect(() => {
    seenState = state;
  });
  return null;
}

const mount = async (restored: Record<string, unknown>, session?: SessionState) => {
  const tree = render(
    <StoreProvider persist={false} sync={false} restored={{ settingsOpen: true, ...restored }}>
      {session ? <Session session={session} /> : null}
      <Watch />
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
    expect(screen.queryByLabelText(/^Sign out/)).toBeNull();
  });

  it('still gets a page, and it says what kind of account this is', async () => {
    await mount({ account: 'seeded' });
    expect(screen.getByText(/Demo/i)).toBeTruthy();
  });
});

describe('what a secured live account sees', () => {
  it('is offered sign-out', async () => {
    await live({ status: 'ready', userId: ME, anonymous: false });
    expect(screen.getByLabelText(/^Sign out/)).toBeTruthy();
  });

  it('is not offered Apple linking, having already done it', async () => {
    await live({ status: 'ready', userId: ME, anonymous: false });
    expect(screen.queryByLabelText(/Secure this account/)).toBeNull();
  });
});

describe('what an anonymous live account sees', () => {
  it('is not offered sign-out, which it could not come back from', async () => {
    await live({ status: 'ready', userId: ME, anonymous: true });
    expect(screen.queryByLabelText(/^Sign out/)).toBeNull();
  });
});

describe('when the session has not resolved', () => {
  it('shows sign-out disabled rather than removing it', async () => {
    await live({ status: 'offline' });
    const row = screen.getByLabelText(/^Sign out/);
    expect(row.props.accessibilityState?.disabled).toBe(true);
  });

  it('says why', async () => {
    await live({ status: 'offline' });
    expect(screen.getByText(/Signing out needs a connection/i)).toBeTruthy();
  });

  /**
   * The other half of the same absence. `canSecure` needs the `anonymous`
   * claim, which only a resolved session carries — so the whole "Getting back
   * in" section used to disappear on an offline phone with nothing said. On the
   * page somebody opens *because* something is wrong, the one row that fixes
   * being unrecoverable was silently missing.
   */
  it('keeps the Secure row on screen, disabled, rather than removing it', async () => {
    await live({ status: 'offline' });
    const row = screen.getByLabelText(/^Secure this account/);
    expect(row.props.accessibilityState?.disabled).toBe(true);
  });

  it('says why securing is not available', async () => {
    await live({ status: 'offline' });
    expect(screen.getByText(/Securing this account needs a connection/i)).toBeTruthy();
  });

  it('carries the reason in the label too, where a screen reader will reach it', async () => {
    await live({ status: 'expired' });
    // A `Tap`'s label collapses its children, so the caption below is invisible
    // to VoiceOver — without this the row reads as "Secure this account,
    // dimmed" and stops.
    expect(screen.getByLabelText(/Secure this account\. Securing needs a connection/)).toBeTruthy();
  });

  it('does not offer a disabled Secure row on a build with no server', async () => {
    // `off` is not a session that failed to resolve — there is no server to
    // reach, `accountLine` says exactly that, and "needs a connection" would be
    // a lie about a connection that is never coming.
    await live({ status: 'off' });
    expect(screen.queryByLabelText(/^Secure this account/)).toBeNull();
    expect(screen.getByText(/No server is set up/)).toBeTruthy();
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

  /**
   * The five non-ready states, one assertion each, and the reason this block is
   * five tests rather than one.
   *
   * They were a single line \u2014 "Signed in. Checking this account\u2026" \u2014 for all
   * five. On a build with no Supabase config the session is `off`, so that line
   * claimed an account was signed in and being checked when neither would ever
   * be true, and it sat there indefinitely. Each of these pins the *distinction*
   * as much as the words: what each one must not say is asserted alongside what
   * it does.
   */
  it('says it is checking only while it is actually checking', () => {
    expect(accountLine('live', { status: 'signing-in' }, 'ios')).toBe(
      'Checking this account\u2026',
    );
  });

  it('does not claim a live account is signed in when there is no server at all', () => {
    const line = accountLine('live', { status: 'off' }, 'ios');
    expect(line).toMatch(/No server is set up/);
    expect(line).toMatch(/stays on this phone/);
    // The two claims the old single line made, and the whole of this bug.
    expect(line).not.toMatch(/Signed in/);
    expect(line).not.toMatch(/Checking/i);
  });

  it('tells an offline account it is signed in and will catch up, without implying loss', () => {
    const line = accountLine('live', { status: 'offline' }, 'ios');
    expect(line).toMatch(/^Signed in\./);
    expect(line).toMatch(/catches up on its own/);
    // Nothing is in flight, so nothing may say it is.
    expect(line).not.toMatch(/Checking/i);
  });

  it('tells an expired session this device is signed out, and leaves the way back to the banner', () => {
    const line = accountLine('live', { status: 'expired' }, 'ios');
    expect(line).toMatch(/Signed out on this device/);
    expect(line).not.toMatch(/Checking/i);
    // `SyncBanner` owns "Try again" and "Start over". Two doors onto one action
    // is worse than one.
    expect(line).not.toMatch(/Try again|Start over/i);
  });

  it('does not put the error\u2019s own message under a heading', () => {
    const message = 'Anonymous sign-in is disabled on this Supabase project.';
    const line = accountLine('live', { status: 'error', message }, 'ios');
    expect(line).toMatch(/isn\u2019t working/);
    expect(line).toMatch(/may not be enough/);
    // That string is banner copy \u2014 written to sit next to a retry, not under a
    // section title with nothing to do about it.
    expect(line).not.toContain(message);
    expect(line).not.toMatch(/Checking/i);
  });

  it('gives all five unresolved states different sentences', () => {
    const states: SessionState[] = [
      { status: 'off' },
      { status: 'signing-in' },
      { status: 'offline' },
      { status: 'expired' },
      { status: 'error', message: 'nope' },
    ];
    const lines = states.map((s) => accountLine('live', s, 'ios'));
    expect(new Set(lines).size).toBe(5);
  });

  it('still tells the demo the demo line, whatever the session says', () => {
    // `account !== 'live'` wins first, and must: a demo account's session is
    // `off` for a reason that has nothing to do with configuration.
    expect(accountLine('seeded', { status: 'off' }, 'ios')).toMatch(/reaches a server/i);
    expect(accountLine('fresh', { status: 'expired' }, 'ios')).toMatch(/reaches a server/i);
    expect(accountLine(null, { status: 'error', message: 'x' }, 'ios')).toMatch(
      /reaches a server/i,
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
 * Renaming yourself from the second door.
 *
 * The pairing is the test: `RENAME_SELF` moves the directory and
 * `queueProfileName` puts the same name in the outbox, in one tick. Only the
 * first of those is visible on the device, which is exactly why the second is
 * worth pinning — drop it and a rename looks perfect until the next pull
 * arrives with the old name and silently wins. `engine.test.tsx` pins the same
 * pair, but against a hand-written copy of `MeScreen`'s commit rather than
 * against this component, so it would not notice this one losing a line.
 */
describe('changing your name here', () => {
  beforeEach(() => {
    __resetOutboxForTests();
  });

  const nameField = () => screen.getByLabelText('Your name');

  it('moves the directory and queues the same name for the server', async () => {
    await live({ status: 'ready', userId: ME, anonymous: false });

    await act(async () => {
      fireEvent.changeText(nameField(), 'Maya Chen');
    });
    // A separate frame, because typing and tapping away are separate frames for
    // a person too — and batched into one, blur would still be holding the
    // commit from before the text changed.
    await act(async () => {
      fireEvent(nameField(), 'blur');
    });

    // On the device.
    expect(seenState.people[ME]?.name).toBe('Maya Chen');
    // And on its way off it. Without this line the rename reverts on the next
    // pull and nobody is told.
    const queued = pending().filter((e) => e.op === 'profile.update');
    expect(queued).toHaveLength(1);
    expect(queued[0].payload).toEqual({ name: 'Maya Chen' });
  });

  it('is a no-op when the field is left alone, so opening the page costs nothing', async () => {
    await live({ status: 'ready', userId: ME, anonymous: false });

    await act(async () => {
      fireEvent(nameField(), 'blur');
    });

    expect(pending().filter((e) => e.op === 'profile.update')).toHaveLength(0);
  });

  it('starts empty rather than inventing one, before the profile has arrived', async () => {
    await live({ status: 'ready', userId: ME, anonymous: false });

    // `people.name()` is total and answers "Someone" for an id it has never
    // seen — which is every live account until the first pull. Putting that in
    // an editable field shows somebody a name they never chose, and anything
    // they then type is appended to it.
    expect(nameField().props.value).toBe('');
    expect(nameField().props.placeholder).toBe('Your name');
  });

  it('is not offered to the demo, which has no server to tell', async () => {
    await mount({ account: 'seeded' });
    expect(screen.queryByLabelText('Your name')).toBeNull();
  });
});

/**
 * Securing the account, and the one failure that is not a failure.
 *
 * `linkApple` is stubbed rather than driven — `screens/__tests__/secureAccount.test.tsx`
 * owns whether the link actually lands, including the part where the row
 * removes itself. What is left for this page is the branch it owns: a dismissed
 * Apple sheet is the user changing their mind, and telling them it went wrong
 * would be the app arguing with them.
 */
describe('securing this account', () => {
  const anonIos = { status: 'ready', userId: ME, anonymous: true } as const;
  const secureRow = () => screen.getByLabelText(/Secure this account/);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('says nothing at all when the Apple sheet is dismissed', async () => {
    jest.spyOn(sessionModule, 'linkApple').mockResolvedValue({ ok: false, reason: 'cancelled' });
    await live(anonIos);

    await act(async () => {
      fireEvent.press(secureRow());
    });

    expect(screen.queryByText(appleTrouble('failed'))).toBeNull();
  });

  it('says one line when it actually went wrong', async () => {
    jest.spyOn(sessionModule, 'linkApple').mockResolvedValue({ ok: false, reason: 'failed' });
    await live(anonIos);

    await act(async () => {
      fireEvent.press(secureRow());
    });

    expect(screen.getByText(appleTrouble('failed'))).toBeTruthy();
  });
});

/**
 * The reminders row, and the one thing it must not be: a button that does
 * nothing.
 *
 * Three states, and the middle one is the whole reason this block exists. iOS
 * raises its permission prompt exactly once; after a refusal
 * `requestPermissionsAsync` resolves from the stored answer without showing
 * anything. So for somebody who declined during onboarding, "Turn on" that
 * asks again is a control that cannot possibly work — it resolves denied, sets
 * the same state back, and the row does not move. The only place that answer
 * can still be changed is the OS settings app, so that is where a denied tap
 * has to go.
 */
describe('the Monday reminder', () => {
  let openSettings: jest.SpyInstance;

  beforeEach(() => {
    __resetForTests();
    openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** What the OS looks like to somebody who tapped "Don't allow" once already. */
  const alreadyDeclined = async () => {
    await Notifications.requestPermissionsAsync();
  };

  it('asks, when nobody has been asked yet', async () => {
    fakeNotifications.grantOnAsk();
    await mount({ account: 'seeded' });

    await act(async () => {
      fireEvent.press(screen.getByLabelText(/Turn on the Monday reminder/));
    });

    expect(fakeNotifications.prompts()).toBe(1);
    expect(screen.getByText(/^On\./)).toBeTruthy();
  });

  it('sends somebody who already declined to the place that can still change it', async () => {
    await alreadyDeclined();
    await mount({ account: 'seeded' });

    await act(async () => {
      fireEvent.press(screen.getByLabelText(/Monday reminder/));
    });

    // Asking again is the bug: iOS answers from the stored refusal without
    // showing anything, so the row would sit there and the button would be
    // dead. The OS settings app is the only door left.
    expect(openSettings).toHaveBeenCalled();
    expect(fakeNotifications.prompts()).toBe(1);
  });

  it('sends somebody who already granted to settings too, to turn it back off', async () => {
    fakeNotifications.alreadyGranted();
    await mount({ account: 'seeded' });

    await act(async () => {
      fireEvent.press(screen.getByLabelText(/Monday reminder is on/));
    });

    expect(openSettings).toHaveBeenCalled();
  });

  it('does not offer a tap while it is still finding out', async () => {
    const tree = render(
      <StoreProvider persist={false} sync={false} restored={{ settingsOpen: true, account: 'seeded' }}>
        <SettingsOverlay topInset={0} />
      </StoreProvider>,
    );
    // Deliberately not settled: this is the frame between mount and the answer.
    const rowNow = screen.getByLabelText(/Checking/);
    expect(rowNow.props.accessibilityState?.disabled).toBe(true);
    await act(async () => {});
    tree.unmount();
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
    fireEvent.press(screen.getByLabelText(/^Sign out/));
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
