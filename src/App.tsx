/**
 * The 3-tab shell plus the overlay stack.
 *
 * One scroll container is shared by all three tabs, exactly as the reference
 * does — and it resets to the top on tab change so position never bleeds
 * between Week, Circle and Me.
 */
import React, { useEffect, useRef } from 'react';
import { ScrollView, StatusBar, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, gutter } from './theme/tokens';
import { StoreProvider, useStore, Config, State } from './state/store';
import { Header } from './shell/Header';
import { TabBar } from './shell/TabBar';
import { WeekScreen } from './screens/WeekScreen';
import { CircleScreen } from './screens/CircleScreen';
import { MeScreen } from './screens/MeScreen';
import { PlanOverlay } from './overlays/PlanOverlay';
import { LedgerOverlay } from './overlays/LedgerOverlay';
import { NotificationsOverlay } from './overlays/NotificationsOverlay';
import { OnboardOverlay } from './overlays/OnboardOverlay';
import { RolloverOverlay } from './overlays/RolloverOverlay';
import { DetailSheet } from './overlays/DetailSheet';
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
      <StoreProvider config={config} restored={restored} persist={persist} sync={sync}>
        <Shell />
      </StoreProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const { state } = useStore();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);

  // Scroll position resets on tab change rather than bleeding between tabs.
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [state.tab]);

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

      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 6, paddingHorizontal: gutter, paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {state.tab === 'week' ? <WeekScreen /> : null}
        {state.tab === 'circle' ? <CircleScreen /> : null}
        {state.tab === 'me' ? <MeScreen /> : null}
      </ScrollView>

      <TabBar bottomInset={insets.bottom} />

      {state.planOpen ? <PlanOverlay topInset={insets.top} bottomInset={insets.bottom} /> : null}
      {state.sheet ? <DetailSheet bottomInset={insets.bottom} /> : null}
      {state.wrapOpen ? <LedgerOverlay topInset={insets.top} bottomInset={insets.bottom} /> : null}
      {state.notifOpen ? <NotificationsOverlay topInset={insets.top} /> : null}
      {state.onboardStep ? (
        <OnboardOverlay topInset={insets.top} bottomInset={insets.bottom} />
      ) : null}
      {/* Above everything: the week has already turned, so there is nothing
          behind this worth interacting with until it's answered. */}
      {state.pendingRollover ? (
        <RolloverOverlay topInset={insets.top} bottomInset={insets.bottom} />
      ) : null}

      <Toast message={state.toast} seq={state.toastSeq} />
    </View>
  );
}
