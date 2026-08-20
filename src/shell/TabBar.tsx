/**
 * Three tabs and a raised centre FAB. The FAB is not a tab — Plan is an
 * action, not a destination.
 */
import React from 'react';
import { View } from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { onDark, onLight, radius } from '../theme/tokens';
import { useColors, useShadows } from '../theme/ThemeProvider';
import { Sans, Tap } from '../components/primitives';
import { Icon, IconName } from '../components/Icon';
import { useStore, Tab } from '../state/store';

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'week', label: 'Week', icon: 'week' },
  { key: 'circle', label: 'Circle', icon: 'circle' },
  { key: 'me', label: 'Me', icon: 'me' },
];

/** The lime radial bloom behind the active tab icon. */
function ActiveGlow({ active }: { active: boolean }) {
  const color = useColors();
  if (!active) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: -9, left: -9, width: 48, height: 48 }}>
      <Svg width={48} height={48}>
        <Defs>
          <RadialGradient id="tabGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color.lime} stopOpacity={0.55} />
            <Stop offset="72%" stopColor={color.lime} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={48} height={48} fill="url(#tabGlow)" />
      </Svg>
    </View>
  );
}

export function TabBar({ bottomInset }: { bottomInset: number }) {
  const color = useColors();
  const shadows = useShadows();
  const { state, dispatch } = useStore();

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: Math.max(bottomInset, 26) }}>
      <BlurView
        intensity={40}
        tint="dark"
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            borderRadius: radius.tabbar,
            paddingVertical: 9,
            paddingHorizontal: 6,
            overflow: 'hidden',
          },
          shadows.tabbar,
        ]}
      >
        <View style={{ ...StyleSheetAbsolute, backgroundColor: color.tabbar }} />

        {TABS.map((t, i) => {
          const active = state.tab === t.key;
          const tint = active ? color.lime : onDark.bodySecondary;
          const tab = (
            <Tap
              key={t.key}
              onPress={() => dispatch({ type: 'SET_TAB', tab: t.key })}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t.label}
              style={{
                flex: 1,
                alignItems: 'center',
                gap: 3,
                paddingVertical: 6,
                minHeight: 48,
                justifyContent: 'center',
              }}
            >
              <View style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
                <ActiveGlow active={active} />
                <Icon name={t.icon} size={20} color={tint} />
              </View>
              <Sans size={10} weight={700} color={tint}>
                {t.label}
              </Sans>
            </Tap>
          );

          // The FAB sits between Circle and Me.
          return i === 2 ? (
            <React.Fragment key="fab-and-me">
              <Tap
                onPress={() => dispatch({ type: 'OPEN_PLAN' })}
                accessibilityLabel="Plan your week"
                style={{
                  width: 54,
                  height: 46,
                  marginHorizontal: 4,
                  borderRadius: 17,
                  backgroundColor: color.lime,
                  alignItems: 'center',
                  justifyContent: 'center',
                  ...shadows.fab,
                }}
              >
                <Icon name="plus" size={22} color={onLight} />
              </Tap>
              {tab}
            </React.Fragment>
          ) : (
            tab
          );
        })}
      </BlurView>
    </View>
  );
}

const StyleSheetAbsolute = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };
