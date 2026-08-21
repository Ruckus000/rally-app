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
import { gutter } from './theme/tokens';
import { ThemeProvider, useTheme } from './theme/ThemeProvider';
import type { SchemePreference } from './theme/schemePreference';
import { sheetEasing, useReducedMotion } from './theme/motion';
import { StoreProvider, useStore, Config, State } from './state/store';
import { Header } from './shell/Header';
import { TabBar } from './shell/TabBar';
import { BootScreen } from './screens/BootScreen';
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

/**
 * Everything below the fonts: the palette, and the choice between the boot
 * screen and the app.
 *
 * This lives here rather than in the entry `App.tsx` at the repo root for one
 * reason — that file imports `expo-font` at module scope, and a test that
 * imports it drags the whole font stack in with it. On this machine that
 * resolves; on a clean `npm ci` it does not, because `expo-asset` exists in the
 * lockfile only nested under `expo` where `expo-font` cannot see it, and the
 * only copy the resolver can reach here is one sitting in a developer's home
 * directory. The test went green locally and red on CI, which is the worst
 * order to find that out in.
 *
 * So the entry file keeps what only it can do — fonts, splash timing, reading
 * persisted state off disk — and the shape of the tree lives here, where it can
 * be mounted and asserted on without any of that. The claim being tested is
 * about where the provider sits, not about font loading, and it should not have
 * to load fonts to make it.
 *
 * `ThemeProvider` wraps the branch rather than sitting inside it, so the boot
 * screen is covered too. It is the first thing anyone sees and it is drawn
 * before the app exists; a provider below the branch would leave it as the one
 * surface the palette cannot reach. Invisible today, because there is one
 * palette. In the PR that adds the dark one it is a light screen flashing in
 * front of a dark app on a dark device.
 *
 * `preference` — System, Light or Dark, read off disk by the entry file — is
 * handed to that same provider, for the same reason. It is not state and it is
 * not in the reducer: see `theme/schemePreference.ts` for why it has a storage
 * key of its own, and `theme/ThemeProvider.tsx` for why the in-session choice
 * is layered over this rather than seeded from it.
 */
export function Root({
  ready,
  restored,
  preference,
  onReveal,
}: {
  /** Fonts loaded (or given up on) and persisted state in hand. */
  ready: boolean;
  restored?: Partial<State> | null;
  /** What was chosen in Settings on a previous launch, if anything. */
  preference?: SchemePreference;
  /** Lifts the native splash once the frame underneath is drawn. */
  onReveal?: () => void;
}) {
  return (
    <ThemeProvider preference={preference}>
      <View style={{ flex: 1 }} onLayout={onReveal}>
        {ready ? <App restored={restored} /> : <BootScreen />}
      </View>
    </ThemeProvider>
  );
}

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
      {/* `ThemeProvider` is above this, in the root `App.tsx`, so that it also
          covers the boot screen — see the note there. Which palette you get is
          a fact about the device, not about the account: nothing in the reducer
          reads it, and a signed-out shell still has to be drawn in something.
          The Settings override does not change that: it is one AsyncStorage key
          of its own, read before first paint and owned by the provider, so
          resetting app data or signing out cannot alter how this phone
          renders. */}
      <StoreProvider config={config} restored={restored} persist={persist} sync={sync}>
        <Shell />
      </StoreProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const { colors: color, scheme } = useTheme();
  const { state } = useStore();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      {/* Two independent reasons for light glyphs, and it used to ask only the
          first. Plan is a near-black overlay drawn over whatever scheme is in
          force; the dark scheme makes the ground behind it near-black too. Ask
          only "is Plan open" and the status bar goes `dark-content` on a dark
          ground — near-black glyphs on a near-black bar, and the clock, the
          battery and the carrier vanish. Either condition alone is enough.

          Onboarding sets its own: four of its seven screens are paper in the
          light scheme, so it can't be answered from out here. */}
      <StatusBar barStyle={state.planOpen || scheme === 'dark' ? 'light-content' : 'dark-content'} />

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
