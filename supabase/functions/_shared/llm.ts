/**
 * The one place this project talks to a language model.
 *
 * One provider: Ollama, over HTTP, wherever it happens to be running. On a
 * laptop that is `localhost` and it authors the bot goals; in production it is
 * whatever box `LLM_BASE_URL` names. Same model, same rubric, same clamp, so a
 * bot goal and a user's goal are priced by the same thing rather than by two
 * models somebody has to keep in agreement.
 *
 * This is also the only shape Supabase documents for language models in an edge
 * function — the built-in `Supabase.ai` API hosts embeddings, and anything
 * larger is expected to be a self-managed Ollama or Llamafile server. Neither
 * Supabase nor Vercel will run a model for you; Vercel has no GPUs at all.
 *
 * It stays a seam rather than a fetch call in the handler because the endpoint
 * is a config value: moving from a laptop to a box on the internet is
 * `supabase secrets set`, and adding a hosted provider later is one branch here
 * and nothing anywhere else.
 *
 * Two prompts, not one, and the split is not cosmetic. Asked to price a goal
 * and judge its safety in a single schema, a small model fills the verdict
 * field from whatever is nearest in its context — a 3B blocked "Finish module 3
 * of the SQL course" as "a clearly illegal act", having read that phrase in the
 * prompt. Separated, with the pricing prompt saying nothing about safety and
 * the screening prompt saying nothing about quality, the same model gets both
 * right. See `rubric.mjs` and `screening.mjs`.
 *
 * A failed call is not an error here. `complete` returns null for every
 * runtime failure — no network, a timeout, a 429, a body that is not the JSON
 * it promised — because the caller's answer to all of those is identical: fall
 * back to the category price and let the person get on with their week. Only a
 * misconfiguration throws, since that is a deploy mistake and should be loud.
 */

/** The host's Ollama, as seen from inside the local edge runtime container. */
const DEFAULT_OLLAMA_URL = 'http://host.docker.internal:11434';

/**
 * Hard ceiling on a single call. The composer shows a fallback price while it
 * waits, so a slow model costs the user a stale number rather than a stall —
 * but only if we give up well inside the client's own 2.5s timeout.
 */
const TIMEOUT_MS = 2000;

export type Provider = 'ollama';

export type CompleteOpts = {
  system: string;
  user: string;
  /** JSON Schema. Ollama constrains decoding to it, so a reply cannot break it. */
  schema: Record<string, unknown>;
};

function env(key: string): string {
  // Deno in the edge runtime, process in the Node scripts that share this shape.
  // deno-lint-ignore no-explicit-any
  const d = (globalThis as any).Deno;
  return d?.env?.get(key) ?? '';
}

export function provider(): Provider {
  return (env('LLM_PROVIDER') || 'ollama') as Provider;
}

// Imported, not read off disk. Supabase bundles a function from its module
// graph, so a prompt loaded with `Deno.readTextFile` is missing the moment it
// is deployed — it fails as ENOENT on every request. `.mjs` is the extension
// Deno and the Node authoring scripts can both import, so one file serves both.
export { RUBRIC } from './rubric.mjs';
export { SCREENING } from './screening.mjs';

export async function complete<T>(opts: CompleteOpts): Promise<T | null> {
  const p = provider();
  try {
    const raw = p === 'ollama' ? await callOllama(opts) : unsupported(p);
    if (raw === null) return null;
    return parseJson<T>(raw);
  } catch (err) {
    // Includes AbortError from the timeout. Every one of these means "no
    // rating this time", which the caller already knows how to survive.
    console.warn(`llm: ${p} call failed — ${(err as Error)?.message ?? err}`);
    return null;
  }
}

function unsupported(p: string): never {
  throw new Error(
    `LLM_PROVIDER=${p} is not implemented. The only provider is ollama, ` +
      `pointed at LLM_BASE_URL. Adding a hosted one means a branch here and ` +
      `nothing anywhere else.`,
  );
}

/**
 * Ollama constrains decoding to the schema, so the model cannot emit tokens
 * that would break it — malformed JSON is mechanically impossible and there is
 * no repair path to write. The parse below is still defensive because a
 * connection refused by a stopped Ollama comes back as an HTML error page.
 */
async function callOllama({ system, user, schema }: CompleteOpts): Promise<string | null> {
  const base = env('LLM_BASE_URL') || DEFAULT_OLLAMA_URL;
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env('LLM_MODEL') || 'llama3.2',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      format: schema,
      stream: false,
      options: { temperature: 0 },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    console.warn(`llm: ollama returned ${res.status}`);
    return null;
  }
  const body = await res.json();
  return body?.message?.content ?? null;
}

/**
 * Tolerates a model that wrapped its object in prose. Null if there is none.
 *
 * Ollama's grammar constraint makes that impossible, so this is belt and braces
 * for the day a hosted provider is added — those offer a JSON *hint* rather than
 * a constraint, and will happily wrap the object in a sentence.
 */
function parseJson<T>(raw: string): T | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
