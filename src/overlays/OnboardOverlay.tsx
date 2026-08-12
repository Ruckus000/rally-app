/**
 * The onboarding flow: seven screens, one host.
 *
 * The host owns the answers — intents, name, picks, the circle — locally, and
 * commits them to the store only at the end. Seven screens of half-answered
 * questions are not app state: they are a conversation, and a conversation that
 * you abandon should leave nothing behind. The two things that *can't* wait are
 * dispatched as they happen: which account you're getting (screen 0, because a
 * live account has to start signing in while you read screen 1) and, in the
 * demo, whether you keep its circle (screen 4).
 *
 * Deviations from the design are documented on the screens that make them —
 * WelcomeScreen on sign-in, StakeScreen on scope, NotificationsScreen on push.
 * The one made here is the circle step, below.
 */
import React, { useState } from 'react';
import { StatusBar, View } from 'react-native';
import { color } from '../theme/tokens';
import { CIRCLE_NAME, Category } from '../data/fixtures';
import { OnboardStake, useStore } from '../state/store';
import { Overlay } from './Overlay';
import { OnboardHeader } from './onboard/kit';
import { IntentId, SUGG, Suggestion, pool } from './onboard/data';
import { WelcomeScreen } from './onboard/WelcomeScreen';
import { IntentScreen } from './onboard/IntentScreen';
import { IdentityScreen } from './onboard/IdentityScreen';
import { StakeScreen } from './onboard/StakeScreen';
import { CircleScreen } from './onboard/CircleScreen';
import { NotificationsScreen } from './onboard/NotificationsScreen';
import { StakedScreen } from './onboard/StakedScreen';

/** Screens 0, 3 and 6 are dark; 1, 2, 4 and 5 are paper. */
const DARK_STEPS = [0, 3, 6];
const LAST_STEP = 6;

/**
 * The flow's suggestions carry points but no category, and the week is filed by
 * category — so the intent you picked them under supplies one. Nothing but the
 * label and the Me-screen breakdown depends on it; the points are the design's.
 */
const INTENT_CATEGORY: Record<IntentId, Category> = {
  move: 'Fitness',
  focus: 'Work',
  learn: 'Mind',
  health: 'Mind',
  create: 'Work',
  money: 'Home',
};

/** Suggestion id -> category, built once from the same table the screens read. */
const SUGGESTION_CATEGORY: Record<string, Category> = Object.fromEntries(
  (Object.keys(SUGG) as IntentId[]).flatMap((intent) =>
    SUGG[intent].map((s) => [s.id, INTENT_CATEGORY[intent]] as const),
  ),
);

/** Something you wrote yourself belongs to no intent, so it files as personal. */
const CUSTOM_CATEGORY: Category = 'Mind';

/**
 * There is no circle transport yet — the schema has `create_circle` and
 * `join_circle_by_code`, but the client has never called them, and wiring a
 * whole new sync surface is not this piece of work. Rather than accept a code
 * and quietly grant nothing, a live account is told the truth and offered the
 * door that does work.
 */
const CIRCLES_NOT_LIVE = 'Circles aren’t open on live accounts yet — ride solo, and bring people in once they are.';

type Flow = {
  step: number;
  intents: IntentId[];
  /**
   * The avatar and the handle preview read it as you type, and `FINISH_ONBOARD`
   * commits it: into the people directory always, and — on a live account — out
   * to `profiles.name` through the outbox, because it is what your circle sees
   * beside every task you close.
   */
  name: string;
  /** Suggestion ids, across both the offered rows and your own. */
  picks: string[];
  custom: Suggestion[];
  /** The circle you leave onboarding in, for screen 6's closing line. */
  circle: string | null;
};

const INITIAL_FLOW: Flow = {
  step: 0,
  intents: [],
  name: '',
  picks: [],
  custom: [],
  circle: null,
};

export function OnboardOverlay({
  topInset,
  bottomInset,
}: {
  topInset: number;
  bottomInset: number;
}) {
  const { state, dispatch, effectiveAudience } = useStore();
  const [flow, setFlow] = useState<Flow>(INITIAL_FLOW);
  const [trouble, setTrouble] = useState<string | null>(null);

  const { step } = flow;
  const dark = DARK_STEPS.includes(step);
  const patch = (next: Partial<Flow>) => setFlow((f) => ({ ...f, ...next }));
  const go = (to: number) => {
    setTrouble(null);
    patch({ step: to });
  };
  const next = () => go(step + 1);

  /**
   * Back steps, and only leaves at the front door. Routed through `Overlay`, so
   * this is also what hardware back and Escape do — without it a single back
   * press would skip the entire flow from wherever you'd got to.
   */
  const back = () => (step > 0 ? go(step - 1) : dispatch({ type: 'SKIP_ONBOARD' }));

  /**
   * The design's Skip advances one screen rather than leaving the flow, and it
   * offers it on exactly three: intents, circle, notifications — the three that
   * have a defensible default. Name and stake have none, which is why they
   * gate their own Continue instead.
   */
  const skippable = step === 1 || step === 4 || step === 5;

  const rows = pool(flow.intents, flow.custom);
  const picked = rows.filter((r) => flow.picks.includes(r.id));
  const stakeSum = picked.reduce((sum, r) => sum + r.pts, 0);

  const live = state.account === 'live';

  const finish = () => {
    const stakes: OnboardStake[] = picked.map((r) => ({
      title: r.title,
      cat: SUGGESTION_CATEGORY[r.id] ?? CUSTOM_CATEGORY,
      pts: r.pts,
    }));
    dispatch({ type: 'FINISH_ONBOARD', stakes, aud: effectiveAudience, name: flow.name });
  };

  /**
   * The local demo has exactly one circle, and you are already in it by the
   * time you reach this screen — so both doors open The Basement and the flow
   * reports the name it actually has rather than one you typed and would never
   * see again. Riding solo is the one answer that changes something: it drops
   * the demo circle, which is what makes screen 6's "solo for now" true.
   */
  const joinDemoCircle = () => {
    if (live) {
      setTrouble(CIRCLES_NOT_LIVE);
      return;
    }
    dispatch({ type: 'SET_ACCOUNT', mode: 'seeded' });
    patch({ circle: CIRCLE_NAME });
    next();
  };

  const rideSolo = () => {
    if (!live) dispatch({ type: 'SET_ACCOUNT', mode: 'fresh' });
    patch({ circle: null });
    next();
  };

  return (
    <Overlay
      zIndex={70}
      background={dark ? (step === 3 ? color.planBg : color.onboardBg) : color.paper}
      onRequestClose={back}
    >
      {/* The overlay covers the app's own StatusBar, and four of the seven
          screens are paper — so the bar is set from the step rather than from
          "onboarding is open". Last mounted wins, which is this one. */}
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />

      <View style={{ flex: 1, paddingTop: Math.max(topInset, 20), paddingBottom: bottomInset }}>
        <OnboardHeader
          step={step}
          dark={dark}
          onBack={back}
          onSkip={skippable ? next : undefined}
        />

        {step === 0 ? (
          <WelcomeScreen
            onStart={() => {
              // Anonymous sign-in is the provider's session effect, which fires
              // on the account flipping to live. Nothing to await here.
              dispatch({ type: 'SET_ACCOUNT', mode: 'live' });
              patch({ circle: null, step: step + 1 });
            }}
            onLookAround={() => {
              dispatch({ type: 'SET_ACCOUNT', mode: 'seeded' });
              // You are in The Basement from this tap — screen 4 can only
              // confirm it or undo it, so screen 6 knows the answer already.
              patch({ circle: CIRCLE_NAME, step: step + 1 });
            }}
          />
        ) : null}

        {step === 1 ? (
          <IntentScreen
            value={flow.intents}
            onChange={(intents) => patch({ intents })}
            onNext={next}
          />
        ) : null}

        {step === 2 ? (
          <IdentityScreen
            value={flow.name}
            onChange={(name) => patch({ name })}
            onNext={next}
            showHandle={!live}
          />
        ) : null}

        {step === 3 ? (
          <StakeScreen
            intents={flow.intents}
            picks={flow.picks}
            custom={flow.custom}
            onTogglePick={(id) =>
              patch({
                picks: flow.picks.includes(id)
                  ? flow.picks.filter((x) => x !== id)
                  : flow.picks.concat(id),
              })
            }
            // Anything you bothered to type is already chosen.
            onAddCustom={(s) => patch({ custom: [s, ...flow.custom], picks: flow.picks.concat(s.id) })}
            onNext={next}
          />
        ) : null}

        {step === 4 ? (
          <CircleScreen
            onJoin={joinDemoCircle}
            onCreate={joinDemoCircle}
            onSolo={rideSolo}
            error={trouble}
          />
        ) : null}

        {step === 5 ? (
          <NotificationsScreen
            stakeSum={stakeSum}
            hasPicks={picked.length > 0}
            weekNumber={state.week.number}
            onAllow={next}
            onLater={next}
          />
        ) : null}

        {step === LAST_STEP ? (
          <StakedScreen
            stakeSum={stakeSum}
            pickCount={picked.length}
            circle={flow.circle}
            weekNumber={state.week.number}
            onEnter={finish}
          />
        ) : null}
      </View>
    </Overlay>
  );
}
