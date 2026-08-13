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
 *
 * Screen 4 is the one place this host does real I/O: creating or joining a
 * circle is a server call whose answer the flow has to wait for. See
 * `runCircleCall` on why those two alone are not queued like everything else.
 */
import React, { useState } from 'react';
import { StatusBar, View } from 'react-native';
import { color } from '../theme/tokens';
import { CIRCLE_NAME, Category } from '../data/fixtures';
import { OnboardStake, useStore } from '../state/store';
import { Overlay } from './Overlay';
import { createCircle, joinCircleByCode, UnknownInviteCode } from '../sync/transport';
import { kickSync } from '../sync/useSyncEngine';
import { queueProfileName } from '../sync/engine';
import { askForReminders, scheduleWeekReminder } from '../lib/reminders';
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
  /**
   * The circle you leave onboarding in, for screen 6's closing line: its name
   * when we have one, and whether you are in one at all. Two fields because
   * joining by code gives you the second without the first.
   */
  circle: string | null;
  joined: boolean;
};

const INITIAL_FLOW: Flow = {
  step: 0,
  intents: [],
  name: '',
  picks: [],
  custom: [],
  circle: null,
  joined: false,
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
  const [busy, setBusy] = useState(false);

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
    // Queued in the same tick as the dispatch, not on the next observation: a
    // pull is very likely in flight right now — creating a circle two screens
    // ago kicked one — and a merge that lands before the queue hears about the
    // name overwrites it with the placeholder the signup trigger wrote.
    if (live) queueProfileName(flow.name);
  };

  /**
   * The local demo has exactly one circle, and you are already in it by the
   * time you reach this screen — so both doors open The Basement and the flow
   * reports the name it actually has rather than one you typed and would never
   * see again. Riding solo is the one answer that changes something: it drops
   * the demo circle, which is what makes screen 6's "solo for now" true.
   */
  const joinDemoCircle = () => {
    dispatch({ type: 'SET_ACCOUNT', mode: 'seeded' });
    patch({ circle: CIRCLE_NAME, joined: true });
    next();
  };

  /**
   * The button now does what it says. It cannot promise the cheer above it —
   * that needs remote push and a paid Apple programme — but the second preview
   * on this screen is a Monday reminder, which is a *local* notification and
   * needs neither.
   *
   * The flow continues either way: someone who declines has still finished
   * onboarding, and stopping to argue about it would be worse than the silence
   * they just chose.
   */
  const allowReminders = () => {
    void askForReminders().then((answer) => {
      if (answer === 'granted') {
        return scheduleWeekReminder(state.week.number, stakeSum);
      }
      return undefined;
    });
    next();
  };

  const rideSolo = () => {
    if (!live) dispatch({ type: 'SET_ACCOUNT', mode: 'fresh' });
    patch({ circle: null, joined: false });
    next();
  };

  /**
   * The live pair. Unlike everything else this flow dispatches, these wait: the
   * server owns the answer — whether the code names a circle at all — and a
   * queued join would mean saying "you're in" and finding out later that you
   * never were. So the card holds, and a refusal lands on the screen that asked.
   */
  const runCircleCall = async (call: () => Promise<string | null>) => {
    setBusy(true);
    setTrouble(null);
    try {
      patch({ circle: await call(), joined: true });
      // The member list is a pull away, and the next scheduled one is a minute
      // out — long enough to reach the Circle tab and find it empty.
      kickSync();
      next();
    } catch (err) {
      setTrouble(
        err instanceof UnknownInviteCode
          ? err.message
          : 'Couldn’t reach Rally just now. Try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  };

  const joinLiveCircle = (code: string) =>
    void runCircleCall(async () => {
      await joinCircleByCode(code.trim());
      // No name: the RPC answers with a uuid. `kickSync` above means the pull
      // that fills `state.circle` is already on its way, and screen 6 prefers
      // it — so the name appears without a round trip of its own, and the copy
      // reads correctly in the moment before it lands.
      return null;
    });

  const createLiveCircle = (name: string) =>
    void runCircleCall(async () => {
      await createCircle(name.trim());
      return name.trim();
    });

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
              patch({ circle: null, joined: false, step: step + 1 });
            }}
            onLookAround={() => {
              dispatch({ type: 'SET_ACCOUNT', mode: 'seeded' });
              // You are in The Basement from this tap — screen 4 can only
              // confirm it or undo it, so screen 6 knows the answer already.
              patch({ circle: CIRCLE_NAME, joined: true, step: step + 1 });
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
            onJoin={live ? joinLiveCircle : joinDemoCircle}
            onCreate={live ? createLiveCircle : joinDemoCircle}
            onSolo={rideSolo}
            busy={busy}
            error={trouble}
          />
        ) : null}

        {step === 5 ? (
          <NotificationsScreen
            stakeSum={stakeSum}
            hasPicks={picked.length > 0}
            weekNumber={state.week.number}
            onAllow={allowReminders}
            onLater={next}
          />
        ) : null}

        {step === LAST_STEP ? (
          <StakedScreen
            stakeSum={stakeSum}
            pickCount={picked.length}
            circle={state.circle?.name ?? flow.circle}
            joined={flow.joined}
            weekNumber={state.week.number}
            onEnter={finish}
          />
        ) : null}
      </View>
    </Overlay>
  );
}
