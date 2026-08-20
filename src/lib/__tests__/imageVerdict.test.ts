/**
 * The decision that runs the other way from its sibling.
 *
 * `screeningVerdict` resolves an unavailable call `ok`, because an unscreened
 * goal is text its author typed for their own circle. `imageVerdict` refuses to
 * publish on the same status, because an unscreened avatar is a picture on the
 * screens of people who have never met them. The two files look contradictory
 * and are not — which is exactly why the inversion is pinned here rather than
 * left to a comment somebody edits away.
 *
 * It resolves that status `unproven` rather than `blocked`, and the difference
 * is what the callers do with it: `blocked` deletes the object, `unproven`
 * leaves it pending to be asked about again. Both are equally invisible. Only
 * one of them is survivable when the screener is merely down.
 *
 * The edge function that calls this is Deno and unreachable from this suite, so
 * the judgement lives in a `.mjs` both runtimes import and is held to account
 * from Node.
 */
import {
  IMAGE_BLOCKED_COPY,
  imageVerdict,
} from '../../../supabase/functions/_shared/imageVerdict.mjs';
import { IMAGE_SCREENING } from '../../../supabase/functions/_shared/imageScreening.mjs';

type Screening = Parameters<typeof imageVerdict>[0];

/** The wire carries shapes the JSDoc does not promise. See screeningVerdict.test.ts. */
const offWire = (v: unknown) => v as Screening;

describe('an image answer that arrived', () => {
  it('allows a photo the model called clean', () => {
    expect(imageVerdict({ status: 'ok', value: { harmful: false, reason: '' } })).toEqual({
      verdict: 'ok',
      reason: '',
    });
  });

  it('blocks a photo the model called harmful, and carries its reason', () => {
    expect(
      imageVerdict({ status: 'ok', value: { harmful: true, reason: 'The image shows nudity.' } }),
    ).toEqual({ verdict: 'blocked', reason: 'The image shows nudity.' });
  });

  it('publishes only on an explicit false, never on a field it cannot read', () => {
    // The opposite polarity to `screeningVerdict`, on purpose. There a garbled
    // field must not become an accusation; here it must not become a picture.
    for (const harmful of ['false', 0, undefined, null, 'no']) {
      expect(imageVerdict(offWire({ status: 'ok', value: { harmful } })).verdict).toBe('blocked');
    }
  });

  it('trims a long reason', () => {
    const { reason } = imageVerdict({
      status: 'ok',
      value: { harmful: true, reason: 'x'.repeat(400) },
    });
    expect(reason).toHaveLength(160);
  });
});

describe('an image answer that did not', () => {
  it('does NOT publish when the call never arrived', () => {
    // Half the point of this file. Its sibling resolves this `ok` and is right
    // to, because the cost there is a sentence nobody screened. The cost here
    // is an unscreened picture on strangers' screens, which is the thing app
    // stores remove apps for. So it does not publish.
    expect(imageVerdict({ status: 'unavailable' }).verdict).not.toBe('ok');
  });

  it('says so rather than blocking, so nobody deletes a photo over an outage', () => {
    // The other half, and the distinction the callers act on. `blocked` means
    // the model spoke and both screeners delete the object; a timeout or a 429
    // is not evidence about the picture, and deleting on it would mean a Gemini
    // incident silently destroys the photo of everyone who uploads during it —
    // each told only `IMAGE_BLOCKED_COPY`, each retry failing the same way.
    //
    // `unproven` holds the image back without destroying it: an avatar stays
    // `pending` and renders initials, which is exactly as invisible as a
    // refusal, and `resumePendingAvatar` asks again on the next launch.
    expect(imageVerdict({ status: 'unavailable' })).toEqual({
      verdict: 'unproven',
      reason: '',
    });
  });

  it('blocks when the model refused to answer', () => {
    // A hosted model's safety filter stopping its own response is an answer
    // arriving by another route, on exactly the images this screening exists
    // to catch.
    expect(imageVerdict({ status: 'refused' })).toEqual({ verdict: 'blocked', reason: '' });
  });

  it('blocks on a shape it cannot understand, rather than retrying it forever', () => {
    // Nothing this module fails to parse may publish an image — and none of it
    // resolves `unproven` either. That status is for a fault this module knows
    // and expects to clear; an unreadable reply is a surprise, and retrying a
    // surprise leaves the image cycling against something that is not going to
    // fix itself.
    for (const junk of [undefined, null, {}, { status: 'something-new' }, { status: 'ok' }]) {
      expect(imageVerdict(offWire(junk)).verdict).toBe('blocked');
    }
  });
});

describe('what the person is told', () => {
  it('does not explain what the model objected to, and does not argue', () => {
    expect(IMAGE_BLOCKED_COPY.length).toBeGreaterThan(0);
    expect(IMAGE_BLOCKED_COPY).not.toMatch(/sexual|nudity|violen|gore|hate|symbol|explicit/i);
  });
});

describe('the prompt', () => {
  it('asks about the three things, and says no to the rest', () => {
    // Not a proxy for the model's behaviour — just a guard on the two edits that
    // would quietly turn this into "flag anything you dislike".
    expect(IMAGE_SCREENING).toMatch(/sexual content, graphic violence, or a hate symbol/);
    expect(IMAGE_SCREENING).toMatch(/Answer "no" for absolutely everything else/);
    expect(IMAGE_SCREENING).toMatch(/If you are unsure, answer "no"/);
  });
});
