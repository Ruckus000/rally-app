/**
 * The override: what is stored, what wins, and the half of the setter that is
 * easy to forget.
 *
 * Three inputs decide which palette the tree gets — the `scheme` prop, the
 * stored preference, and the phone — and the only interesting thing about them
 * is the order. So the resolution block is a full matrix rather than a handful
 * of cases: three preferences against a light phone and a dark one, and then
 * the prop against every one of those. A rule stated in a docblock and tested
 * at two of its six points is a rule with four untested points.
 *
 * `useColorScheme` is mocked at its module path rather than by reassigning the
 * `react-native` export, which is a getter. The stand-in is the same shape as
 * the real one — state seeded from the current value, plus a subscription — so
 * `setDevice` re-renders the tree the way flipping the phone's appearance does,
 * without a `rerender()` that would hide a provider that had stopped
 * subscribing.
 *
 * The last block is the one worth having. A setter that repaints and does not
 * persist looks completely correct on screen and loses the choice on the next
 * launch, which is the exact bug this feature exists to avoid — so both halves
 * are asserted, from one tap, in the same test.
 */
import React from 'react';
import { Appearance, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { Tap } from '../../components/primitives';
import {
  Scheme,
  ThemeProvider,
  useSchemePreference,
  useTheme,
} from '../ThemeProvider';
import {
  SchemePreference,
  loadSchemePreference,
  saveSchemePreference,
} from '../schemePreference';

const KEY = 'rally:scheme:v1';

/**
 * The phone's own setting, and the listeners watching it — which is what RN's
 * `useColorScheme` is underneath. `mock`-prefixed because a `jest.mock` factory
 * is hoisted above every other binding in the file and may not close over
 * anything else.
 */
let mockDevice: 'light' | 'dark' | null = 'light';
const mockListeners = new Set<(next: 'light' | 'dark' | null) => void>();

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => {
    // A `require`, because a `jest.mock` factory is hoisted above every import
    // in the file and may not close over one. The lowercase name is not an
    // accident either: `React.useState` inside an anonymous factory reads to
    // the hooks lint rule as a hook called outside a component.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const react = require('react');
    const [seen, setSeen] = react.useState(mockDevice);
    react.useEffect(() => {
      mockListeners.add(setSeen);
      return () => {
        mockListeners.delete(setSeen);
      };
    }, []);
    return seen;
  },
}));

/** Flip the phone, from outside React, the way the OS does. */
function setDevice(next: 'light' | 'dark' | null) {
  act(() => {
    mockDevice = next;
    mockListeners.forEach((notify) => notify(next));
  });
}

beforeEach(async () => {
  mockDevice = 'light';
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

/** The scheme this subtree was handed, serialised rather than assigned out. */
function Probe() {
  const { scheme } = useTheme();
  return <Text testID="scheme">{scheme}</Text>;
}

const shown = () => screen.getByTestId('scheme').props.children as Scheme;

/** The whole control, driven the way the Settings rows drive it. */
function Control() {
  const { preference, setPreference } = useSchemePreference();
  return (
    <>
      <Text testID="preference">{preference}</Text>
      {(['system', 'light', 'dark'] as SchemePreference[]).map((value) => (
        <Tap key={value} accessibilityLabel={`pick ${value}`} onPress={() => setPreference(value)}>
          <Text>{value}</Text>
        </Tap>
      ))}
    </>
  );
}

describe('what comes back off disk', () => {
  it.each<SchemePreference>(['system', 'light', 'dark'])('round trips %s', async (preference) => {
    await saveSchemePreference(preference);
    await expect(loadSchemePreference()).resolves.toBe(preference);
  });

  it('answers system when nothing was ever stored', async () => {
    await expect(loadSchemePreference()).resolves.toBe('system');
  });

  it('answers system for a value it does not recognise', async () => {
    // A later build's fourth option, downgraded onto this one. Following the
    // phone is the only honest reading of a word this build cannot interpret.
    await AsyncStorage.setItem(KEY, 'sepia');
    await expect(loadSchemePreference()).resolves.toBe('system');
  });

  it('answers system for a malformed payload', async () => {
    // The shape a JSON-envelope version of this would have written. Nothing in
    // this build writes it; the point is that meeting one costs nothing.
    await AsyncStorage.setItem(KEY, '{"preference":"dark"');
    await expect(loadSchemePreference()).resolves.toBe('system');
  });

  it('answers system rather than rejecting when storage itself fails', async () => {
    // The one that matters at launch: this read sits in the same gate as the
    // fonts and the persisted state, so a rejection here is an app that does
    // not start because it could not find out what colour to be.
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('no disk'));
    await expect(loadSchemePreference()).resolves.toBe('system');
  });

  it('swallows a failed write rather than rejecting', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('quota'));
    await expect(saveSchemePreference('dark')).resolves.toBeUndefined();
  });
});

describe('which palette the tree gets', () => {
  const cases: [SchemePreference, 'light' | 'dark', Scheme][] = [
    ['system', 'light', 'light'],
    ['system', 'dark', 'dark'],
    ['light', 'light', 'light'],
    ['light', 'dark', 'light'],
    ['dark', 'light', 'dark'],
    ['dark', 'dark', 'dark'],
  ];

  it.each(cases)('preference %s on a %s phone renders %s', (preference, device, expected) => {
    mockDevice = device;
    render(
      <ThemeProvider preference={preference}>
        <Probe />
      </ThemeProvider>,
    );
    expect(shown()).toBe(expected);
  });

  it('follows the phone when nothing has been chosen at all', () => {
    // The prop is `undefined` for the first few milliseconds of every launch,
    // while the read off disk is in flight. That window must look like System.
    mockDevice = 'dark';
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(shown()).toBe('dark');
  });

  it.each(cases)('the scheme prop beats preference %s on a %s phone', (preference, device) => {
    mockDevice = device;
    render(
      <ThemeProvider scheme="dark" preference={preference}>
        <Probe />
      </ThemeProvider>,
    );
    expect(shown()).toBe('dark');

    screen.unmount();
    render(
      <ThemeProvider scheme="light" preference={preference}>
        <Probe />
      </ThemeProvider>,
    );
    expect(shown()).toBe('light');
  });
});

describe('flipping the phone', () => {
  it('still moves the app under system', () => {
    // The behaviour that shipped in 6d. Adding an override must not cost it.
    mockDevice = 'light';
    render(
      <ThemeProvider preference="system">
        <Probe />
      </ThemeProvider>,
    );
    expect(shown()).toBe('light');

    setDevice('dark');
    expect(shown()).toBe('dark');
  });

  it('is ignored once light has been pinned', () => {
    mockDevice = 'light';
    render(
      <ThemeProvider preference="light">
        <Probe />
      </ThemeProvider>,
    );

    setDevice('dark');
    expect(shown()).toBe('light');
  });

  it('is ignored once dark has been pinned', () => {
    mockDevice = 'dark';
    render(
      <ThemeProvider preference="dark">
        <Probe />
      </ThemeProvider>,
    );

    setDevice('light');
    expect(shown()).toBe('dark');
  });
});

describe('choosing', () => {
  it('repaints the tree and writes the choice, from one tap', async () => {
    // Both halves, deliberately in one test. A setter that only repainted
    // would pass a test that only looked at the screen, and the app would
    // forget the choice on the next launch with nothing to show for it.
    mockDevice = 'light';
    render(
      <ThemeProvider preference="system">
        <Control />
        <Probe />
      </ThemeProvider>,
    );
    expect(shown()).toBe('light');

    fireEvent.press(screen.getByLabelText('pick dark'));

    expect(shown()).toBe('dark');
    expect(screen.getByTestId('preference').props.children).toBe('dark');
    await act(async () => {});
    await expect(AsyncStorage.getItem(KEY)).resolves.toBe('dark');
  });

  it('outlasts the stored value it was layered over', async () => {
    // The in-session choice wins over the prop from disk, and keeps winning.
    // Seeding `useState` from the prop instead would have captured the
    // `undefined` this provider mounts with and never seen the stored value.
    mockDevice = 'dark';
    render(
      <ThemeProvider preference="dark">
        <Control />
        <Probe />
      </ThemeProvider>,
    );

    fireEvent.press(screen.getByLabelText('pick light'));
    expect(shown()).toBe('light');

    // And the phone still cannot overrule it.
    setDevice('dark');
    expect(shown()).toBe('light');
    await act(async () => {});
    await expect(AsyncStorage.getItem(KEY)).resolves.toBe('light');
  });

  it('hands the phone back the decision when system is chosen again', async () => {
    mockDevice = 'dark';
    render(
      <ThemeProvider preference="light">
        <Control />
        <Probe />
      </ThemeProvider>,
    );
    expect(shown()).toBe('light');

    fireEvent.press(screen.getByLabelText('pick system'));

    expect(shown()).toBe('dark');
    await act(async () => {});
    await expect(AsyncStorage.getItem(KEY)).resolves.toBe('system');
  });
});

/**
 * The surfaces this app does not draw.
 *
 * `Alert.alert`, the image picker and the Apple sign-in sheet come from iOS,
 * and they read the window's interface style rather than anything in
 * `tokens.ts`. `Appearance.setColorScheme` is the only lever on that, and under
 * jest there is no native module behind it — the call is a no-op — so these
 * watch the lever rather than its effect.
 */
describe('the platform is told too', () => {
  let told: jest.SpyInstance;

  beforeEach(() => {
    told = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
  });
  afterEach(() => told.mockRestore());

  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
  ] as const)('hands %s straight to the platform', async (pick, expected) => {
    render(
      <ThemeProvider preference="system">
        <Control />
      </ThemeProvider>,
    );
    fireEvent.press(screen.getByLabelText(`pick ${pick}`));
    expect(told).toHaveBeenCalledWith(expected);
    await act(async () => {});
  });

  /**
   * The release, which matters more than either override. `setColorScheme`
   * also changes what `getColorScheme()` reports, so a preference of 'system'
   * that never cleared a previous override would keep resolving to it and the
   * phone's own setting would stop reaching the app.
   */
  it('releases the override when the choice goes back to system', async () => {
    render(
      <ThemeProvider preference="dark">
        <Control />
      </ThemeProvider>,
    );
    told.mockClear();
    fireEvent.press(screen.getByLabelText('pick system'));
    expect(told).toHaveBeenCalledWith('unspecified');
    await act(async () => {});
  });

  it('applies a preference that arrived from disk rather than from a tap', () => {
    render(
      <ThemeProvider preference="dark">
        <Probe />
      </ThemeProvider>,
    );
    // Nobody touched the control; this is the launch path.
    expect(told).toHaveBeenCalledWith('dark');
  });

  /**
   * The ordering, which is the whole reason this is not an effect.
   *
   * `setColorScheme` emits no change event, so `useColorScheme()` only sees the
   * new value on its next render. Called after the state update instead, the
   * render reacting to that update would read the stale override — resolving
   * dark on a light phone — and nothing would re-render to correct it.
   *
   * So: the platform must hear about it before React re-renders. Counting
   * renders at the moment of the call is what says so.
   */
  it('tells the platform before the tree re-renders, not after', async () => {
    // Counted inside a *consumer*, not around one. Children of the provider
    // keep their element identity across a scheme change, so React bails out
    // of re-rendering them — only the subtrees that read the context run
    // again. A counter wrapped around `Control` would sit at 1 forever and
    // this test would pass on any ordering at all.
    let renders = 0;
    function CountingControl() {
      const { preference, setPreference } = useSchemePreference();
      renders += 1;
      return (
        <Tap accessibilityLabel="pick system" onPress={() => setPreference('system')}>
          <Text>{preference}</Text>
        </Tap>
      );
    }
    render(
      <ThemeProvider preference="dark">
        <CountingControl />
      </ThemeProvider>,
    );

    const atCall: number[] = [];
    told.mockClear();
    told.mockImplementation(() => {
      atCall.push(renders);
    });

    const before = renders;
    fireEvent.press(screen.getByLabelText('pick system'));

    expect(atCall[0]).toBe(before);
    expect(renders).toBeGreaterThan(before);
    await act(async () => {});
  });
});
