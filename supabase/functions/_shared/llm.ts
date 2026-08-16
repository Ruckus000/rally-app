/**
 * The one place this project talks to a language model.
 *
 * Two providers ship working, because the two jobs have different audiences.
 * Bot goals are authored on a developer's laptop, where Ollama is free and
 * unmetered and there is no reason to send anything to a hosted API. Goals
 * typed by a real user are rated from an edge function, which cannot reach that
 * laptop, so production points at Groq's free tier. Same rubric, same schema,
 * same clamp — the provider is a config value, not a code path.
 *
 * Free tiers move. That is the whole reason this file exists as a seam rather
 * than as a fetch call inside the handler: swapping providers when terms change
 * should be `supabase secrets set`, and self-hosting Ollama is already one of
 * the branches if it ever comes to that.
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

const DEFAULT_OLLAMA_URL = 'http://host.docker.internal:11434';
const DEFAULT_GROQ_URL = 'https://api.groq.com';

/**
 * Hard ceiling on a single call. The composer shows a fallback price while it
 * waits, so a slow model costs the user a stale number rather than a stall —
 * but only if we give up well inside the client's own 2.5s timeout.
 */
const TIMEOUT_MS = 2000;

export type Provider = 'ollama' | 'groq' | 'gemini' | 'cloudflare';

export type CompleteOpts = {
  system: string;
  user: string;
  /** JSON Schema. Ollama enforces it during decoding; Groq gets it in the prompt. */
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
    const raw =
      p === 'ollama'
        ? await callOllama(opts)
        : p === 'groq'
          ? await callGroq(opts)
          : unsupported(p);
    if (raw === null) return null;
    return parseJson<T>(raw);
  } catch (err) {
    // Includes AbortError from the timeout. Every one of these means "no
    // rating this time", which the caller already knows how to survive.
    console.warn(`llm: ${p} call failed — ${(err as Error)?.message ?? err}`);
    return null;
  }
}

function unsupported(p: Provider): never {
  throw new Error(
    `LLM_PROVIDER=${p} is not implemented. Supported: ollama, groq. ` +
      `Adding one means a branch in _shared/llm.ts and nothing else.`,
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
 * `json_object` is a format hint, not a grammar constraint — the model is told
 * to emit JSON and usually does, but nothing stops it wrapping the object in a
 * sentence. Hence the schema going into the prompt as well, and the tolerant
 * parse below.
 */
async function callGroq({ system, user, schema }: CompleteOpts): Promise<string | null> {
  const key = env('LLM_API_KEY');
  if (!key) throw new Error('LLM_API_KEY is not set. Required for LLM_PROVIDER=groq.');
  const base = env('LLM_BASE_URL') || DEFAULT_GROQ_URL;
  const res = await fetch(`${base}/openai/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: env('LLM_MODEL') || 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: `${system}\n\nJSON Schema:\n${JSON.stringify(schema)}` },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // 429 lands here. Nothing to do about it beyond letting the caller fall
    // back — the per-user cap upstream exists so this stays rare.
    console.warn(`llm: groq returned ${res.status}`);
    return null;
  }
  const body = await res.json();
  return body?.choices?.[0]?.message?.content ?? null;
}

/** Tolerates a model that wrapped its object in prose. Null if there is none. */
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
