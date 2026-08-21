/**
 * The two claims in `crashLog` that nothing else pins down.
 *
 * `readCrashes` and `recordCrash` are exercised end to end through the
 * boundary in `components/__tests__/errorBoundary.test.tsx`, which is the
 * right place for them — they only matter as the thing that happens when a
 * render throws. What that suite cannot see is a stack shortened before it is
 * stored, or a log that stops growing, because both are invisible from one
 * crash. They get asserted here, against real strings rather than shapes.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { readCrashes, recordCrash, tidy } from '../crashLog';

/** Copied out of a release build on a simulator, not written by hand. */
const REAL_FRAME =
  'at Shell (/Users/x/rally-app/ios/build-release/Build/Products/Release-iphonesimulator/main.jsbundle:59016:20)';

describe('tidy', () => {
  it('keeps the bundle and the position, drops the path to it', () => {
    expect(tidy(REAL_FRAME)).toBe('at Shell (main.jsbundle:59016:20)');
  });

  it('leaves a frame that names no file alone', () => {
    // React writes these for host components it did not compile. There is
    // nothing to shorten and nothing to lose.
    const frame = 'at RNCSafeAreaProvider (<anonymous>)';
    expect(tidy(frame)).toBe(frame);
  });

  it('shortens every frame, which is the point', () => {
    const stack = [REAL_FRAME, REAL_FRAME.replace('Shell', 'StoreProvider')].join('\n');
    const out = tidy(stack);
    expect(out).toBe(
      'at Shell (main.jsbundle:59016:20)\nat StoreProvider (main.jsbundle:59016:20)',
    );
    // The whole reason for it: what reaches the screen is a fraction of what
    // arrived. Asserted as a ratio rather than a length so it does not need
    // editing when the fixture path changes.
    expect(out.length).toBeLessThan(stack.length / 3);
  });

  it('leaves a message that happens to contain a path where it is', () => {
    // Only a parenthesised `file:line:col` is a frame. A thrown message that
    // mentions a file is prose, and shortening prose would be editing what
    // somebody wrote.
    const message = 'ENOENT: no such file or directory /Users/x/week.json';
    expect(tidy(message)).toBe(message);
  });
});

describe('the log', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('stops growing, so a crash loop cannot fill the disk', async () => {
    for (let i = 0; i < 25; i++) {
      await recordCrash({ at: i, message: `crash ${i}` });
    }

    const kept = await readCrashes();
    expect(kept).toHaveLength(20);
    // The newest are the ones worth having: the oldest five went.
    expect(kept[0].message).toBe('crash 5');
    expect(kept[19].message).toBe('crash 24');
  });
});
