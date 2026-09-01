/**
 * `prefers-reduced-motion` disables all animation. The reference keeps this and
 * so does the build — every animated component asks here first.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Easing } from 'react-native';

/**
 * The last answer the platform gave, kept for the next mount.
 *
 * The read is async and there is no synchronous accessor, so a hook that starts
 * `false` plays the animation it exists to suppress until the promise lands.
 * For the nine consumers that mount once at boot that window is invisible.
 * `DetailSheet` and `ReportSheet` are not those: they live inside `<Presence>`,
 * which unmounts them on close, so they remount on *every* open and restart the
 * window every time — the full 300ms slide, for a reduce-motion user, on
 * essentially every sheet they open, inside a backdrop that is correctly still.
 *
 * Those boot consumers are what fills this, milliseconds into the launch and
 * long before a sheet can be opened, which is why there is no eager read here.
 * Wrong only for the first mount of a cold process, which is the boot screen.
 */
let known = false;

export function useReducedMotion() {
  const [reduced, setReduced] = useState(known);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      known = v;
      if (alive) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      known = v;
      setReduced(v);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

/** The cache is module state, and a suite that flips the setting needs it gone. */
export function __resetReducedMotionForTests() {
  known = false;
}

/** `bSheet` — .3s cubic-bezier(.2,.9,.2,1) */
export const sheetEasing = Easing.bezier(0.2, 0.9, 0.2, 1);
export const SHEET_DURATION = 300;

/** `bPop` — scale .86 → 1.04 → 1 */
export const popEasing = Easing.bezier(0.2, 1.4, 0.4, 1);
export const POP_DURATION = 300;

/** `bRise` — translateY(12px) → 0, opacity 0 → 1 */
export const RISE_DISTANCE = 12;
export const RISE_DURATION = 260;
