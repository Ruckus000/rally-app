/**
 * Closed weeks, against the real policy.
 *
 * `week_rollups` is the one table a client may write but never rewrite. It had a
 * select policy and no insert path at all until Wave D, and the comment above
 * that policy still said both it and `notifications` were "written server-side"
 * — a plan rather than a description, since rollover happens in the reducer and
 * no trigger can see it.
 *
 * Three things need to be true and none of them is provable against the unit
 * fake, which enforces its own idea of the schema rather than Postgres's:
 * a person may write their own week, may not write anybody else's, and a
 * **replay is absorbed** rather than failing forever at the head of the outbox.
 */
import { asAnon, asUser, idOf } from '../support/clients';

const WEEK = '2026-08-03';

const rollup = (profileId: string, week = WEEK) => ({
  profile_id: profileId,
  week_start: week,
  points: 150,
  done: 6,
  total: 6,
  perfect: true,
  streak_held: true,
});

describe('writing your own week', () => {
  it('accepts it', async () => {
    const { error } = await asUser('maya').from('week_rollups').insert(rollup(idOf('maya')));
    expect(error).toBeNull();

    const { data } = await asUser('maya')
      .from('week_rollups')
      .select('points,done,total')
      .eq('week_start', WEEK);
    expect(data).toEqual([{ points: 150, done: 6, total: 6 }]);
  });

  it('absorbs a replay instead of failing forever', async () => {
    await asUser('maya').from('week_rollups').insert(rollup(idOf('maya')));

    // Exactly what the transport sends: PostgREST turns `ignoreDuplicates` into
    // ON CONFLICT DO NOTHING, which needs no update privilege. Without this the
    // second attempt is a 23505 that no retry can clear, and the entry sits at
    // the head of the queue until it is retired into dead letters.
    const { error } = await asUser('maya')
      .from('week_rollups')
      .upsert({ ...rollup(idOf('maya')), points: 999 }, {
        onConflict: 'profile_id,week_start',
        ignoreDuplicates: true,
      });
    expect(error).toBeNull();

    // And the first row is untouched — a replay must not rewrite the week.
    const { data } = await asUser('maya')
      .from('week_rollups')
      .select('points')
      .eq('week_start', WEEK);
    expect(data).toEqual([{ points: 150 }]);
  });
});

describe('writing somebody else’s', () => {
  it('is refused', async () => {
    const { error } = await asUser('maya').from('week_rollups').insert(rollup(idOf('jordan')));

    // 42501: the `with check` predicate, not a missing grant.
    expect(error?.code).toBe('42501');
  });

  it('is refused even when signed in as nobody', async () => {
    const { error } = await asAnon().from('week_rollups').insert(rollup(idOf('maya')));
    expect(error).not.toBeNull();
  });
});

describe('what stays shut', () => {
  it('refuses an update, because a week closes once', async () => {
    await asUser('maya').from('week_rollups').insert(rollup(idOf('maya')));

    const { error } = await asUser('maya')
      .from('week_rollups')
      .update({ points: 999 })
      .eq('week_start', WEEK);

    // No update policy and no update grant. Deliberate: there is no second
    // version of a closed week, and an update path would exist only to be a way
    // of rewriting history.
    expect(error).not.toBeNull();
  });

  it('refuses a delete', async () => {
    await asUser('maya').from('week_rollups').insert(rollup(idOf('maya')));

    const { error } = await asUser('maya')
      .from('week_rollups')
      .delete()
      .eq('week_start', WEEK);
    expect(error).not.toBeNull();
  });
});

describe('reading them back', () => {
  it('gives you your own weeks', async () => {
    await asUser('maya').from('week_rollups').insert(rollup(idOf('maya'), '2026-07-27'));
    await asUser('maya').from('week_rollups').insert(rollup(idOf('maya'), '2026-08-03'));

    const { data } = await asUser('maya')
      .from('week_rollups')
      .select('week_start')
      .eq('profile_id', idOf('maya'))
      .order('week_start', { ascending: true });

    expect(data?.map((r) => r.week_start)).toEqual(['2026-07-27', '2026-08-03']);
  });

  it('gives a circle-mate yours, which the select policy has always allowed', async () => {
    await asUser('maya').from('week_rollups').insert(rollup(idOf('maya')));

    // `dre` is in the basement circle with maya, so `shares_circle_with` reaches
    // her rows. Asserted rather than assumed: this is the half of the policy a
    // leaderboard would read, and it predates Wave D.
    const { data, error } = await asUser('dre')
      .from('week_rollups')
      .select('points')
      .eq('profile_id', idOf('maya'));

    expect(error).toBeNull();
    expect(data).toEqual([{ points: 150 }]);
  });

  it('does not give a stranger yours', async () => {
    await asUser('maya').from('week_rollups').insert(rollup(idOf('maya')));

    // `jordan` is in the outsiders circle and shares none with maya, so neither
    // half of the select policy reaches her.
    const { data, error } = await asUser('jordan')
      .from('week_rollups')
      .select('*')
      .eq('profile_id', idOf('maya'));

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
