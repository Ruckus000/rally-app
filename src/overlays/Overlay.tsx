/**
 * Shared overlay container.
 *
 * The prototype's overlays could only be dismissed by their own chrome. The
 * handoff asks the build to add real back/Escape handling, so every overlay
 * routes its dismissal through here.
 */
import React, { useEffect, useState } from 'react';
import { Animated, BackHandler, Platform, View, ViewStyle } from 'react-native';
import { sheetEasing, useReducedMotion } from '../theme/motion';

/**
 * Under Jest, exit animations resolve on real timers the tests do not run, so
 * a closed overlay would linger in the tree after the synchronous assertion
 * that it is gone. Exits are instant there; enters still mount immediately
 * either way, so nothing is hidden from a test by the enter fade.
 */
const INSTANT_EXIT = typeof process !== 'undefined' && !!process.env?.JEST_WORKER_ID;

const ENTER_MS = 200;
const EXIT_MS = 150;

/**
 * Mount-and-fade wrapper for the overlay stack.
 *
 * The overlays used to appear and vanish in a single frame — a full-screen
 * jump cut on every open and close. This fades the subtree in on open and,
 * on close, keeps it mounted just long enough to fade out (native driver,
 * and inert: pointer events are off the moment `open` flips false).
 */
export function Presence({
  open,
  zIndex,
  children,
}: {
  open: boolean;
  zIndex: number;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [fade] = useState(() => new Animated.Value(open ? 1 : 0));

  // Mount/instant-unmount are render-time adjustments (the guarded
  // setState-during-render pattern); the effect below only drives animation.
  if (open && !mounted) setMounted(true);
  if (!open && mounted && (reduced || INSTANT_EXIT)) setMounted(false);

  useEffect(() => {
    if (open) {
      if (reduced) {
        fade.setValue(1);
        return;
      }
      Animated.timing(fade, {
        toValue: 1,
        duration: ENTER_MS,
        easing: sheetEasing,
        useNativeDriver: true,
      }).start();
      return;
    }
    if (reduced || INSTANT_EXIT) {
      fade.setValue(0);
      return;
    }
    Animated.timing(fade, {
      toValue: 0,
      duration: EXIT_MS,
      easing: sheetEasing,
      useNativeDriver: true,
    }).start(({ finished }) => {
      // An interrupted exit means `open` flipped back mid-fade; the enter
      // pass above owns the value now, so only a finished exit unmounts.
      if (finished) setMounted(false);
    });
  }, [open, reduced, fade]);

  if (!open && !mounted) return null;

  return (
    <Animated.View
      pointerEvents={open ? 'box-none' : 'none'}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex,
        opacity: fade,
      }}
    >
      {children}
    </Animated.View>
  );
}

export function Overlay({
  zIndex,
  background,
  onRequestClose,
  style,
  children,
}: {
  zIndex: number;
  background: string;
  onRequestClose: () => void;
  style?: ViewStyle;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onRequestClose();
      return true;
    });
    return () => sub.remove();
  }, [onRequestClose]);

  // Escape closes on web and on a hardware keyboard.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: { key: string }) => {
      if (e.key === 'Escape') onRequestClose();
    };
    const target = globalThis as unknown as {
      addEventListener?: (t: string, h: (e: never) => void) => void;
      removeEventListener?: (t: string, h: (e: never) => void) => void;
    };
    target.addEventListener?.('keydown', onKey as never);
    return () => target.removeEventListener?.('keydown', onKey as never);
  }, [onRequestClose]);

  return (
    <View
      accessibilityViewIsModal
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex,
          backgroundColor: background,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
