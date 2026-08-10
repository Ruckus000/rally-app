/**
 * Shared overlay container.
 *
 * The prototype's overlays could only be dismissed by their own chrome. The
 * handoff asks the build to add real back/Escape handling, so every overlay
 * routes its dismissal through here.
 */
import React, { useEffect } from 'react';
import { BackHandler, Platform, View, ViewStyle } from 'react-native';

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
