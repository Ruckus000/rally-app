/**
 * Unwrapping an answer, for the callers a refusal simply defeats.
 *
 * This file exists because the thing it tests broke silently. `complete` was
 * changed to return `{status, value}` so that screening could tell a refusal
 * from an outage, and two call sites kept destructuring the answer straight off
 * it — `draft-bot-goals.mjs` then drafted goals into an empty loop and
 * `seed-bots.mjs` fell back for every goal in the week. Neither printed
 * anything wrong. Both looked like a quiet day.
 *
 * Driven through `fetch` rather than by mocking `complete`, because `answer`
 * calls it as a module-local binding that a mocked export cannot intercept —
 * and because a Gemini body is the input whose shape actually matters here.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { answer, complete } = require('../llm.mjs');

const CALL = { system: 's', user: 'u', schema: {} };

/** A 200 carrying JSON, which is what a completed call looks like. */
const answered = (body: unknown) => ({
  ok: true,
  json: async () => ({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(body) }] } }],
  }),
});

/** A 200 carrying nothing, which is what the safety filter looks like. */
const refused = {
  ok: true,
  json: async () => ({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }),
};

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
  global.fetch = jest.fn();
});

describe('answer', () => {
  it('hands back the value, not the envelope around it', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(answered({ goals: [{ title: 'Swim' }] }));

    // The bug in one line: destructuring is what both call sites do.
    const { goals } = await answer(CALL);

    expect(goals).toEqual([{ title: 'Swim' }]);
  });

  it('throws when the model declines', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(refused);

    // Loud, because these callers write to the database. A run that quietly
    // produced nothing is the failure this whole file is about.
    await expect(answer(CALL)).rejects.toThrow(/declined to answer/);
  });
});

describe('complete, which keeps the two apart', () => {
  it('reports a refusal as a state rather than an error', async () => {
    // Screening needs this distinction and is the only caller that does.
    (global.fetch as jest.Mock).mockResolvedValue(refused);

    await expect(complete(CALL)).resolves.toEqual({ status: 'refused' });
  });

  it('wraps a real answer', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(answered({ points: 40 }));

    await expect(complete(CALL)).resolves.toEqual({ status: 'ok', value: { points: 40 } });
  });
});
