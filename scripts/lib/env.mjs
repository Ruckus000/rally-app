/**
 * Read one named variable out of `.env`, for scripts that Node runs directly.
 *
 * Nothing loads `.env` here. Expo reads it when it bundles the app; `node
 * scripts/*.mjs` does not, and there is no dotenv in this project. So a value
 * sitting in that file is invisible to every script unless one goes and looks.
 *
 * Deliberately one variable at a time, and deliberately not `node --env-file`,
 * which this Node supports. Loading the whole file would make
 * SUPABASE_SERVICE_ROLE_KEY loadable from `.env` — which is exactly what
 * seed-bots.mjs refuses on purpose, on the grounds that the file is for the
 * publishable key and that one bypasses every policy in the database. A helper
 * that reads a variable by name keeps that refusal true.
 */
import { readFileSync } from 'node:fs';

/** `process.env` wins. Returns undefined if the file or the line is absent. */
export function fromEnvFile(name) {
  if (process.env[name]) return process.env[name];
  let text;
  try {
    text = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
  } catch {
    // No `.env` is a normal state — CI has none, and the caller's own error
    // message about the missing variable is more use than an ENOENT trace.
    return undefined;
  }
  return (text.match(new RegExp(`^${name}=(.+)$`, 'm')) ?? [])[1]?.trim();
}
