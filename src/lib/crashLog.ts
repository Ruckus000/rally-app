/**
 * What crashed, kept long enough to be read back.
 *
 * The app had no record of a render error at all: the tree unmounted, the
 * screen went white, and the only evidence was whatever the person holding the
 * phone remembered. For a week-long test on somebody else's device that is not
 * evidence, it is an anecdote.
 *
 * Deliberately small, and deliberately not a reporting service. This catches
 * what a React error boundary catches — a throw during render, in a lifecycle
 * method, or in a effect's synchronous body — and nothing else. A native crash
 * or a JS error that kills the process outright never reaches here, and no
 * amount of JavaScript would let it: the process is gone before a write could
 * finish. Those need a native reporter, which is a different decision and not
 * this one.
 *
 * ─── why this does not stamp `backend` ────────────────────────────────────
 *
 * `persistence` and `outbox` both write `projectRef()` into their envelope and
 * discard the file when it disagrees, because what they hold describes rows in
 * one particular project and is meaningless against another. A stack trace is
 * not about a project. Pointing the app at a different backend does not make
 * last Tuesday's crash untrue, and throwing it away at exactly the moment
 * somebody is changing environments would drop the traces most worth reading.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'rally:crashes:v1';
const VERSION = 1;

/**
 * Enough to see a pattern, few enough that the read stays cheap and the write
 * cannot grow without bound on a device that is crash-looping. Oldest go first.
 */
const MAX = 20;

export type Crash = {
  /** Wall clock. Only ever displayed, never compared against server time. */
  at: number;
  message: string;
  /** The JS stack, when the thrown value carried one. */
  stack?: string;
  /** React's own "which components were mounting" trace. Usually the useful half. */
  componentStack?: string;
};

type Envelope = { version: number; crashes: Crash[] };

const sound = (v: unknown): v is Crash =>
  !!v && typeof v === 'object' && typeof (v as Crash).message === 'string';

/**
 * Read what is on disk, tolerating everything.
 *
 * A crash log that throws while being read would turn one crash into two, and
 * the second one inside the boundary that exists to handle the first. Every
 * failure here answers "nothing recorded" instead.
 */
export async function readCrashes(): Promise<Crash[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const envelope = JSON.parse(raw) as Partial<Envelope>;
    if (envelope?.version !== VERSION) return [];
    return (Array.isArray(envelope.crashes) ? envelope.crashes : []).filter(sound);
  } catch {
    return [];
  }
}

/**
 * Append one, newest last.
 *
 * Swallows its own failures for the same reason `write` in `persistence` does:
 * the app is already showing somebody a failure, and a disk that is full must
 * not turn that into a second one on top.
 */
export async function recordCrash(crash: Crash): Promise<void> {
  try {
    const crashes = [...(await readCrashes()), crash].slice(-MAX);
    await AsyncStorage.setItem(KEY, JSON.stringify({ version: VERSION, crashes }));
  } catch {
    // Nothing to do that is better than carrying on.
  }
}

/** Called from nowhere in the app yet — the seam a "clear diagnostics" would use. */
export async function clearCrashes(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Same reasoning as above.
  }
}

/**
 * Drop the part of a stack frame that is identical on every other frame.
 *
 * Metro stamps each frame with the absolute path of the bundle it was built
 * from: ninety characters of `/Users/…/main.jsbundle` on a simulator, and a
 * container UUID of much the same length on a device. It is the same string on
 * every line, and it is the one part that locates nothing — what says *where*
 * is the `line:col` sitting right behind it.
 *
 * Left in, it costs four lines per frame, so four frames fill the box on the
 * crash screen and three quarters of what is on it is one path repeated. That
 * is expensive on the one screen whose whole argument is that a photograph of
 * it is worth sending to somebody.
 *
 * The basename stays — `main.jsbundle:59016:20` still says which bundle, which
 * matters the day there is more than one. A frame carrying no path at all
 * (`at RNCSafeAreaProvider (<anonymous>)`) is left exactly as it was.
 */
export function tidy(stack: string): string {
  return stack.replace(/\(([^()]*\/)([^()/]+:\d+:\d+)\)/g, '($2)');
}

/** Turn whatever was thrown into something with a message. */
export function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message || error.name,
      stack: error.stack ? tidy(error.stack) : undefined,
    };
  }
  return { message: typeof error === 'string' ? error : JSON.stringify(error) };
}
