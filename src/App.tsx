/**
 * The 3-tab shell plus the overlay stack.
 *
 * Each tab keeps its own scroll container and stays mounted behind the
 * others, so switching back never remounts a screen or loses your place —
 * position still never bleeds between Week, Circle and Me, because none of
 * them share a scroll view to bleed through.
 */
import React, { useEffect, useState } from 'react';
import { Animated, ScrollView, StatusBar, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, gutter } from './theme/tokens';
import { ThemeProvider } from './theme/ThemeProvider';
import { sheetEasing, useReducedMotion } from './theme/motion';
import { StoreProvider, useStore, Config, State } from './state/store';
import { Header } from './shell/Header';
import { TabBar } from './shell/TabBar';
import { WeekScreen } from './screens/WeekScreen';
import { CircleScreen } from './screens/CircleScreen';
import { MeScreen } from './screens/MeScreen';
import { PlanOverlay } from './overlays/PlanOverlay';
import { LedgerOverlay } from './overlays/LedgerOverlay';
import { NotificationsOverlay } from './overlays/NotificationsOverlay';
import { SettingsOverlay } from './overlays/SettingsOverlay';
import { OnboardOverlay } from './overlays/OnboardOverlay';
import { RolloverOverlay } from './overlays/RolloverOverlay';
import { DetailSheet } from './overlays/DetailSheet';
import { Presence } from './overlays/Overlay';
import { ReportSheet } from './overlays/ReportSheet';
import { Toast } from './components/Toast';
import { SyncBanner } from './components/SyncBanner';
import { UnsavedBanner } from './components/UnsavedBanner';

export function App({
  config,
  restored,
  persist,
  sync,
}: {
  config?: Config;
  /** State loaded from disk before first paint. */
  restored?: Partial<State> | null;
  /** Tests turn this off so no debounced writes outlive the suite. */
  persist?: boolean;
  /** Mirrors `persist`: tests turn this off so no session work outlives the suite. */
  sync?: boolean;
}) {
  return (
    <SafeAreaProvider>
      {/* Outside the store on purpose. Which palette you get is a fact about
          the device, not about the account — nothing in the reducer reads it,
          and a signed-out shell still has to be drawn in something. When the
          Settings override lands it will pass a `scheme` down from persisted
          state, and that is still the palette following the person rather than
          the store owning it. */}
      <ThemeProvider>
        <StoreProvider config={config} restored={restored} persist={persist} sync={sync}>
          <Shell />
        </StoreProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const { state } = useStore();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      {/* Onboarding sets its own: four of its seven screens are paper, so it
          can't be answered from out here. */}
      <StatusBar barStyle={state.planOpen ? 'light-content' : 'dark-content'} />

      <Header topInset={insets.top} />

      {/* Outside the ScrollView on purpose: not syncing is a condition, not a
          row, and scrolling away from it should not make it go away. */}
      <SyncBanner />
      {/* Below the session one on purpose: not being signed in is why writes
          would fail next, so it reads as cause then consequence. */}
      <UnsavedBanner />

      <View style={{ flex: 1 }}>
        <TabPane active={state.tab === 'week'}>
          <WeekScreen />
        </TabPane>
        <TabPane active={state.tab === 'circle'}>
          <CircleScreen />
        </TabPane>
        <TabPane active={state.tab === 'me'}>
          <MeScreen />
        </TabPane>
      </View>

      <TabBar bottomInset={insets.bottom} />

      <Presence open={state.planOpen} zIndex={45}>
        <PlanOverlay topInset={insets.top} bottomInset={insets.bottom} />
      </Presence>
      <Presence open={!!state.sheet} zIndex={50}>
        <DetailSheet bottomInset={insets.bottom} />
      </Presence>
      <Presence open={state.wrapOpen} zIndex={55}>
        <LedgerOverlay topInset={insets.top} bottomInset={insets.bottom} />
      </Presence>
      {/* Above the detail sheet rather than instead of it — a report is
          started from something you were already looking at, and cancelling
          puts you back on it. See the zIndex note in ReportSheet.tsx. */}
      <Presence open={!!state.reportTarget} zIndex={57}>
        <ReportSheet />
      </Presence>
      <Presence open={state.notifOpen} zIndex={58}>
        <NotificationsOverlay topInset={insets.top} bottomInset={insets.bottom} />
      </Presence>
      <Presence open={state.settingsOpen} zIndex={59}>
        <SettingsOverlay topInset={insets.top} />
      </Presence>
      <Presence open={!!state.onboardStep} zIndex={70}>
        <OnboardOverlay topInset={insets.top} bottomInset={insets.bottom} />
      </Presence>
      {/* Above everything: the week has already turned, so there is nothing
          behind this worth interacting with until it's answered. */}
      <Presence open={!!state.pendingRollover} zIndex={60}>
        <RolloverOverlay topInset={insets.top} bottomInset={insets.bottom} />
      </Presence>

      <Toast message={state.toast} seq={state.toastSeq} bottomInset={insets.bottom} />
    </View>
  );
}

/**
 * One tab's scroll container. All three stay mounted — switching used to
 * unmount the old screen, mount the new one from scratch in the tap's frame
 * (the visible hitch), and throw away its scroll position. Hidden panes are
 * `display: none`; the incoming pane cross-fades over one beat.
 */
function TabPane({ active, children }: { active: boolean; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const [fade] = useState(() => new Animated.Value(1));
  const wasActive = React.useRef(active);

  useEffect(() => {
    if (active === wasActive.current) return;
    wasActive.current = active;
    if (!active) return;
    if (reduced) {
      fade.setValue(1);
      return;
    }
    fade.setValue(0);
    Animated.timing(fade, {
      toValue: 1,
      duration: 160,
      easing: sheetEasing,
      useNativeDriver: true,
    }).start();
  }, [active, reduced, fade]);

  return (
    <Animated.View style={{ flex: 1, display: active ? 'flex' : 'none', opacity: fade }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 6, paddingHorizontal: gutter, paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
}
