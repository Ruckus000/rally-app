// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

/**
 * A raw colour literal anywhere in `src/` outside `src/theme/`.
 *
 * `src/theme/tokens.ts` holds every design value and nothing else hardcodes
 * one — that has been the rule all along, and it was mostly kept. The dark-mode
 * migration is what makes it load-bearing: a colour written inline is a colour
 * the palette cannot swap, and it will be invisible in dark mode's ground
 * change rather than merely untidy. The migration runs across several PRs, so
 * without this the count grows underneath it.
 *
 * A warning, not an error, because there are existing violations and a PR that
 * fixes twenty unrelated hardcoded colours while also building the theme
 * mechanism is two PRs pretending to be one. It becomes an error in PR 6, once
 * the list is empty.
 */
const hex = 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]';
const rgb = 'Literal[value=/rgba?\\(/]';
const MESSAGE =
  'Raw colour literal. Add it to src/theme/tokens.ts and read it through useColors() — a colour written here is one the palette cannot swap.';

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    // `src/theme` is where colours are allowed to be literals — that is the
    // whole point of it. `src/theme/mark.ts` is generated, and is in there too.
    ignores: ['src/theme/**'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        { selector: hex, message: MESSAGE },
        { selector: rgb, message: MESSAGE },
      ],
    },
  },
]);
