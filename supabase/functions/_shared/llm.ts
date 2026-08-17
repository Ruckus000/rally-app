/**
 * The one place this project talks to a language model.
 *
 * One provider: Gemini, over HTTPS. There is no provider flag because there is
 * one provider — `LLM_BASE_URL` and `LLM_MODEL` move it, and adding a second
 * would be a branch here and nothing anywhere else.
 *
 * It used to be a self-hosted Ollama, which is the shape Supabase documents for
 * an edge function — the built-in `Supabase.ai` API hosts embeddings, and
 * anything larger is expected to be a box you run. Neither Supabase nor Vercel
 * will run a model for you; Vercel has no GPUs at all. That box was never stood
 * up, so every goal fell back to its category price, and a rubric that never
 * runs is not a rubric. A hosted API is the way round it.
 *
 * Two prompts, not one, and the split is not cosmetic. Asked to price a goal
 * and judge its safety in a single schema, a small model fills the verdict
 * field from whatever is nearest in its context — a 3B blocked "Finish module 3
 * of the SQL course" as "a clearly illegal act", having read that phrase in the
 * prompt. Separated, with the pricing prompt saying nothing about safety and
 * the screening prompt saying nothing about quality, the same model gets both
 * right. See `rubric.mjs` and `screening.mjs`.
 *
 * ── Why this returns three things and not two ──────────────────────────────
 *
 * It used to return `T | null`, where null meant every runtime failure, because
 * the caller's answer to all of them was the same: fall back to the category
 * price and let the person get on with their week.
 *
 * A hosted model breaks that. Its safety filters block the *response* — a 200,
 * a `finishReason`, and no content — and the goals that trigger it are exactly
 * the self-harm and violence cases the screening prompt exists to catch. Folded
 * into the same null as a timeout, a refusal would resolve `ok`: the guard
 * would fail open precisely where it must not.
 *
 * So `refused` and `unavailable` are different answers. `verdict.mjs` decides
 * what each one means, and is unit-tested on exactly that pair.
 */

/** Gemini's REST surface. Overridable, but there is nowhere else to point it. */
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Lite, and not for cost: `gemini-3.5-flash`'s free tier is twenty requests a
 * *day*. Lite's allowance is far larger, and on the twelve-goal screening list
 * it answered all twelve correctly — including the SQL-course false positive
 * above and the two harmful goals the old 3B was recorded as missing.
 */
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

/**
 * Hard ceiling on a single call.
 *
 * Measured: Gemini answers this prompt in 1.3–2.2s. The old ceiling was 2000ms,
 * set when the model was a local Ollama, and against a hosted one it would
 * abort roughly one call in five — spending the request and then discarding the
 * answer, which is the worst of both. 4s clears the observed spread with room
 * for a slow day, and still sits inside the client's own 5s patience so that an
 * abort *there* means the network went away rather than the model being slow.
 *
 * The composer shows a fallback price while it waits, so the cost of waiting is
 * a number that sharpens a moment later, not a stall.
 */
const TIMEOUT_MS = 4000;

export type CompleteOpts = {
  system: string;
  user: string;
  /** JSON Schema. Passed to Gemini as `responseSchema`, unmodified. */
  schema: Record<string, unknown>;
};

/**
 * `ok` carries an answer. `refused` means the model declined to produce one,
 * which is itself information. `unavailable` means nothing came back and
 * nothing can be inferred.
 */
export type Completion<T> =
  | { status: 'ok'; value: T }
  | { status: 'refused' }
  | { status: 'unavailable' };

const UNAVAILABLE = { status: 'unavailable' } as const;
const REFUSED = { status: 'refused' } as const;

function env(key: string): string {
  // Deno in the edge runtime, process in the Node scripts that share this shape.
  // deno-lint-ignore no-explicit-any
  const d = (globalThis as any).Deno;
  return d?.env?.get(key) ?? '';
}

// Imported, not read off disk. Supabase bundles a function from its module
// graph, so a prompt loaded with `Deno.readTextFile` is missing the moment it
// is deployed — it fails as ENOENT on every request. `.mjs` is the extension
// Deno and the Node authoring scripts can both import, so one file serves both.
export { RUBRIC } from './rubric.mjs';
export { SCREENING } from './screening.mjs';

export async function complete<T>(opts: CompleteOpts): Promise<Completion<T>> {
  try {
    const raw = await callGemini(opts);
    if (raw.status !== 'ok') return raw;
    const parsed = parseJson<T>(raw.value);
    // Well-formed reply, unreadable body. Nothing was refused, so this is an
    // absent answer rather than a verdict.
    return parsed === null ? UNAVAILABLE : { status: 'ok', value: parsed };
  } catch (err) {
    // Includes the AbortError from the timeout. Every one of these means "no
    // rating this time", which the caller already knows how to survive.
    console.warn(`llm: call failed — ${(err as Error)?.message ?? err}`);
    return UNAVAILABLE;
  }
}

async function callGemini({
  system,
  user,
  schema,
}: CompleteOpts): Promise<Completion<string>> {
  const key = env('GEMINI_API_KEY');
  if (!key) {
    // A deploy mistake, and loud in the logs — but not a throw. Every path
    // through this function has to end in a usable price, and a composer that
    // 500s because a secret is unset is a worse outcome than one that quietly
    // prices by category until somebody reads the log.
    console.error('llm: GEMINI_API_KEY is not set — supabase secrets set GEMINI_API_KEY=…');
    return UNAVAILABLE;
  }

  const base = env('LLM_BASE_URL') || DEFAULT_BASE_URL;
  const model = env('LLM_MODEL') || DEFAULT_MODEL;

  const res = await fetch(`${base}/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      // A header, never the query string: a key in a URL ends up in every proxy
      // log between here and Google.
      'x-goog-api-key': key,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: { role: 'user', parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        // `schema` goes straight through: Gemini's responseSchema accepts the
        // same JSON Schema objects the callers already build, so there is no
        // translation layer to keep in step with them.
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0,
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    // 429 and 5xx included. No retry here, deliberately — somebody is watching
    // a number on a button, and a second attempt would blow the timeout budget
    // to deliver an answer they have already stopped waiting for.
    console.warn(`llm: gemini returned ${res.status}`);
    return UNAVAILABLE;
  }

  const body = await res.json();
  const candidate = body?.candidates?.[0];
  const text: string =
    candidate?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';

  if (!text) {
    // The refusal path. A 200 with no content is the safety filter blocking the
    // response, and `finishReason` (or a top-level `promptFeedback`) says so.
    // Read as an empty answer this would mean "nothing wrong with this goal",
    // which is the one conclusion it does not support.
    const why = candidate?.finishReason ?? body?.promptFeedback?.blockReason ?? 'no content';
    console.warn(`llm: gemini declined to answer (${why})`);
    return REFUSED;
  }

  return { status: 'ok', value: text };
}

/**
 * Tolerates a model that wrapped its object in prose. Null if there is none.
 *
 * `responseMimeType: application/json` plus a schema makes that unlikely rather
 * than impossible — unlike Ollama's grammar constraint, which made it
 * mechanically so. Worth keeping now that it is a hint and not a guarantee.
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
