/**
 * The authoring scripts' way to reach a model.
 *
 * A Node twin of `supabase/functions/_shared/llm.ts`, which these scripts
 * cannot import: that file is Deno, reads `Deno.env`, and resolves its siblings
 * with a `.ts` suffix Node will not follow. The duplication is the same trade
 * the rest of this project already makes for a script with no TypeScript
 * runner.
 *
 * What is *not* duplicated is the prompts. Both runtimes import the very same
 * `_shared/rubric.mjs` and `_shared/screening.mjs` — `.mjs` being the one
 * extension Deno and Node both load — because the thing that must not drift is
 * the standard a goal is held to. A bot goal priced on a laptop and a user's
 * goal priced in production have to be answering the same question.
 *
 * Ollama, which is the whole point of these scripts running here: free,
 * unmetered, no key, and no reason to send a developer's drafts anywhere. Point
 * LLM_BASE_URL at another machine to use one that is not this one.
 */
// RUBRIC prices a goal; SCREENING decides whether it is safe to stake.
export { RUBRIC } from '../../supabase/functions/_shared/rubric.mjs';
export { SCREENING } from '../../supabase/functions/_shared/screening.mjs';

/**
 * No timeout here, unlike the edge function. Nobody is waiting on a keystroke —
 * a 3B model on a laptop can take its time, and cutting it off at 2s would only
 * mean drafting fails on exactly the machines that need it most.
 */
export async function complete({ system, user, schema }) {
  return parseJson(await ollama({ system, user, schema }));
}

async function ollama({ system, user, schema }) {
  const base = process.env.LLM_BASE_URL ?? 'http://127.0.0.1:11434';
  const model = process.env.LLM_MODEL ?? 'llama3.2';
  let res;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        format: schema,
        stream: false,
        options: { temperature: 0 },
      }),
    });
  } catch (err) {
    // Much the most likely failure, and worth naming rather than showing a
    // bare ECONNREFUSED to somebody who has simply not started Ollama.
    throw new Error(
      `Could not reach Ollama at ${base}.\n` +
        `  brew install ollama && ollama serve\n` +
        `  ollama pull ${model}\n` +
        `(${err.message})`,
    );
  }
  if (res.status === 404) {
    // Ollama is running, it simply has never been given this model. Much the
    // second-likeliest failure, and the fix is one command.
    throw new Error(`Ollama has no model "${model}". Run: ollama pull ${model}`);
  }
  if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
  return (await res.json())?.message?.content ?? '';
}


/** Tolerates a model that wrapped its object in prose. */
function parseJson(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error(`No JSON in the model's reply:\n${raw}`);
  return JSON.parse(raw.slice(start, end + 1));
}
