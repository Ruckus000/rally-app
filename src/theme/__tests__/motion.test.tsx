/**
 * Reduce Motion survives a remount.
 *
 * `AccessibilityInfo.isReduceMotionEnabled()` is async and there is no
 * synchronous accessor, so the hook renders once before the answer lands. For
 * the nine consumers that mount at boot that gap is invisible — nothing has
 * animated yet.
 *
 * `DetailSheet` and `ReportSheet` are not those. They live inside `<Presence>`,
 * which unmounts them on close, so they remount on every open and — before this
 * — restarted at `false` every time. A reduce-motion user got the full 300ms
 * slide on essentially every sheet they opened, inside a backdrop that was
 * correctly still, for the life of the install. `DEVIATIONS.md` says "Reduced
 * motion is respected, as everywhere else".
 *
 * So the thing worth pinning is not what the hook answers — it is what it
 * answers on the *second* mount, before the platform has been asked again.
 */
import React from 'react';
import { AccessibilityInfo, Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { useReducedMotion, __resetReducedMotionForTests } from '../motion';

function Probe() {
  // Rendered rather than returned, so what is asserted is the value a component
  // would actually draw with on its first frame.
  return <Text testID="reduced">{String(useReducedMotion())}</Text>;
}

const reduced = () => screen.getByTestId('reduced').props.children;

beforeEach(() => {
  __resetReducedMotionForTests();
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('starts false and adopts the platform answer when it lands', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

  render(<Probe />);
  // Before the promise settles there is genuinely no answer, and false is the
  // honest one: this is the boot screen's frame, and nothing has animated yet.
  expect(reduced()).toBe('false');

  await act(async () => {});
  expect(reduced()).toBe('true');
});

it('starts true on the next mount, which is every sheet after the first', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

  const first = render(<Probe />);
  await act(async () => {});
  expect(reduced()).toBe('true');
  first.unmount();

  // A sheet closing and opening again. No `act` before the assertion: the
  // question is what the very first frame drew with, because that frame is
  // where the slide would have started.
  render(<Probe />);
  expect(reduced()).toBe('true');
});

it('still starts false for somebody who has it off', async () => {
  // The cache must remember the answer, not merely default to the loud one.
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

  const first = render(<Probe />);
  await act(async () => {});
  first.unmount();

  render(<Probe />);
  expect(reduced()).toBe('false');
});
