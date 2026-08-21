/**
 * The palette, made swappable — and, for now, deliberately not swapped.
 *
 * Rally has one palette today and this file changes none of its values. What
 * it changes is *how a component gets them*: from an import that is fixed at
 * module load, to a context read that can be answered differently later. That
 * is the whole of this PR. If anything on screen looks different, the change
 * is wrong.
 *
 * ## Why context and not a mutable module object
 *
 * The tempting version — keep one `color` object and reassign its fields at
 * launch — looks like zero work and is a trap. Module scope captures values:
 * `SettingsOverlay`'s `cardBox` and `LedgerOverlay`'s `closeButton` are style
 * objects built once, at import, from whatever `color` held at that instant.
 * They would freeze the palette that happened to be active when the module
 * first loaded, and stay frozen. The bug never shows on a cold start in a
 * single scheme; it shows the first time somebody toggles the theme, which is
 * the worst possible moment to discover it. Context re-renders. That is the
 * entire argument.
 *
 * ## `dark` resolves to a dark palette now
 *
 * For five PRs it did not: the palette was designed but not built, and half of
 * one invented inside a mechanism PR is how a PR that promises to change no
 * pixels starts changing pixels. 6d built it. Both `theme.test.tsx` and
 * `themeStructures.test.tsx` turned over with it — what they pin now is that
 * the two palettes differ, that they carry the identical key set, and that the
 * six tokens the emphasis grammar rests on are the same in both.
 *
 * ## Why the context value is an object rather than the colour map
 *
 * `yearLevelColor`, `personTints`, `hairlineGradient` and `shadows` all carry
 * colour and all had to become theme-dependent eventually. The cheque this
 * paragraph wrote in PR 1 is cashed: they are fields on `Theme` now, they
 * arrived as extra fields plus extra hooks, and **not one already-migrated
 * `useColors()` call site had to be touched a second time.** Had the context
 * value been the bare colour map, adding them would have meant editing every
 * one of the ~470 reads again.
 *
 * `onDark` and `onLight` are not here, and for a different reason: the dark
 * design keeps every already-dark surface exactly as it is, so those ramps are
 * scheme-independent by construction. They stay plain imports.
 *
 * ## Which of the five gets its own hook
 *
 * One rule, applied without exception: **a structure read in more than one
 * file gets a named hook; a structure with a single consumer is read off
 * `useTheme()`.** A hook earns its name when it saves repetition across files
 * and gives "who reads this" a single grep; for a structure one component
 * touches, `useTheme().hairlineGradient` says more at the call site than a
 * `useHairlineGradient()` would, and there is nothing extra to import.
 *
 * So: `useColors()` (~470 reads), `useShadows()` (31 reads across 12 files)
 * and `usePersonTints()` (4 files) are hooks. `hairlineGradient` — only
 * `GradientHairline` in `primitives.tsx` — and `yearLevelColor` — only
 * `YearGrid` in `MeScreen.tsx` — come off `useTheme()`. If either grows a
 * second consumer the rule says promote it, and that is a two-line change.
 *
 * ## The two awkward shapes, settled here so the next four PRs do not re-argue
 *
 * Most of the ~470 reads are `color.x` inside a component body, and those are
 * a one-line change. Two shapes are not, and both are settled — in code, not
 * only in prose, because a convention nobody has compiled is a convention
 * nobody has tested.
 *
 * **1. A module-level style object that reads the palette.** `SettingsOverlay`
 * has `cardBox`, `LedgerOverlay` has `closeButton`, and there are more. These
 * become a **function of the palette, keeping their name**:
 *
 * ```ts
 * const cardBox = (color: Palette): ViewStyle => ({ backgroundColor: color.card, … });
 * // call site: style={{ ...row, gap: 12, ...cardBox(color) }}
 * ```
 *
 * The alternative — move the object inside the component — only works when
 * exactly one component uses it, and `cardBox` has six call sites across five
 * components. Threading it as a prop or duplicating it per component would be
 * a real refactor hiding inside a mechanical one. A factory keeps the object a
 * single named thing at module scope, keeps it greppable, and keeps each call
 * site's diff to adding `(color)`. It does allocate a fresh object per render,
 * but these are inline style objects that React Native already rebuilds every
 * render, so nothing regresses.
 *
 * `LedgerOverlay`'s `closeButton` is converted this way here, as the worked
 * example. It is deliberately one whose three call sites — `LedgerOverlay`,
 * `NotificationsOverlay`, `SettingsOverlay` — are all in files that have *not*
 * been migrated and still pass the static `color` import. That is the state
 * every PR between this one and the last lives in, and it type-checks and
 * renders identically, which is the thing worth proving.
 *
 * **2. A default parameter that reads the palette.** `primitives.tsx` had
 * `color: c = color.ink` on `Bri`, `Sans` and `Caps`. You cannot call a hook
 * in a parameter default, so the default **moves into the body with `??`**,
 * and the parameter keeps its name:
 *
 * ```ts
 * export function Bri({ color: c, … }: TypeProps) {
 *   const colors = useColors();
 *   // … color: c ?? colors.ink
 * ```
 *
 * `??` and not `||`: a parameter default fires only on `undefined`, and `||`
 * would also swallow an empty string. That is a behaviour change, and this
 * migration is not allowed one.
 *
 * ## What to call the hook's result
 *
 * `const color = useColors()` — shadowing the old import name on purpose, so
 * the body of a migrated file is byte-identical to what it was and the diff is
 * the import plus one line. That is what makes 470 reads reviewable. Where the
 * name `color` is already taken in that scope — `primitives.tsx` has a `color`
 * prop — use `colors`.
 *
 * ## The override (6e), and why the preference is state in here
 *
 * Three inputs decide the scheme, and they are ranked rather than merged:
 *
 *  1. the `scheme` prop — a hard override. Tests use it, and it still beats
 *     everything, which is what keeps every existing render-in-a-scheme test
 *     saying what it said.
 *  2. the stored preference, when it is `'light'` or `'dark'`.
 *  3. `useColorScheme()`, when the preference is `'system'`.
 *
 * The preference is *state here* rather than a value threaded down from the
 * entry file, because the setter has to repaint. The provider is the highest
 * thing in the tree and the only one that can hand a new palette to everything
 * below it in one go; a preference owned further up and passed down would work
 * too, but then the entry file — whose entire job is fonts and splash timing —
 * would own a piece of app state that only this file understands.
 *
 * It cannot live in the reducer for a harder reason: this provider sits *above*
 * `StoreProvider` so that the boot screen is covered, so there is no store to
 * read at the moment it is needed. See the note in `src/App.tsx`.
 *
 * **`setPreference` persists as well as repaints.** Both, always, in one call.
 * A control that changes the look and forgets it by the next launch is the
 * exact bug this is for, and it is not the call site's job to remember the
 * second half.
 *
 * The value arriving from disk is a *prop*, and the in-session choice is state
 * layered over it (`chosen ?? preference ?? 'system'`). That ordering is
 * load-bearing: this provider mounts on the first frame, before the read off
 * disk has resolved, so the prop is `undefined` and then becomes a real value
 * a few milliseconds later. `useState(initial)` would have captured the
 * `undefined` and never seen the answer.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import { SchemePreference, saveSchemePreference } from './schemePreference';
import {
  darkColors,
  darkHairlineGradient,
  darkPersonTints,
  darkShadows,
  darkYearLevelColor,
  hairlineGradient,
  HairlineGradient,
  lightColors,
  Palette,
  personTints,
  PersonTints,
  shadows,
  Shadows,
  yearLevelColor,
  YearLevelColor,
} from './tokens';

/**
 * Re-exported so a consumer needing one of these as a *type* — a factory
 * taking what it reads, in the convention below — has one import to reach for
 * rather than two. All five live in `tokens`, beside the values they describe.
 */
export type { HairlineGradient, Palette, PersonTints, Shadows, YearLevelColor };

/**
 * Re-exported for the same reason: a component reading `useSchemePreference()`
 * needs the union to type its own handlers, and one import is better than two.
 * The storage lives in `schemePreference.ts`, which is where the argument for
 * its separate key lives too.
 */
export type { SchemePreference };

export type Scheme = 'light' | 'dark';

/**
 * What the context carries: everything in the app that is a colour and could
 * have to differ between schemes.
 *
 * Five fields and, for now, no sixth — anything else carrying colour is either
 * already in here or is scheme-independent on purpose (`onDark`, `onLight`,
 * `heroGlow`, and the handful of literals 6a named).
 */
export type Theme = {
  scheme: Scheme;
  colors: Palette;
  shadows: Shadows;
  personTints: PersonTints;
  hairlineGradient: HairlineGradient;
  yearLevelColor: YearLevelColor;
};

const lightTheme: Theme = {
  scheme: 'light',
  colors: lightColors,
  shadows,
  personTints,
  hairlineGradient,
  yearLevelColor,
};

/**
 * Dark, at last holding a palette of its own.
 *
 * Five fields, and only `scheme` is shared with the light theme — but a great
 * deal *inside* those objects is deliberately identical. `ink`, `planBg`,
 * `planCard`, `onboardBg`, `tabbar` and `lime` are byte-for-byte what they are
 * on paper, because the surfaces they name were already dark and the accent was
 * never a function of the ground. `darkShadows` and `darkHairlineGradient` are
 * spreads of their light counterparts for the same reason: most of what they
 * carry sits on a surface that does not move.
 *
 * `theme.test.tsx` pins those invariants, so a later hand that "finishes" the
 * dark palette by giving `lime` a dark variant finds out immediately.
 */
const darkTheme: Theme = {
  scheme: 'dark',
  colors: darkColors,
  shadows: darkShadows,
  personTints: darkPersonTints,
  hairlineGradient: darkHairlineGradient,
  yearLevelColor: darkYearLevelColor,
};

/**
 * Defaulting to the light theme rather than `null` is what lets a component
 * be rendered in a test without the provider. Dozens of existing tests mount a
 * screen directly; a hook that threw outside a provider would turn a
 * mechanism change into a suite-wide edit, which is exactly the blast radius
 * this sequence of PRs exists to avoid.
 */
const ThemeContext = createContext<Theme>(lightTheme);

/** What the Settings control reads and writes. */
export type SchemePreferenceControl = {
  preference: SchemePreference;
  setPreference: (preference: SchemePreference) => void;
};

/**
 * Separate from `ThemeContext` on purpose. Nearly every component in the app
 * reads the theme and re-renders when it changes; exactly one reads the
 * preference, and folding the setter into the theme value would put a function
 * identity into the thing ~470 call sites subscribe to.
 *
 * Its default is inert rather than throwing, for the same reason the theme
 * defaults to light: a component rendered without a provider — which is most of
 * this suite — must not blow up. A radio group under the default shows System
 * selected and does nothing when tapped, which is exactly what "no provider
 * above me" means.
 */
const PreferenceContext = createContext<SchemePreferenceControl>({
  preference: 'system',
  setPreference: () => {},
});

/**
 * Hand the chosen scheme to the platform, so the surfaces this app does not
 * draw follow it too.
 *
 * `Alert.alert`, the image picker and the Apple sign-in sheet are drawn by iOS,
 * not by React, and they answer to the window's interface style rather than to
 * anything in `tokens.ts`. Without this, pinning Dark on a light phone gets you
 * a white system alert over a near-black app — the one seam a palette alone
 * cannot close.
 *
 * `'unspecified'` is how the override is *released*; there is no `null` in this
 * API. Releasing it matters more than setting it: `setColorScheme('dark')` also
 * changes what `getColorScheme()` reports, so a preference of 'system' that
 * never cleared a previous override would keep resolving to that override
 * forever, and the phone's own setting would stop reaching the app.
 *
 * Under jest there is no native module behind this and the call is a no-op,
 * which is why the tests spy on it rather than observing its effect.
 */
const applyToNativeSurfaces = (preference: SchemePreference): void => {
  Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
};

export function ThemeProvider({
  scheme,
  preference,
  children,
}: {
  /**
   * Force a scheme, above everything else. Tests use it. It is not how the
   * Settings override arrives — that is `preference`, below — because a hard
   * override cannot be changed from inside the tree, and the whole point of the
   * control is that it can.
   */
  scheme?: Scheme;
  /**
   * The preference as it was read off disk, or `undefined` while that read is
   * still in flight. Only the initial value: once somebody chooses in Settings,
   * their choice wins for the rest of the session and is written back.
   */
  preference?: SchemePreference;
  children: React.ReactNode;
}) {
  const system = useColorScheme();
  const [chosen, setChosen] = useState<SchemePreference | null>(null);
  const current = chosen ?? preference ?? 'system';

  // One call, three effects: repaint now, tell the platform, and be this way
  // next launch. Split across separate calls at the call site, one of them
  // would eventually be forgotten — and the one that gets forgotten is always
  // the durable half, because the app looks right without it.
  //
  // The platform call goes *before* `setChosen`, and that ordering is not
  // stylistic. `setColorScheme` updates what `getColorScheme()` reports but
  // deliberately emits no change event, so `useColorScheme()` only picks the
  // new value up on its next render. Do it in an effect instead and switching
  // Dark → System renders once against the stale override — resolving dark,
  // on a light phone — and then nothing re-renders to correct it, because
  // nothing was emitted. Setting it first means the render that reacts to
  // `setChosen` already reads the released value.
  const setPreference = useCallback((next: SchemePreference) => {
    applyToNativeSurfaces(next);
    setChosen(next);
    void saveSchemePreference(next);
  }, []);

  // The other way in: a preference that was on disk at launch arrives as a prop
  // some milliseconds after this mounts, and never passes through the setter.
  // Idempotent, so it costs nothing when the setter got there first.
  useEffect(() => {
    applyToNativeSurfaces(current);
  }, [current]);

  // `useColorScheme()` is `'light' | 'dark' | null` — null on a platform that
  // has not told us yet, which is light as far as this app is concerned. It is
  // subscribed to unconditionally, not just when the preference is 'system':
  // a hook cannot be called conditionally, and flipping the phone's appearance
  // has to keep re-rendering this tree the way it does today.
  const fromDevice: Scheme = system === 'dark' ? 'dark' : 'light';
  const resolved: Scheme = scheme ?? (current === 'system' ? fromDevice : current);
  const value = useMemo(() => (resolved === 'dark' ? darkTheme : lightTheme), [resolved]);

  const control = useMemo<SchemePreferenceControl>(
    () => ({ preference: current, setPreference }),
    [current, setPreference],
  );

  return (
    <PreferenceContext.Provider value={control}>
      <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
    </PreferenceContext.Provider>
  );
}

/**
 * The Settings control's half of this file: what you asked for, and how to ask
 * for something else.
 *
 * Deliberately *not* `useTheme().scheme`. That answers what is on screen, which
 * under `'system'` is a fact about the phone; this answers what you chose,
 * which is the only thing a radio group can honestly tick.
 */
export function useSchemePreference(): SchemePreferenceControl {
  return useContext(PreferenceContext);
}

/** The whole theme, for the rare caller that needs to know which scheme it is. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** The colours. This is the one nearly every component wants. */
export function useColors(): Palette {
  return useContext(ThemeContext).colors;
}

/**
 * The drop shadows. Named because 31 reads across 12 files is well past the
 * point where spelling `useTheme().shadows` at each of them is the shorter
 * thing.
 *
 * Call the result `shadows`, shadowing the old import name, for the same
 * reason `useColors()` is called `color`: everything below the hook stays
 * byte-identical and the diff is the import plus one line.
 */
export function useShadows(): Shadows {
  return useContext(ThemeContext).shadows;
}

/**
 * The avatar palette. Four files resolve a person's tint *index* against it —
 * `Avatar`, `CircleScreen`, `DetailSheet`, and onboarding's `IdentityScreen`.
 * `data/people.ts` is deliberately not one of them: it hands out the index and
 * has no idea what colour that is.
 */
export function usePersonTints(): PersonTints {
  return useContext(ThemeContext).personTints;
}

/**
 * The iOS keyboard, which is the one surface this app puts on screen without
 * drawing it.
 *
 * No `TextInput` in the app set `keyboardAppearance`, so every field got
 * `UIKeyboardAppearanceDefault`. Under a dark sheet that is a light slab across
 * the bottom half of the screen — brighter than anything the palette is allowed
 * to draw, and the only part of a dark app that stayed light.
 *
 * It follows the **scheme**, not the surface the field sits on. The keyboard is
 * not *on* the sheet, it is in front of it, and half the fields in this app
 * already sit on grounds that are dark in both schemes — `planCard`, the ink
 * profile card, the onboarding stake screen. Keying off those would give a
 * light-mode user a dark keyboard on three screens and a light one everywhere
 * else, which is a second theme nobody asked for.
 *
 * `Scheme` is `'light' | 'dark'`, which is exactly `KeyboardAppearance` minus
 * `'default'` — so the scheme *is* the answer and there is nothing to map. In
 * the light scheme `'light'` is what `'default'` was already resolving to, so
 * nothing about light mode changes.
 *
 * Android has no equivalent and ignores the prop; its keyboard follows the OS.
 *
 * A named hook rather than `useTheme().scheme` at each site, by the rule above:
 * ten reads across eight files, and one grep for who has been given a keyboard.
 */
export function useKeyboardAppearance(): Scheme {
  return useContext(ThemeContext).scheme;
}
