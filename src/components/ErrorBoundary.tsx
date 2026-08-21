/**
 * The screen that used to be blank.
 *
 * React unmounts the whole tree when a render throws and nothing catches it,
 * which in a release build is a white rectangle and no way back. There was no
 * boundary anywhere in this app, so every render error looked identical from
 * the outside — to the person holding the phone, and to anyone asking them
 * afterwards what happened.
 *
 * Two jobs, and they are the same job: say something honest, and keep the
 * evidence. `Trouble` is the model for the first — one line, the app's voice,
 * no blame — but this is not a `Trouble`: that sits under a control that
 * failed and disappears when the message does, and this replaces everything.
 *
 * ─── what this does not catch ─────────────────────────────────────────────
 *
 * A React error boundary sees throws during render, in lifecycle methods, and
 * in the synchronous body of an effect. It does not see an async rejection, an
 * error in an event handler, or anything that kills the process. Those are not
 * oversights to fix here: the first two are already handled where they happen —
 * the sync engine and the outbox both catch their own and surface them through
 * `SyncBanner` and the dead list — and the third needs a native reporter, which
 * is a separate decision this deliberately is not.
 *
 * So the honest claim is narrow: a crash *inside React* now leaves a trace and
 * a way forward, where before it left neither.
 */
import React from 'react';
import { ScrollView, View } from 'react-native';

import { Caps, Sans, Tap } from './primitives';
import { gutter, onDark, radius } from '../theme/tokens';
import { useColors } from '../theme/ThemeProvider';
import { describe, readCrashes, recordCrash, tidy, type Crash } from '../lib/crashLog';

type Props = { children: React.ReactNode };
type State = { crash: Crash | null; earlier: number };

/**
 * The fallback, split out so it can use `useColors`.
 *
 * A class component is the only thing React offers as a boundary, and a class
 * cannot call hooks — so the part that needs the palette lives here, below it.
 * It is inside `ThemeProvider`, which is why it can ask at all.
 */
function CrashScreen({
  crash,
  earlier,
  onRetry,
}: {
  crash: Crash;
  /** How many were already on disk before this one. Counted, not subtracted. */
  earlier: number;
  onRetry: () => void;
}) {
  const colors = useColors();

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper, padding: gutter }}>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Caps size={11} color={colors.faintInk}>
          Something broke
        </Caps>
        <Sans size={17} weight={600} style={{ marginTop: 8 }}>
          This screen stopped working.
        </Sans>
        <Sans size={13.5} color={colors.faintInk} style={{ marginTop: 4 }}>
          Your week is saved. Nothing you wrote down has been lost.
        </Sans>

        {earlier > 0 ? (
          <Sans size={13.5} color={colors.faintInk} style={{ marginTop: 4 }}>
            {earlier === 1 ? 'This happened once before.' : `This happened ${earlier} times before.`}
          </Sans>
        ) : null}

        {/*
          The stack, shown rather than hidden. Everywhere else this app refuses
          to explain a failure — `IMAGE_BLOCKED_COPY` argues that case well. The
          opposite is right here: nobody reaches this screen except by hitting a
          bug, the only person who can act on it is the one being asked to
          report it, and a screenshot of a stack is worth more than a paragraph
          of apology. Selectable so it can be copied out.
        */}
        <ScrollView
          style={{
            maxHeight: 220,
            marginTop: 16,
            borderRadius: radius.smallCard,
            backgroundColor: colors.card,
            padding: 12,
          }}
        >
          <Sans size={12} selectable>
            {crash.message}
            {crash.componentStack ? `\n${crash.componentStack.trim()}` : ''}
          </Sans>
        </ScrollView>
      </View>

      <Tap
        onPress={onRetry}
        accessibilityLabel="Try again"
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          height: 54,
          borderRadius: 999,
          backgroundColor: colors.ink,
        }}
      >
        {/*
          `onDark.primary`, not `colors.paper`. The fill above is `ink`, which
          is a surface that stays dark in both schemes — so the label on it has
          to be a colour that never follows the ground down. `paper` is the
          ground: light on paper, #070A06 on dark. It read correctly for
          exactly as long as there was no dark palette, and would have gone
          near-black-on-near-black the day one landed. That day was PR 6d, and
          the token comment there had already named this mistake in advance.
        */}
        <Sans size={15} weight={600} color={onDark.primary}>
          Try again
        </Sans>
      </Tap>
    </View>
  );
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { crash: null, earlier: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { crash: { at: Date.now(), ...describe(error) } };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    // Recorded here rather than in `getDerivedStateFromError`, which React may
    // call more than once for the same error and which must stay pure.
    const crash: Crash = {
      at: Date.now(),
      ...describe(error),
      componentStack: info?.componentStack ? tidy(info.componentStack) : undefined,
    };
    this.setState({ crash });

    // Counted before it is appended, rather than by subtracting one from the
    // total afterwards. The append is async, so a subtraction races it and
    // reads one too few exactly when the disk is slow — which is to say, on
    // the devices where a crash is most likely in the first place.
    void (async () => {
      const earlier = (await readCrashes()).length;
      this.setState({ earlier });
      await recordCrash(crash);
    })();
  }

  render() {
    const { crash } = this.state;
    if (!crash) return this.props.children;
    // Remounting the children is the whole retry: the tree is rebuilt from the
    // store, which was never the thing that threw. If it throws again the
    // boundary catches it again, which is a loop the person can see rather
    // than one that hides.
    return (
      <CrashScreen
        crash={crash}
        earlier={this.state.earlier}
        onRetry={() => this.setState({ crash: null, earlier: 0 })}
      />
    );
  }
}
