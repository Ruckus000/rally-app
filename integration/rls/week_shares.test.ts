/**
 * A finished week somebody chose to show.
 *
 * Deliberately not a column on `week_rollups`, and the reason is a timing one
 * worth restating where the tests are: a rollup is written at *rollover*, and
 * the card that offers to post is on screen during the week it is about. There
 * is no row to flag. Letting the share create one early would let a mid-week
 * snapshot become the Ledger's permanent record of that week, because
 * `rollup.add` upserts with `ignoreDuplicates` and would decline to correct it.
 *
 * So this table holds a different fact, and these tests are about the three
 * things that makes it: you may write your own, you may not write anybody
 * else's, and a row that does not describe a finished week is refused by the
 * database rather than by the screen that draws it.
 */
import { asAnon, asUser, idOf } from '../support/clients';

const WEEK = '2026-08-10';

const share = (profileId: string, over: Record<string, unknown> = {}) => ({
  profile_id: profileId,
  week_start: WEEK,
  points: 150,
  done: 6,
  total: 6,
  streak: 5,
  ...over,
});

describe('posting your own week', () => {
  it('accepts it', async () => {
    const { error } = await asUser('maya').from('week_shares').insert(share(idOf('maya')));
    expect(error).toBeNull();

    const { data } = await asUser('maya')
      .from('week_shares')
      .select('points,done,total,streak')
      .eq('week_start', WEEK);
    expect(data).toEqual([{ points: 150, done: 6, total: 6, streak: 5 }]);
  });

  it('refuses one that is not actually finished', async () => {
    // The constraint is what makes the table mean something. The card only
    // exists for a week with every goal closed, so a row saying otherwise is a
    // client with a bug — and this is where that stops, rather than where it
    // starts being rendered to other people.
    const { error } = await asUser('maya')
      .from('week_shares')
      .insert(share(idOf('maya'), { done: 4, total: 6 }));

    expect(error?.code).toBe('23514');
  });

  it('refuses an empty week', async () => {
    const { error } = await asUser('maya')
      .from('week_shares')
      .insert(share(idOf('maya'), { done: 0, total: 0 }));

    expect(error?.code).toBe('23514');
  });

  it('refuses somebody else’s', async () => {
    const { error } = await asUser('dre').from('week_shares').insert(share(idOf('maya')));
    expect(error?.code).toBe('42501');
  });

  it('refuses a second post of the same week rather than rewriting it', async () => {
    // Insert-only, like rollups. A post is a thing that was said; editing it
    // after the fact is a different feature with its own questions.
    await asUser('maya').from('week_shares').insert(share(idOf('maya')));

    const { error } = await asUser('maya')
      .from('week_shares')
      .insert(share(idOf('maya'), { points: 999 }));

    expect(error?.code).toBe('23505');
  });

  it('refuses an update and a delete outright', async () => {
    await asUser('maya').from('week_shares').insert(share(idOf('maya')));

    const upd = await asUser('maya')
      .from('week_shares')
      .update({ points: 999 })
      .eq('week_start', WEEK);
    expect(upd.error?.code).toBe('42501');

    const del = await asUser('maya').from('week_shares').delete().eq('week_start', WEEK);
    expect(del.error?.code).toBe('42501');
  });

  it('is refused entirely to a signed-out caller', async () => {
    const { error } = await asAnon().from('week_shares').select('*');
    expect(error).not.toBeNull();
  });
});

describe('reading them back', () => {
  beforeEach(async () => {
    const { error } = await asUser('maya').from('week_shares').insert(share(idOf('maya')));
    expect(error).toBeNull();
  });

  it('gives a circle-mate yours', async () => {
    const { data, error } = await asUser('dre')
      .from('week_shares')
      .select('points')
      .eq('profile_id', idOf('maya'));

    expect(error).toBeNull();
    expect(data).toEqual([{ points: 150 }]);
  });

  it('gives somebody who shares a different circle with you yours', async () => {
    // sofia shares gym, not basement. A week is not scoped to a room, so she
    // sees it — which is the whole reason this is not per-circle.
    const { data } = await asUser('sofia')
      .from('week_shares')
      .select('points')
      .eq('profile_id', idOf('maya'));

    expect(data).toEqual([{ points: 150 }]);
  });

  it('does not give a stranger yours', async () => {
    const { data, error } = await asUser('jordan')
      .from('week_shares')
      .select('*')
      .eq('profile_id', idOf('maya'));

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
