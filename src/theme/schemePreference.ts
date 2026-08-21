/**
 * Which palette you asked for, on disk.
 *
 * Three values — follow the phone, or pin light, or pin dark — under a key of
 * their own, `rally:scheme:v1`.
 *
 * ## Why this is not a corner of `state/persistence.ts`
 *
 * Because it is deliberately not part of that envelope, and a reader should not
 * have to work that out. `persistence.ts` writes one versioned blob and
 * **discards it whole on a version mismatch** rather than migrating — which is
 * right for a payload where a half-restored week would be worse than a fresh
 * one, and completely wrong for a display preference. A bump made for the shape
 * of `myTasks` has no business also forgetting that this phone is set to Dark,
 * and a preference sitting in that envelope is one line in `PERSISTED_KEYS`
 * away from being able to take the staked week with it.
 *
 * The same separation is what makes "reset app data does not change how your
 * phone renders" true by construction rather than by a rule somebody has to
 * remember: `RESET` and `SIGN_OUT` are reducer branches, the reducer is written
 * to `rally:state:v1`, and nothing in the app clears AsyncStorage wholesale.
 * This key is never touched by any of them.
 *
 * There is a second, harder reason. The provider that reads this sits *above*
 * the store — see `src/App.tsx` — because the boot screen is painted before the
 * app exists and would otherwise be the one surface the palette cannot reach.
 * A value the reducer owned would not be available to the thing that needs it.
 *
 * ## Neither function ever rejects
 *
 * `loadSchemePreference` answers `'system'` for absent, unreadable, corrupt or
 * unrecognised, and `saveSchemePreference` swallows a failed write the way
 * `persistence.write` does. Launching is not allowed to depend on a display
 * preference being readable: a rejected promise here would land in the same
 * gate that waits for fonts and persisted state, and the failure mode would be
 * an app that will not start because it could not find out what colour to be.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'rally:scheme:v1';

export type SchemePreference = 'system' | 'light' | 'dark';

/**
 * The whole of the stored vocabulary, and the thing `isPreference` checks
 * against — so adding a fourth value cannot be done without teaching the
 * validator about it.
 */
export const SCHEME_PREFERENCES: readonly SchemePreference[] = ['system', 'light', 'dark'];

/**
 * Stored as the bare word rather than as JSON. There is nothing to version:
 * one of three strings has no shape to get wrong, and anything that is not one
 * of them is treated as absent. That is what makes an unrecognised value —
 * a `'sepia'` written by some later build, or a truncated write — cost nothing
 * more than falling back to following the phone.
 */
const isPreference = (value: unknown): value is SchemePreference =>
  typeof value === 'string' && (SCHEME_PREFERENCES as readonly string[]).includes(value);

export async function loadSchemePreference(): Promise<SchemePreference> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return isPreference(raw) ? raw : 'system';
  } catch {
    // Storage unavailable. Following the phone is the honest answer, and it is
    // also the default anybody who never opened Settings already has.
    return 'system';
  }
}

export async function saveSchemePreference(preference: SchemePreference): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, preference);
  } catch {
    // Disk full, quota, whatever. The choice still took effect on screen this
    // launch — it just will not be there on the next one, which is a far
    // smaller thing than a crash on tapping Dark.
  }
}
