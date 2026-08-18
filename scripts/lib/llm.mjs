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
 * Gemini, because the local box these scripts once assumed was never stood up,
 * and a rubric that silently falls back to category prices is not a rubric.
 * There is no provider flag, because there is one provider — point
 * LLM_BASE_URL and LLM_MODEL elsewhere if that ever stops being true.
 */
// RUBRIC prices a goal; SCREENING decides whether it is safe to stake.
export { RUBRIC } from '../../supabase/functions/_shared/rubric.mjs';
export { SCREENING } from '../../supabase/functions/_shared/screening.mjs';

// Reading a Gemini response is a judgement, not a field access. Same file the
// edge function uses, for the same reason the prompts are shared: a refusal
// must mean the same thing on a laptop as it does in production.
import { refusedResponse, responseText } from '../../supabase/functions/_shared/verdict.mjs';

import { fromEnvFile } from './env.mjs';

/**
 * No timeout here, unlike the edge function. Nobody is waiting on a keystroke —
 * a drafting run of forty goals can take its time, and cutting it off would
 * only mean drafting fails on exactly the connections that need the slack.
 *
 * Throws on every *failure*, which is the whole contract. The edge function's
 * twin falls open instead, because a model having a bad day must not stop
 * somebody staking a goal. Nothing here is on that path: a failed draft is a
 * draft you run again.
 *
 * A refusal is not a failure. The model declining to answer is the safety
 * filter firing on exactly the goals SCREENING exists to catch, so it comes
 * back as `{status:'refused'}` for `screeningVerdict` to read — the same two
 * states, in the same words, as the edge function. Throwing on it, as this file
 * used to, meant the only harness that can be pointed at a list of goals was
 * the one harness that could not report a blocked one.
 *
 * @returns {{status: 'ok', value: object} | {status: 'refused'}}
 */
export async function complete({ system, user, schema }) {
  const raw = await gemini({ system, user, schema });
  return raw.status === 'ok' ? { status: 'ok', value: parseJson(raw.value) } : raw;
}

/**
 * The answer itself, for callers a refusal simply defeats.
 *
 * Screening is the one question where "the model declined" is information, and
 * `complete` returns the two states apart so `screeningVerdict` can read them.
 * Drafting goals and writing a bot's week are not that: there is nothing to
 * infer from a refusal except that the run did not work, and every one of those
 * call sites would otherwise have to unwrap the same envelope and say the same
 * sentence about it.
 */
export async function answer(opts) {
  const result = await complete(opts);
  if (result.status !== 'ok') {
    throw new Error('Gemini declined to answer this one. Nothing was written; run it again.');
  }
  return result.value;
}

async function gemini({ system, user, schema }) {
  const base = process.env.LLM_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';
  // Lite, and not for cost: `gemini-3.5-flash`'s free tier is twenty requests a
  // *day*, which one drafting run exhausts before it reaches the second bot.
  // The lite models have their own, far larger allowance. Measured on the
  // twelve-goal screening list, lite answered all twelve correctly — including
  // "Finish module 3 of the SQL course", the false positive that made SCREENING
  // a separate prompt from RUBRIC in the first place.
  const model = process.env.LLM_MODEL ?? 'gemini-3.5-flash-lite';
  const key = fromEnvFile('GEMINI_API_KEY');

  if (!key) {
    throw new Error(
      'GEMINI_API_KEY is not set.\n' +
        '  Get one from https://aistudio.google.com/apikey\n' +
        '  Put it in .env as GEMINI_API_KEY=…, or export it before running.',
    );
  }

  const request = {
    method: 'POST',
    headers: {
      // A header, never the query string: a key in a URL ends up in every
      // proxy log and shell history between here and Google.
      'x-goog-api-key': key,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: { role: 'user', parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        // `schema` is passed straight through. Gemini's responseSchema takes
        // the same JSON Schema objects the callers already hand to this
        // function, so there is no translation layer to keep in step.
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0,
      },
    }),
  };

  const body = await send(`${base}/models/${model}:generateContent`, request, base, model);

  // Asked of the whole body, not of the text: a block can arrive with tokens
  // already emitted, or with no candidate at all. `verdict.mjs` owns that
  // judgement for both runtimes.
  if (refusedResponse(body)) {
    const why =
      body?.candidates?.[0]?.finishReason ?? body?.promptFeedback?.blockReason ?? 'no content';
    process.stderr.write(`  gemini declined to answer (${why})\n`);
    return { status: 'refused' };
  }

  return { status: 'ok', value: responseText(body) };
}

/**
 * One call, and the waiting the free tier makes unavoidable.
 *
 * The free tier allows twenty requests a minute. Pricing and screening are two
 * calls per goal, so drafting ten goals for four bots is eighty-four — a 429 is
 * not an edge case here, it is the normal shape of a full run. Google says
 * exactly how long to wait, in a `RetryInfo` on the error, so the only sensible
 * thing to do is wait that long and carry on. A run that takes four minutes is
 * fine; a run that dies a third of the way through is not.
 *
 * 503 is retried on the same path: it means the model is busy, which is also
 * temporary and also not the caller's problem.
 */
async function send(endpoint, request, base, model) {
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetch(endpoint, request);
    } catch (err) {
      throw new Error(`Could not reach Gemini at ${base}.\n(${err.message})`);
    }

    if (res.ok) return res.json();

    const detail = await res.text();
    const parsed = (() => {
      try {
        return JSON.parse(detail);
      } catch {
        return null;
      }
    })();
    const message = parsed?.error?.message ?? detail;

    const wait = attempt < MAX_RETRIES ? retryDelay(parsed, res.status) : null;
    if (wait !== null) {
      // stderr, so it does not land in the middle of a table on stdout.
      process.stderr.write(`  waiting ${Math.ceil(wait / 1000)}s for Gemini's rate limit…\n`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    // Google retires models on the free tier and says so precisely, naming the
    // replacement. Quoting it beats anything this file could guess.
    if (res.status === 404) throw new Error(`Gemini has no model "${model}".\n  ${message}`);
    if (res.status === 429) {
      throw new Error(
        `Gemini rate limit or quota reached, and waiting did not clear it.\n` +
          `  This is usually the daily quota rather than the per-minute one —\n` +
          `  "${model}" is spent until tomorrow. Try LLM_MODEL=gemini-flash-lite-latest.\n` +
          `  ${message}`,
      );
    }
    if (res.status === 503) throw new Error(`Gemini is busy (503).\n  ${message}`);
    throw new Error(`Gemini returned ${res.status}: ${message}`);
  }
}

const MAX_RETRIES = 4;

/** Milliseconds to wait, or null if this status is not worth retrying. */
function retryDelay(parsed, status) {
  if (status !== 429 && status !== 503) return null;
  const info = parsed?.error?.details?.find((d) => `${d['@type']}`.endsWith('RetryInfo'));
  const seconds = Number(`${info?.retryDelay ?? ''}`.replace(/s$/, ''));
  // Google usually says. When it does not, a minute clears a per-minute limit
  // by definition, and one extra minute is cheaper than a failed run.
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) + 1000 : 60_000;
}

/** Tolerates a model that wrapped its object in prose. */
function parseJson(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error(`No JSON in the model's reply:\n${raw}`);
  return JSON.parse(raw.slice(start, end + 1));
}
