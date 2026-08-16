/**
 * expo-device, which this app asks exactly one question of: is this a real
 * phone?
 *
 * It matters more than its size suggests. The iOS Simulator cannot receive
 * remote push at all, so `isDevice` is the difference between "no address
 * today" and storing an address nothing lives at — and since every device pass
 * in this project runs on simulators, the false branch is the one the tests
 * spend their time in.
 *
 * Defaults to true so a test has to opt *into* being a simulator, which is the
 * unusual case for the code under test even though it is the usual case here.
 */
export const isDevice = true;

const state = { isDevice: true };

export const fakeDevice = {
  reset(): void {
    state.isDevice = true;
  },
  /** What the iOS Simulator answers, and the reason push cannot be tested on one. */
  asSimulator(): void {
    state.isDevice = false;
  },
};

// A getter, because `isDevice` is read at call time and a plain export would
// freeze whatever the value was when the module first loaded.
Object.defineProperty(exports, 'isDevice', {
  get: () => state.isDevice,
  configurable: true,
});
