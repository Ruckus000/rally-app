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
 * ## Why `dark` resolves to the light palette here
 *
 * There is no dark palette yet — it is designed (see the spec) but not built,
 * and half of it invented in a mechanism PR is how a PR that promises to
 * change no pixels starts changing pixels. So both schemes resolve to
 * `lightColors`, and the tests pin that down rather than leaving it as a
 * comment somebody trusts.
 *
 * ## Why the context value is an object rather than the colour map
 *
 * `yearLevelColor`, `personTints` and `hairlineGradient` all carry colour and
 * all have to become theme-dependent eventually — `personTints` in particular
 * needs real design thought, not a token swap. They are **deliberately not
 * moved in this PR**. But the context holds a `Theme` object with a named
 * `colors` field, so when they join they become extra fields on that object
 * and extra hooks beside `useColors()`. Nothing that has already been migrated
 * has to be migrated a second time. Had the context value been the bare colour
 * map, adding them later would mean touching every call site again.
 *
 * `onDark` is not here either, and for a different reason: the dark design
 * keeps every already-dark surface exactly as it is, so the `onDark` ramp is
 * scheme-independent by construction. It can stay a plain import.
 */
import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { lightColors } from './tokens';

export type Scheme = 'light' | 'dark';

/** The colour map a component reads. One shape, whichever scheme is active. */
export type Palette = typeof lightColors;

/**
 * What the context carries. `colors` today; `yearLevelColor`, `personTints`
 * and `hairlineGradient` land beside it in a later PR without a second
 * migration — see the note above.
 */
export type Theme = {
  scheme: Scheme;
  colors: Palette;
};

const lightTheme: Theme = { scheme: 'light', colors: lightColors };

/**
 * Dark, holding the light palette. Not an oversight and not a placeholder to
 * be filled in casually: the palette swap is PR 6, and the test suite asserts
 * this is still value-identical to `color` until then.
 */
const darkTheme: Theme = { scheme: 'dark', colors: lightColors };

/**
 * Defaulting to the light theme rather than `null` is what lets a component
 * be rendered in a test without the provider. Dozens of existing tests mount a
 * screen directly; a hook that threw outside a provider would turn a
 * mechanism change into a suite-wide edit, which is exactly the blast radius
 * this sequence of PRs exists to avoid.
 */
const ThemeContext = createContext<Theme>(lightTheme);

export function ThemeProvider({
  scheme,
  children,
}: {
  /**
   * Force a scheme. Tests use it; the Settings override will use it once that
   * exists. Absent, the device decides.
   */
  scheme?: Scheme;
  children: React.ReactNode;
}) {
  const system = useColorScheme();
  // `useColorScheme()` is `'light' | 'dark' | null` — null on a platform that
  // has not told us yet, which is light as far as this app is concerned.
  const resolved: Scheme = scheme ?? (system === 'dark' ? 'dark' : 'light');
  const value = useMemo(() => (resolved === 'dark' ? darkTheme : lightTheme), [resolved]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The whole theme, for the rare caller that needs to know which scheme it is. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** The colours. This is the one nearly every component wants. */
export function useColors(): Palette {
  return useContext(ThemeContext).colors;
}
