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
import { useTheme } from '../theme/ThemeProvider';
import { CIRCLE_NAME, Category } from '../data/fixtures';
import { OnboardStake, useStore } from '../state/store';
import { Overlay } from './Overlay';
import { createCircle, joinCircleByCode, UnknownInviteCode } from '../sync/transport';
import { signInWithApple, signOutEverywhere } from '../sync/session';
import { appleTrouble } from '../lib/appleCopy';
import { attemptCancelDeletion, deletionDateLine } from './settings/deleteAccount';
import { kickSync } from '../sync/useSyncEngine';
import { queueProfileName } from '../sync/engine';
import { enableReminders } from '../lib/enableReminders';
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
  const { colors: color, scheme } = useTheme();
  const { state, dispatch, effectiveAudience } = useStore();
  const [flow, setFlow] = useState<Flow>(INITIAL_FLOW);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { step } = flow;
  /**
   * "This step is drawn on an intentionally dark ground" — a fact about the
   * step, not about the palette. Named `dark` until the dark scheme existed to
   * be confused with; `darkStep` beside `scheme === 'dark'` below says which
   * question each is answering.
   */
  const darkStep = DARK_STEPS.includes(step);
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
   * The button now does what it says, and both previews on this screen are
   * real: the Monday reminder is a local notification scheduled on the device,
   * and the cheer above it is a remote push, which is why the token is
   * registered here too.
   *
   * One permission grant, two consequences, and this is the only moment the
   * answer is known — `getPushToken` returns null without it, so registering
   * anywhere else would quietly do nothing.
   *
   * The flow continues either way: someone who declines has still finished
   * onboarding, and stopping to argue about it would be worse than the silence
   * they just chose.
   */
  const allowReminders = () => {
    // The pair moved to `lib/enableReminders` when Settings grew a second door
    // onto the same question. Same two consequences, same order, one copy.
    void enableReminders(state.week.number, stakeSum);
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

  /**
   * Sign back into an account that already exists, and leave the flow at once.
   *
   * The order is the load-bearing part. Apple **first**, while the account is
   * still not `live`: flipping to live starts the provider's session effect,
   * which signs in anonymously, and that would mint a throwaway user and a
   * `profiles` row before the real session replaced it. Signed in first, that
   * effect finds `ensureSession` already `ready` and does nothing.
   *
   * Then `SKIP_ONBOARD` rather than walking the remaining screens. Somebody
   * recovering has a name, a circle and a week already on the server; asking
   * them to invent them again would be the flow overwriting the thing it just
   * went to the trouble of getting back. `SKIP_ONBOARD` keeps the account it
   * finds and lands on the feed, and the pull fills the rest in.
   */
  /**
   * Stay, from the screen a scheduled deletion leaves you on.
   *
   * Spends the session `endSessionLocally` deliberately left on disk, which is
   * why this needs no provider and works on Android — where nothing else could
   * bring an account back.
   */
  const keepAccount = async () => {
    setBusy(true);
    setTrouble(null);
    try {
      if (!(await attemptCancelDeletion())) {
        setTrouble('That didn’t reach the server. Your account is still here — try again.');
        return;
      }
      dispatch({ type: 'DELETION_CANCELLED' });
      dispatch({ type: 'SET_ACCOUNT', mode: 'live' });
      dispatch({ type: 'SKIP_ONBOARD' });
    } finally {
      setBusy(false);
    }
  };

  /**
   * "Get started" while a deletion is pending: a new account, not the old one.
   *
   * The sign-out is the whole of it, and without it this button is a trapdoor
   * back into the account being deleted. `endSessionLocally` left a valid
   * session on disk, and `resolveSession` prefers a stored session to signing
   * in — so the anonymous sign-in this flow expects would never happen, and
   * somebody who chose to walk away would land back in the week they had just
   * asked to destroy.
   *
   * The old account is left scheduled. Walking away from it is not cancelling
   * it, and the purge will take it on the day it was always going to.
   */
  const startFresh = async () => {
    setBusy(true);
    try {
      await signOutEverywhere();
      dispatch({ type: 'DELETION_CANCELLED' });
      dispatch({ type: 'SET_ACCOUNT', mode: 'live' });
      patch({ circle: null, joined: false, step: 1 });
    } finally {
      setBusy(false);
    }
  };

  const recoverWithApple = async () => {
    setBusy(true);
    setTrouble(null);
    try {
      const result = await signInWithApple();
      if (!result.ok) {
        // A dismissed sheet says nothing at all — the person changed their mind
        // and does not need telling. Everything else gets one line.
        if (result.reason !== 'cancelled') setTrouble(appleTrouble(result.reason));
        return;
      }
      // Signing back in is a decision to stay, so it takes back a scheduled
      // deletion. Called unconditionally rather than gated on `deletionAt`,
      // because the local marker only exists on the device that scheduled it —
      // recovering on a *second* phone has no marker to check, and that is
      // exactly the case where somebody would be most surprised to find the
      // account they just signed into disappear a week later. The RPC is a
      // no-op when nothing is scheduled, which is what makes that free.
      await attemptCancelDeletion();
      dispatch({ type: 'DELETION_CANCELLED' });
      dispatch({ type: 'SET_ACCOUNT', mode: 'live' });
      dispatch({ type: 'SKIP_ONBOARD' });
      // No `kickSync()` here, though the shape of the other flows invites one.
      // It would do nothing: `active` is set by the sync engine's effect, which
      // has not run yet — `state.account` is still not `live` this render, so
      // `syncOn` is false. The first pull comes from that effect's own
      // `start()`, once. A call here would read like the thing that fetches the
      // recovered week, and would not be it.
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
      background={darkStep ? (step === 3 ? color.planBg : color.onboardBg) : color.paper}
      onRequestClose={back}
    >
      {/* The overlay covers the app's own StatusBar, and four of the seven
          screens are paper — so the bar is set from the step rather than from
          "onboarding is open". Last mounted wins, which is this one.

          Two reasons for light glyphs, same as the shell: the step is one of
          the three drawn dark, or the whole scheme is. Those four paper steps
          are only paper in the light scheme; in the dark one they are `paper`
          at #070A06 and `dark-content` would erase the clock. */}
      <StatusBar barStyle={darkStep || scheme === 'dark' ? 'light-content' : 'dark-content'} />

      <View style={{ flex: 1, paddingTop: Math.max(topInset, 20), paddingBottom: bottomInset }}>
        <OnboardHeader
          step={step}
          dark={darkStep}
          onBack={back}
          onSkip={skippable ? next : undefined}
        />

        {step === 0 ? (
          <WelcomeScreen
            busy={busy}
            trouble={trouble}
            onApple={() => void recoverWithApple()}
            deletionOn={state.deletionAt ? deletionDateLine(state.deletionAt) : null}
            onKeep={state.deletionAt ? () => void keepAccount() : undefined}
            onStart={() => {
              if (state.deletionAt) {
                // A session is still on disk and would be preferred to a fresh
                // anonymous one. See `startFresh`.
                void startFresh();
                return;
              }
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
