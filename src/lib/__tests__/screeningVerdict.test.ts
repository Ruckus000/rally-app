/**
 * The one decision that inverts on a hosted model.
 *
 * `rate-goal` cannot be reached from this suite — it is a Deno function, and
 * everything under `supabase/functions` is outside tsconfig, outside both Jest
 * projects, and excluded from the local stack CI starts. So the judgement worth
 * pinning was moved into a `.mjs` both runtimes import, and this is where it is
 * held to account.
 *
 * The pair below is the whole of it. A screening call that never arrived says
 * nothing about the goal and must resolve `ok`, or a model having a bad day
 * quietly stops anybody writing anything down. A screening call the model
 * *declined* is the safety filter firing, on exactly the goals the prompt
 * exists to catch, and must resolve `blocked`. Collapse the two — which the old
 * `screened?.harmful === true` did, because both arrived as null — and the
 * guard fails open precisely where it must not.
 */
import {
  REFUSED_REASON,
  cacheable,
  screeningVerdict,
} from '../../../supabase/functions/_shared/verdict.mjs';

type Screening = Parameters<typeof screeningVerdict>[0];

/**
 * The JSDoc on `verdict.mjs` describes what a *correct* caller passes, and
 * TypeScript holds this file to it. Several tests below exist precisely because
 * the wire does not: the value came from a model's JSON, through a fetch, and
 * "harmful" arriving as the string "true" or the key missing entirely are real
 * shapes. Casting here is the point of those tests, not a way around them.
 */
const offWire = (v: unknown) => v as Screening;

describe('a screening answer that arrived', () => {
  it('blocks a goal the model called harmful, and passes its reason on', () => {
    expect(
      screeningVerdict({
        status: 'ok',
        value: { harmful: true, reason: 'Driving after drinking is dangerous and illegal.' },
      }),
    ).toEqual({
      verdict: 'blocked',
      reason: 'Driving after drinking is dangerous and illegal.',
    });
  });

  it('allows a goal it called safe', () => {
    expect(screeningVerdict({ status: 'ok', value: { harmful: false, reason: '' } })).toEqual({
      verdict: 'ok',
      reason: '',
    });
  });

  it('treats anything that is not exactly true as not harmful', () => {
    // The field is model-written. A string "true", a 1, or a missing key are
    // all shapes a bad reply can take, and none of them is an accusation.
    for (const harmful of ['true', 1, undefined, null]) {
      expect(screeningVerdict(offWire({ status: 'ok', value: { harmful } })).verdict).toBe('ok');
    }
  });

  it('trims a reason to something that fits on a card', () => {
    const { reason } = screeningVerdict({
      status: 'ok',
      value: { harmful: true, reason: 'x'.repeat(400) },
    });
    expect(reason).toHaveLength(160);
  });

  it('survives a harmful verdict with no reason at all', () => {
    expect(screeningVerdict(offWire({ status: 'ok', value: { harmful: true } }))).toEqual({
      verdict: 'blocked',
      reason: '',
    });
  });
});

describe('a screening answer that did not', () => {
  it('does not block when the call never arrived', () => {
    // Timeout, 429, no network, garbled body. Failing closed here would mean a
    // slow model silently refusing to let anyone write anything down.
    expect(screeningVerdict({ status: 'unavailable' })).toEqual({ verdict: 'ok', reason: '' });
  });

  it('DOES block when the model refused to answer', () => {
    // The inversion, and the reason this file exists. Gemini's safety filters
    // block the response itself — 200, a finishReason, no content — and the
    // goals that trigger it are the self-harm and violence ones. A refusal is
    // not an absent answer; it is the answer arriving by another route.
    expect(screeningVerdict({ status: 'refused' })).toEqual({
      verdict: 'blocked',
      reason: REFUSED_REASON,
    });
  });

  it('says something true to the person, rather than inventing a judgement', () => {
    // The model never said anything about this goal, so the reason must not
    // claim it did.
    expect(REFUSED_REASON).not.toMatch(/harmful|dangerous|illegal/i);
    expect(REFUSED_REASON.length).toBeGreaterThan(0);
  });

  it('reads an unrecognised shape as absent, not as an accusation', () => {
    for (const junk of [undefined, null, {}, { status: 'something-new' }]) {
      expect(screeningVerdict(offWire(junk)).verdict).toBe('ok');
    }
  });
});

describe('what is worth remembering forever', () => {
  it('caches only when both halves answered', () => {
    const ok = { status: 'ok', value: {} };
    expect(cacheable(ok, ok)).toBe(true);
  });

  it('does not cache a half answer', () => {
    // The cache is permanent and shared by everybody who types the same title.
    // One timed-out pricing call written here freezes that goal at its category
    // price long after the model came back.
    const ok = { status: 'ok', value: {} };
    expect(cacheable(ok, { status: 'unavailable' })).toBe(false);
    expect(cacheable({ status: 'unavailable' }, ok)).toBe(false);
  });

  it('does not cache a refusal, even though it is a real verdict', () => {
    // It is the one verdict reached without the model saying anything about the
    // goal, and a permanent block is too heavy to build on a filter that may
    // have fired on the phrasing.
    const ok = { status: 'ok', value: {} };
    expect(cacheable(ok, { status: 'refused' })).toBe(false);
  });
});
