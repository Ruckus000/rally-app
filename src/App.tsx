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
import { StoreProvider, useStore, Config } from './state/store';
import { Header } from './shell/Header';
import { TabBar } from './shell/TabBar';
import { WeekScreen } from './screens/WeekScreen';
import { CircleScreen } from './screens/CircleScreen';
import { MeScreen } from './screens/MeScreen';
import { PlanOverlay } from './overlays/PlanOverlay';
import { LedgerOverlay } from './overlays/LedgerOverlay';
import { NotificationsOverlay } from './overlays/NotificationsOverlay';
import { JoinOverlay } from './overlays/JoinOverlay';
import { DetailSheet } from './overlays/DetailSheet';
import { Toast } from './components/Toast';

export function App({ config }: { config?: Config }) {
  return (
    <SafeAreaProvider>
      <StoreProvider config={config}>
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

  const planOpen = state.planOpen || state.onboardStep === 'plan';

  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      <StatusBar barStyle={planOpen || state.onboardStep === 'join' ? 'light-content' : 'dark-content'} />

      <Header topInset={insets.top} />

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

      {planOpen ? <PlanOverlay topInset={insets.top} bottomInset={insets.bottom} /> : null}
      {state.sheet ? <DetailSheet bottomInset={insets.bottom} /> : null}
      {state.wrapOpen ? <LedgerOverlay topInset={insets.top} bottomInset={insets.bottom} /> : null}
      {state.notifOpen ? <NotificationsOverlay topInset={insets.top} /> : null}
      {state.onboardStep === 'join' ? <JoinOverlay /> : null}

      <Toast message={state.toast} seq={state.toastSeq} />
    </View>
  );
}
