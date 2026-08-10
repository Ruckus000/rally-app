/**
 * `prefers-reduced-motion` disables all animation. The reference keeps this and
 * so does the build — every animated component asks here first.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Easing } from 'react-native';

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduced(v);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return reduced;
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
