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
 * A hosted model breaks that. Its safety filters block the *response* — a 200
 * carrying a `finishReason` and usually no content, though sometimes a few
 * tokens it had already emitted — and the goals that trigger it are exactly the
 * self-harm and violence cases the screening prompt exists to catch. Folded
 * into the same null as a timeout, a refusal would resolve `ok`: the guard
 * would fail open precisely where it must not.
 *
 * So `refused` and `unavailable` are different answers. `verdict.mjs` decides
 * what each one means, and is unit-tested on exactly that pair.
 *
 * ── Pictures go through the same door ──────────────────────────────────────
 *
 * A third prompt asks about an avatar rather than a sentence (`imageScreening
 * .mjs`), and it needs the image itself. That is one optional field on the
 * options object, not a second function: the retry policy (there is none), the
 * timeout, and above all the refusal detection are the parts worth having once.
 * The refusal path especially — a blocked *response* is how a hosted model
 * answers about exactly the images an avatar guard exists to catch, and
 * `imageVerdict.mjs` reads that answer off the shape this file returns.
 */

/** Gemini's REST surface. Overridable, but there is nowhere else to point it. */
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Lite, and not for cost: `gemini-3.5-flash`'s free tier is twenty requests a
 * *day*. Lite's allowance is far larger, and on the twelve-goal screening list
 * it answered all twelve correctly — including the SQL-course false positive
 * above and the two harmful goals the old 3B was recorded as missing.
 *
 * It also takes images, which is why the avatar screener did not need a second
 * model and this constant did not need revisiting: Gemini 3.5 Flash-Lite's
 * documented inputs are "Text, Image, Video, Audio, and PDF"
 * (ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), and inline
 * base64 image parts are the documented way to send one to `generateContent`.
 */
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

/**
 * Hard ceiling on a single text call.
 *
 * Measured: Gemini answers this prompt in 1.3–2.2s. The old ceiling was 2000ms,
 * set when the model was a local Ollama, and against a hosted one it would
 * abort roughly one call in five — spending the request and then discarding the
 * answer, which is the worst of both. 4s clears the observed spread with room
 * for a slow day.
 *
 * This bounds the model call and nothing else. The handler also does an auth
 * lookup, a cache read, a usage-counter RPC and (on the way out) an upsert, and
 * a cold start sits in front of all of it — so the *request* can take
 * meaningfully longer than this number. `rateGoal.ts` budgets for the sum, not
 * for this ceiling; see the note there before changing either.
 *
 * The composer shows a fallback price while it waits, so the cost of waiting is
 * a number that sharpens a moment later, not a stall.
 */
const TIMEOUT_MS = 4000;

/**
 * The same ceiling, for a call carrying an image, and it is deliberately far
 * looser.
 *
 * Two reasons, and they pull the same way. An avatar is up to 2 MB of base64 on
 * the wire in front of a model that then has to look at it, so the 1.3–2.2s
 * measured above is not the distribution this call draws from. And nobody is
 * watching a number on a button: the uploader sees their initials until the
 * verdict lands, because `pending` renders initials to everyone including them.
 *
 * The asymmetry that matters is what a timeout costs. On a goal it costs a
 * category price. On an image it *blocks* — `imageVerdict.mjs` fails closed —
 * so a ceiling set too tight is a person told their photo cannot be used
 * because the network was slow. There is still no retry, for the reason given
 * below; this is the one attempt, so it is given room.
 */
const IMAGE_TIMEOUT_MS = 15000;

export type CompleteOpts = {
  system: string;
  user: string;
  /** JSON Schema. Passed to Gemini as `responseSchema`, unmodified. */
  schema: Record<string, unknown>;
  /**
   * One image, inline. `base64` is the raw bytes base64-encoded — no data: URI
   * prefix — and `mimeType` is the object's real type, not a guess: Gemini is
   * told what it is being handed and a wrong answer there is a wasted call.
   *
   * Inline rather than the Files API because the whole request has to stay
   * under 20 MB and this bucket caps an object at 2 MB, so there is nothing to
   * manage a file lifecycle for.
   */
  image?: { mimeType: string; base64: string };
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

// Reading a Gemini response is a judgement, not a field access, so it lives in
// the file the unit suite can import. Nothing under this directory is testable.
import { refusedResponse, responseText } from './verdict.mjs';

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
  image,
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

  // Image first, question second — the order the docs' own examples use, and
  // the order that reads correctly for a prompt that opens "You are shown one
  // image". `inline_data`/`mime_type` in snake_case because that is how the
  // REST reference spells them; Google's JSON mapping accepts either spelling,
  // and copying the documented one is one less thing to be clever about.
  const parts = image
    ? [{ inline_data: { mime_type: image.mimeType, data: image.base64 } }, { text: user }]
    : [{ text: user }];

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
      contents: [{ role: 'user', parts }],
      generationConfig: {
        // `schema` goes straight through: Gemini's responseSchema accepts the
        // same JSON Schema objects the callers already build, so there is no
        // translation layer to keep in step with them.
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0,
      },
    }),
    signal: AbortSignal.timeout(image ? IMAGE_TIMEOUT_MS : TIMEOUT_MS),
  });

  if (!res.ok) {
    // 429 and 5xx included. No retry here, deliberately — somebody is watching
    // a number on a button, and a second attempt would blow the timeout budget
    // to deliver an answer they have already stopped waiting for.
    console.warn(`llm: gemini returned ${res.status}`);
    return UNAVAILABLE;
  }

  const body = await res.json();

  // Both questions asked of the whole body, in `verdict.mjs`, because neither
  // can be answered from the text alone — a block can arrive with content
  // already emitted, or with no candidate at all. That file is importable by
  // the unit suite; nothing in this one is.
  if (refusedResponse(body)) {
    const why =
      body?.candidates?.[0]?.finishReason ?? body?.promptFeedback?.blockReason ?? 'no content';
    console.warn(`llm: gemini declined to answer (${why})`);
    return REFUSED;
  }

  return { status: 'ok', value: responseText(body) };
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
