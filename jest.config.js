/**
 * Two projects, two very different jobs.
 *
 * `unit` is the fast loop: the React Native suite under jest-expo, with
 * Supabase mocked. `integration` talks to a real local Postgres and is never
 * part of `npm test`, so a contributor without Docker is never blocked.
 *
 * The config lives here rather than in package.json because a root-level
 * `preset` is ignored once `projects` is present — it has to move into each
 * project, which package.json's single `jest` key can't express.
 */
const expoPreset = require('jest-expo/jest-preset');

/** @type {import('jest').Config} */
module.exports = {
  // Root-level: `testTimeout` is not a valid per-project option in Jest 29.
  // Harmless for the unit suite, whose tests run in milliseconds.
  testTimeout: 20000,
  projects: [
    {
      displayName: { name: 'unit', color: 'magenta' },
      rootDir: __dirname,
      preset: 'jest-expo',
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
      // jest-expo's preset sets no testMatch, so Jest's default would sweep up
      // integration/ as well. Pin it to the app.
      // `scripts/` is included because the authoring scripts had no test of any
      // kind, and one of them decides what the Global feed says — the first
      // screen a new account sees. Only the pure parts are reachable this way;
      // anything needing a database or a model stays a thing you run.
      testMatch: [
        '<rootDir>/src/**/__tests__/**/*.test.[jt]s?(x)',
        '<rootDir>/scripts/**/__tests__/**/*.test.[jt]s?(x)',
      ],
      // Keeps the root __mocks__ directory scoped to this project, and lets a
      // test reach the shared `.mjs` decisions under supabase/functions —
      // `roots` bounds where Jest *discovers* files, not what a test may import.
      roots: ['<rootDir>/src', '<rootDir>/scripts'],
      // The edge function's shared decisions live in `.mjs`, which is the one
      // extension Deno and Node both load. jest-expo's transform key is
      // `\.[jt]sx?$` and does not match it, so without this an import of one
      // fails with "Unexpected token 'export'" — the file is handed to Jest
      // untransformed. Same babel wiring, one more extension.
      transform: {
        ...expoPreset.transform,
        '\\.mjs$': expoPreset.transform['\\.[jt]sx?$'],
      },
    },
    {
      displayName: { name: 'integration', color: 'yellow' },
      rootDir: __dirname,
      testEnvironment: 'node',
      testMatch: ['<rootDir>/integration/**/*.test.ts'],
      // Scoped so Jest cannot discover src/__mocks__/@supabase/supabase-js.
      // Without this the integration suite silently runs against the unit
      // fake — every test fails on `signInWithPassword is not a function`,
      // and a subtler fake would have failed far less honestly.
      roots: ['<rootDir>/integration'],
      // Borrow jest-expo's babel wiring (it already handles our TypeScript and
      // ESM) but none of its React Native resolver/haste/environment, which
      // would misresolve @supabase/supabase-js in Node.
      transform: { '\\.[jt]sx?$': expoPreset.transform['\\.[jt]sx?$'] },
      setupFilesAfterEnv: ['<rootDir>/integration/setup.ts'],
      globalSetup: '<rootDir>/integration/globalSetup.js',
      globalTeardown: '<rootDir>/integration/globalTeardown.js',
      // `aud = 'everyone'` is globally visible by definition, so parallel
      // workers sharing one database would leak rows into each other's
      // negative assertions. Serial is also plenty fast at this size.
      // Ignored. Like `testTimeout` above, `maxWorkers` is not a valid
      // per-project option in Jest 29 — it is read from the CLI and the root
      // config only. Left here because it states the requirement, but the
      // requirement is actually met by `--runInBand` in the `test:integration`
      // script, which `test:all` chains rather than duplicating. Bare `jest`
      // runs these twenty suites in parallel against one database and they
      // stomp on each other's rows.
      maxWorkers: 1,
      slowTestThreshold: 15,
    },
  ],
};
