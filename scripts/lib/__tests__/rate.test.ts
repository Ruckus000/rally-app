/**
 * The scripts price goals by the same band as the server, and never invent one.
 *
 * Two things are checked here and they are not the same thing.
 *
 * The band is a copy. `rate.mjs` restates 10/60/5 because it is a `.mjs` script
 * and the two files that own those numbers are TypeScript. That copy is the
 * only one of the three nothing pinned — `points.test.ts` already holds the
 * app's against the server's — so it is read off disk here for the same reason
 * and by the same method: a comment saying "keep these in step" is not the same
 * thing as them being in step.
 *
 * The absent price is a rule. A pricing call that did not answer leaves no
 * number, and `rateGoal` says so rather than choosing one. The edge function
 * chooses — the category's price — because somebody is mid-sentence and staking
 * must survive a model being down. A drafting run has no such duty, and this
 * file used to answer 10: the bottom of the band, indistinguishable from a real
 * price, written into `bot_goal_candidates` for a human to approve without ever
 * learning the goal had not been priced.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../llm.mjs', () => ({
  RUBRIC: 'rubric',
  SCREENING: 'screening',
  complete: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { complete } = require('../llm.mjs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { POINT_MAX, POINT_MIN, POINT_STEP, clamp, rateGoal } = require('../rate.mjs');

const PRICED = { status: 'ok', value: { points: 45 } };
const SCREENED = { status: 'ok', value: { harmful: false, reason: '' } };

/** The two calls go out together, so the mock answers by which prompt it got. */
function answering({ pricing, screening }: { pricing: unknown; screening: unknown }) {
  complete.mockImplementation(({ system }: { system: string }) =>
    Promise.resolve(system === 'rubric' ? pricing : screening),
  );
}

beforeEach(() => complete.mockReset());

describe('a price the model did not give', () => {
  it('is null, not the bottom of the band', async () => {
    answering({ pricing: { status: 'refused' }, screening: SCREENED });

    const rated = await rateGoal({ title: 'Walk 30 minutes every morning', category: 'Fitness' });

    expect(rated.points).toBeNull();
    expect(rated.points).not.toBe(POINT_MIN);
  });

  it('is null however the pricing call failed', async () => {
    for (const pricing of [{ status: 'refused' }, { status: 'unavailable' }]) {
      answering({ pricing, screening: SCREENED });
      expect((await rateGoal({ title: 'Walk 30 minutes', category: 'Work' })).points).toBeNull();
    }
  });

  it('still screens the goal — the two calls are independent', async () => {
    // The half that answered is still worth having. A goal nobody could price
    // is not thereby a goal nobody screened.
    answering({
      pricing: { status: 'unavailable' },
      screening: { status: 'ok', value: { harmful: true, reason: 'Not one to stake.' } },
    });

    const rated = await rateGoal({ title: 'Cut myself when I feel numb', category: 'Mind' });

    expect(rated.points).toBeNull();
    expect(rated.verdict).toBe('blocked');
    expect(rated.reason).toBe('Not one to stake.');
  });

  it('gives a number when the model gave one', async () => {
    answering({ pricing: PRICED, screening: SCREENED });

    expect((await rateGoal({ title: 'Bike to work three days', category: 'Fitness' })).points).toBe(
      45,
    );
  });
});

describe('the band, held against the server’s copy', () => {
  const server = readFileSync(
    join(__dirname, '../../../supabase/functions/_shared/points.ts'),
    'utf8',
  );

  const constant = (name: string): number => {
    const match = server.match(new RegExp(`export const ${name} = (\\d+)`));
    if (!match) throw new Error(`${name} is not exported from the server's points.ts`);
    return Number(match[1]);
  };

  it('states the same three numbers', () => {
    expect(POINT_MIN).toBe(constant('POINT_MIN'));
    expect(POINT_MAX).toBe(constant('POINT_MAX'));
    expect(POINT_STEP).toBe(constant('POINT_STEP'));
  });

  it('snaps and holds a price the same way', () => {
    // Only the branch that matters now: a number the model actually returned.
    // The two differ on an absent one, which is the point of the change above.
    for (const [given, expected] of [
      [32, 30],
      [33, 35],
      [57, 55],
      [0, POINT_MIN],
      [1000, POINT_MAX],
    ]) {
      expect(clamp(given)).toBe(expected);
    }
  });
});
