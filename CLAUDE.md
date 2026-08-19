# Rally — Week Spine

React Native (Expo 57, RN 0.86, React 19) + Supabase. Portrait-only phone app.
Design spec: `design-reference/HANDOFF.md` (authoritative — read before UI work).

## Commands

```bash
npm start                 # Metro
npm run sim               # iOS sim, standalone Release build, no Metro (scripts/sim.sh)
npm run android           # Android emulator, same deal

npm test                  # unit only (jest --selectProjects unit)
npm run test:integration  # needs Docker + local Supabase; --runInBand
npm run test:all          # both
npm run typecheck         # tsc --noEmit
npm run lint              # expo lint

npm run db:start          # local Supabase stack
npm run db:reset          # migrations + supabase/seed.sql
npm run icons             # regenerates assets AND src/theme/mark.ts
```

## Architecture

- `index.ts` → root `App.tsx` (fonts, splash, `loadPersistedState`) → `src/App.tsx` (the shell).
- **No navigation library.** Routing is reducer state — `state.tab`, `planOpen`, `sheet`,
  `notifOpen`, `onboardStep` — rendered conditionally in `src/App.tsx`. Transitions are
  actions (`GO_PLACE`, `OPEN_PLAN_WITH`). Do not add react-navigation or expo-router.
- **No path aliases.** All imports relative (`../state/store`). There is no `@/`.
- State: `useReducer` + Context in `src/state/store.tsx`. No redux/zustand/jotai.
- `src/sync/` sits between reducer and server: `transport.ts` is the only place that talks to
  Supabase, via a `WireOp` union; `mappers.ts` converts row ↔ domain. It returns
  retryable-vs-permanent instead of throwing.
- `src/theme/tokens.ts` holds every color/type/radius. Nothing else hardcodes a design value.
- Screens/components are `PascalCase.tsx`; logic modules `camelCase.ts`; tests in a sibling
  `__tests__/`. Every file opens with an explanatory block comment — match that.

## Gotchas

- `src/__mocks__/@supabase/supabase-js.ts` is **auto-applied to every unit test** (no
  `jest.mock` call). It enforces real constraints and SQLSTATEs but has **no RLS, no realtime**
  (`channel()` throws), no embedded selects. Any test named "X cannot see Y" belongs in
  `integration/`, or it passes for the wrong reason.
- **Generated — never hand-edit:** `src/theme/mark.ts` (from `scripts/make-icons.mjs`).
- `npm run db:types` writes `src/lib/database.types.ts`. That file **does not exist and nothing
  imports it** — DB shapes are hand-written in `src/data/fixtures.ts` and `src/sync/`. Don't
  assume generated types are available.
- Persistence (`src/state/persistence.ts`, AsyncStorage `rally:state:v1`, envelope `version: 2`)
  **discards on version mismatch rather than migrating**. Changing a fixture won't reach an
  existing install until `VERSION` is bumped.
- `tsconfig.json` **excludes `supabase/functions`** (Deno, `jsr:` imports). `npm run typecheck`
  does not cover them; `supabase functions serve|deploy` does.
- Shared edge-function logic is `.mjs` so Deno and Node both load it — `jest.config.js` adds
  `\.mjs$` to the transform or imports fail with "Unexpected token 'export'".
- **Env:** `EXPO_PUBLIC_*` is baked into the bundle. Publishable key only, never service-role.
  `GEMINI_API_KEY` is unprefixed on purpose (scripts only); the edge function reads it from
  `supabase secrets set`, not `.env`.
- Three account modes; only `live` touches the network. `fresh` and `seeded` make zero calls —
  which is why `getSupabase()` is lazy (`src/lib/supabase.ts`).
- Feature flags are `config` props on `<App config={…}/>`: `showRank`, `defaultAudience`,
  `quietComebacks` (defaults in `DEFAULT_CONFIG`, `src/state/store.tsx`).
- Under jest-expo `BackHandler` is an iOS stub — use `src/test/backPress.ts`.
- `/ios` and `/android` are gitignored (prebuild output).

## Where to read more

| Topic | File |
|---|---|
| Design spec, tokens, copy | `design-reference/HANDOFF.md` |
| Where the build knowingly differs from it | `design-reference/DEVIATIONS.md` |
| Schema, RLS rationale, rollout | `docs/backend.md` |
| Manual test walkthrough, config flags | `TESTING.md` |
| Setup, the mark, scoring | `README.md` |
| Edge functions | `supabase/functions/README.md` |
