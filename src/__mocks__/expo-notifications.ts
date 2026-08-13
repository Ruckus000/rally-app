/**
 * expo-notifications, as much of it as this app uses.
 *
 * A recording fake rather than a bag of stubs, for the reason the Supabase one
 * is: the interesting questions are *was anything scheduled*, *what did it say*
 * and *when for* — and a stub that returns undefined answers none of them while
 * still letting every test pass.
 *
 * It models the one piece of OS behaviour the code branches on: permission is
 * asked once. After a denial, `requestPermissionsAsync` resolves denied without
 * prompting again, which is what makes "ask on every launch" a bug rather than
 * a nuisance.
 */
export enum SchedulableTriggerInputTypes {
  DATE = 'date',
}

type Scheduled = {
  identifier: string;
  content: { title?: string; body?: string };
  trigger: { type: string; date: Date };
};

const state = {
  granted: false,
  asked: false,
  scheduled: [] as Scheduled[],
};

export const fakeNotifications = {
  reset(): void {
    state.granted = false;
    state.asked = false;
    state.scheduled = [];
  },
  /** What iOS would do if the user taps Allow when the prompt appears. */
  grantOnAsk(): void {
    state.granted = false;
    state.asked = false;
    grantNext = true;
  },
  /** Already granted before this run — the second launch. */
  alreadyGranted(): void {
    state.granted = true;
    state.asked = true;
  },
  scheduled: (): Scheduled[] => state.scheduled,
  /** How many times the OS prompt was actually raised. */
  prompts: (): number => promptCount,
};

let grantNext = false;
let promptCount = 0;

export async function getPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean }> {
  return { granted: state.granted, canAskAgain: !state.asked };
}

export async function requestPermissionsAsync(): Promise<{
  granted: boolean;
  canAskAgain: boolean;
}> {
  // Asked once. iOS resolves from the stored answer thereafter without showing
  // anything, so a caller that re-asks gets the same reply and no prompt.
  if (!state.asked) {
    promptCount += 1;
    state.asked = true;
    state.granted = grantNext;
  }
  return { granted: state.granted, canAskAgain: false };
}

export async function scheduleNotificationAsync(request: Scheduled): Promise<string> {
  state.scheduled = state.scheduled.filter((s) => s.identifier !== request.identifier);
  state.scheduled.push(request);
  return request.identifier;
}

export async function cancelScheduledNotificationAsync(identifier: string): Promise<void> {
  state.scheduled = state.scheduled.filter((s) => s.identifier !== identifier);
}

/** Reset the module-level flags too, which `fakeNotifications.reset` cannot reach. */
export function __resetForTests(): void {
  grantNext = false;
  promptCount = 0;
  fakeNotifications.reset();
}
