/**
 * The one dependency claim that a developer machine cannot be trusted to make.
 *
 * `expo-font/build/FontLoader.js` imports `expo-asset`, which nothing in this
 * repo depends on directly — it arrives underneath `expo`. When npm nests it at
 * `node_modules/expo/node_modules/expo-asset` rather than hoisting it, the
 * import has no copy it can reach from `node_modules/expo-font/`, and every
 * test that loads the font stack fails with `Cannot find module 'expo-asset'`.
 *
 * That happened, and it reached CI rather than the machine that wrote it,
 * because Node keeps walking `node_modules` up past the repo and finds a copy
 * in the developer's home directory. A clean `npm ci` on a runner has no home
 * directory to fall back on. Green here, red there, which is the worst order to
 * learn it in.
 *
 * So the assertion is not "does it resolve" — it resolved fine on the machine
 * that shipped the bug. It is "does it resolve to a copy that came with this
 * checkout", which is the thing the runner will and the home directory will not
 * be able to satisfy. Written against Node's own resolver rather than Jest's,
 * because the failure is Node's resolution inside `node_modules`, and Jest's is
 * configurable in ways that could quietly paper over it.
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

it('resolves expo-asset from expo-font to a copy inside this checkout', () => {
  const fromFontLoader = createRequire(require.resolve('expo-font/package.json'));
  const resolved = fromFontLoader.resolve('expo-asset');

  expect(path.relative(REPO_ROOT, resolved).startsWith('..')).toBe(false);
});
