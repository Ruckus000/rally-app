/**
 * The three tables the client reads but does not author.
 *
 * week_rollups and notifications are written when a week closes or when
 * something happens to you — server-side work, not client work. Their tests
 * are therefore as much about what a client *cannot* write as what it can see.
 * invites is the one of the three a client does write, and accepting one is
 * the write path the repair migration added.
 */
import { asService, asUser, idOf } from '../support/clients';
import { CIRCLE_IDS, type SeedHandle } from '../fixtures/world';

const WEEK = '2026-08-03';
const PRIOR_WEEK = '2026-07-27';

type Rollup = {
  profile_id: string;
  week_start: string;
  points?: number;
  done?: number;
  total?: number;
  perfect?: boolean;
  streak_held?: boolean;
};

const seedRollup = async (handle: SeedHandle, week: string, extra: Partial<Rollup> = {}) => {
  const row: Rollup = { profile_id: idOf(handle), week_start: week, ...extra };
  const { error } = await asService().from('week_rollups').insert(row);
  expect(error).toBeNull();
  return row;
};

const seedNotification = async (
  recipient: SeedHandle,
  tier: 'needs' | 'week' | 'circle',
  kind: string,
  payload: Record<string, unknown> = {},
) => {
  const { data, error } = await asService()
    .from('notifications')
    .insert({ recipient_id: idOf(recipient), tier, kind, payload })
    .select()
    .single();
  expect(error).toBeNull();
  return data as { id: string; read_at: string | null; payload: Record<string, unknown> };
};

const seedInvite = async (
  circle: keyof typeof CIRCLE_IDS,
  inviter: SeedHandle,
  invitee: SeedHandle | null,
) => {
  const { data, error } = await asService()
    .from('invites')
    .insert({
      circle_id: CIRCLE_IDS[circle],
      inviter_id: idOf(inviter),
      invitee_id: invitee ? idOf(invitee) : null,
    })
    .select()
    .single();
  expect(error).toBeNull();
  return data as { id: string; accepted_at: string | null };
};

// ─── week_rollups ──────────────────────────────────────────────────────────

describe('week_rollups visibility', () => {
  it('shows you your own closed week', async () => {
    await seedRollup('maya', WEEK, { points: 42, done: 6, total: 7 });

    const { data, error } = await asUser('maya')
      .from('week_rollups')
      .select('points,done,total')
      .eq('profile_id', idOf('maya'));

    expect(error).toBeNull();
    expect(data).toEqual([{ points: 42, done: 6, total: 7 }]);
  });

  it('shows you a circle-mates closed week, because the ledger is shared', async () => {
    await seedRollup('dre', WEEK, { points: 30 });

    const { data } = await asUser('maya')
      .from('week_rollups')
      .select('points')
      .eq('profile_id', idOf('dre'));

    expect(data).toEqual([{ points: 30 }]);
  });

  it('shows a gym-only circle-mate too, not just the basement', async () => {
    // sofia shares gym with maya but not basement; sharing any circle is enough.
    await seedRollup('sofia', WEEK, { points: 11 });

    const { data } = await asUser('maya')
      .from('week_rollups')
      .select('points')
      .eq('profile_id', idOf('sofia'));

    expect(data).toEqual([{ points: 11 }]);
  });

  it('hides the week of someone you share no circle with', async () => {
    await seedRollup('jordan', WEEK, { points: 99 });

    const { data, error } = await asUser('maya')
      .from('week_rollups')
      .select('points')
      .eq('profile_id', idOf('jordan'));

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('returns every visible week and no invisible one in a plain unfiltered read', async () => {
    await seedRollup('maya', WEEK);
    await seedRollup('maya', PRIOR_WEEK);
    await seedRollup('nana', WEEK);
    await seedRollup('tomas', WEEK);

    const { data } = await asUser('maya').from('week_rollups').select('profile_id');
    const seen = (data ?? []).map((r: { profile_id: string }) => r.profile_id);

    expect(seen).toHaveLength(3);
    expect(seen).not.toContain(idOf('tomas'));
  });
});

describe('week_rollups are not client-writable', () => {
  // A rollup is written server-side when a week closes (phase 5). If a client
  // could author one it could mint its own points and streaks, so the absence
  // of any insert/update/delete policy is the feature under test here.
  it('refuses an insert even of your own row', async () => {
    const { error } = await asUser('maya')
      .from('week_rollups')
      .insert({ profile_id: idOf('maya'), week_start: WEEK, points: 999 });

    expect(error?.code).toBe('42501');
  });

  it('refuses an update of your own row loudly, not silently', async () => {
    await seedRollup('maya', WEEK, { points: 42 });

    const { error } = await asUser('maya')
      .from('week_rollups')
      .update({ points: 999 })
      .eq('profile_id', idOf('maya'));

    // Not the usual silent no-op: `authenticated` holds only SELECT on this
    // table, so the grant refuses the statement before RLS is ever consulted.
    expect(error?.code).toBe('42501');
  });

  it('refuses a delete of your own row', async () => {
    await seedRollup('maya', WEEK);

    const { error } = await asUser('maya')
      .from('week_rollups')
      .delete()
      .eq('profile_id', idOf('maya'));

    expect(error?.code).toBe('42501');
  });
});

// ─── notifications ─────────────────────────────────────────────────────────

describe('notifications visibility', () => {
  it.each([
    ['needs', 'note_received'],
    ['week', 'week_closed'],
    ['circle', 'circle_joined'],
  ] as const)('delivers a %s-tier notification to its recipient', async (tier, kind) => {
    await seedNotification('maya', tier, kind);

    const { data, error } = await asUser('maya').from('notifications').select('tier,kind');

    expect(error).toBeNull();
    expect(data).toEqual([{ tier, kind }]);
  });

  it('round-trips the payload as jsonb, not as a string', async () => {
    const payload = { actor: 'dre', route: '/needs', count: 3, aging: { days: 2 } };
    await seedNotification('maya', 'needs', 'nudge', payload);

    const { data } = await asUser('maya').from('notifications').select('payload');

    expect(data?.[0]?.payload).toEqual(payload);
  });

  it('hides a circle-mates notifications, unlike rollups', async () => {
    // week_rollups widens to circle-mates; notifications never do. dre being
    // in the basement with maya must not change that.
    await seedNotification('dre', 'needs', 'note_received');

    const { data, error } = await asUser('maya').from('notifications').select('kind');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('hides a strangers notifications', async () => {
    await seedNotification('jordan', 'circle', 'circle_joined');

    const { data } = await asUser('maya').from('notifications').select('kind');
    expect(data).toEqual([]);
  });
});

describe('marking a notification read', () => {
  it('lets you mark your own read', async () => {
    const seeded = await seedNotification('maya', 'needs', 'note_received');
    const readAt = new Date().toISOString();

    const { data, error } = await asUser('maya')
      .from('notifications')
      .update({ read_at: readAt })
      .eq('id', seeded.id)
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.read_at).not.toBeNull();
  });

  it('does not let you mark someone elses read', async () => {
    const seeded = await seedNotification('dre', 'needs', 'note_received');

    const { data, error } = await asUser('maya')
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', seeded.id)
      .select();

    // Refused by USING, which filters rather than raises: PostgREST reports
    // success over zero matched rows.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('leaves the other persons notification genuinely unread', async () => {
    const seeded = await seedNotification('dre', 'needs', 'note_received');

    await asUser('maya')
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', seeded.id);

    const { data } = await asService().from('notifications').select('read_at').eq('id', seeded.id);
    expect(data?.[0]?.read_at).toBeNull();
  });

  it('cannot hand your own notification to someone else while updating it', async () => {
    const seeded = await seedNotification('maya', 'week', 'week_closed');

    const { error } = await asUser('maya')
      .from('notifications')
      .update({ recipient_id: idOf('dre') })
      .eq('id', seeded.id);

    // A WITH CHECK failure raises where a USING failure would have filtered,
    // so this one *is* an error rather than an empty result.
    expect(error?.code).toBe('42501');
  });
});

describe('notifications cannot be fabricated by a client', () => {
  it('refuses an insert addressed to yourself', async () => {
    const { error } = await asUser('maya')
      .from('notifications')
      .insert({ recipient_id: idOf('maya'), tier: 'needs', kind: 'invented' });

    expect(error?.code).toBe('42501');
  });

  it('refuses an insert addressed to someone else', async () => {
    const { error } = await asUser('maya')
      .from('notifications')
      .insert({ recipient_id: idOf('dre'), tier: 'circle', kind: 'invented' });

    expect(error?.code).toBe('42501');
  });
});

// ─── invites ───────────────────────────────────────────────────────────────

describe('invites visibility', () => {
  it('is visible to the inviter', async () => {
    const seeded = await seedInvite('basement', 'maya', 'sofia');

    const { data, error } = await asUser('maya').from('invites').select('id');

    expect(error).toBeNull();
    expect(data).toEqual([{ id: seeded.id }]);
  });

  it('is visible to the invitee, who is not yet in the circle', async () => {
    const seeded = await seedInvite('basement', 'maya', 'sofia');

    const { data } = await asUser('sofia').from('invites').select('id');
    expect(data).toEqual([{ id: seeded.id }]);
  });

  it('is invisible to a third party, even a member of that circle', async () => {
    // nana is in the basement, which is emphatically not the same as being a
    // party to this invite.
    await seedInvite('basement', 'maya', 'sofia');

    const { data, error } = await asUser('nana').from('invites').select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('is invisible to a stranger', async () => {
    await seedInvite('basement', 'maya', 'sofia');

    const { data } = await asUser('jordan').from('invites').select('id');
    expect(data).toEqual([]);
  });
});

describe('creating an invite', () => {
  it('is allowed for a member of the circle', async () => {
    const { data, error } = await asUser('maya')
      .from('invites')
      .insert({ circle_id: CIRCLE_IDS.basement, inviter_id: idOf('maya'), invitee_id: idOf('sofia') })
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it('is allowed with no invitee yet, which is the shareable-link case', async () => {
    const { error } = await asUser('maya')
      .from('invites')
      .insert({ circle_id: CIRCLE_IDS.basement, inviter_id: idOf('maya'), invitee_id: null });

    expect(error).toBeNull();
  });

  it('is refused for a circle you are not in', async () => {
    const { error } = await asUser('jordan')
      .from('invites')
      .insert({ circle_id: CIRCLE_IDS.basement, inviter_id: idOf('jordan'), invitee_id: idOf('tomas') });

    // An INSERT refused by RLS does raise — unlike an update or a delete.
    expect(error?.code).toBe('42501');
  });

  it('is refused for a circle you share with the invitee but are not in', async () => {
    // sofia shares gym with maya but is not in the basement, so she cannot
    // invite into it on maya's behalf or her own.
    const { error } = await asUser('sofia')
      .from('invites')
      .insert({ circle_id: CIRCLE_IDS.basement, inviter_id: idOf('sofia'), invitee_id: idOf('nana') });

    expect(error?.code).toBe('42501');
  });

  it('is refused when the inviter is not you, even in your own circle', async () => {
    const { error } = await asUser('maya')
      .from('invites')
      .insert({ circle_id: CIRCLE_IDS.basement, inviter_id: idOf('dre'), invitee_id: idOf('sofia') });

    expect(error?.code).toBe('42501');
  });
});

describe('accepting an invite', () => {
  it('lets the invitee set accepted_at', async () => {
    // invites_update did not exist until the repair migration; without it an
    // invite could be created and never accepted. This is that regression.
    const seeded = await seedInvite('basement', 'maya', 'sofia');

    const { data, error } = await asUser('sofia')
      .from('invites')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', seeded.id)
      .select();

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.accepted_at).not.toBeNull();
  });

  it('does not let the inviter accept on the invitees behalf', async () => {
    const seeded = await seedInvite('basement', 'maya', 'sofia');

    const { data, error } = await asUser('maya')
      .from('invites')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', seeded.id)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('leaves the invite genuinely unaccepted after the inviter tries', async () => {
    const seeded = await seedInvite('basement', 'maya', 'sofia');

    await asUser('maya')
      .from('invites')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', seeded.id);

    const { data } = await asService().from('invites').select('accepted_at').eq('id', seeded.id);
    expect(data?.[0]?.accepted_at).toBeNull();
  });

  it('does not let an uninvolved person accept', async () => {
    const seeded = await seedInvite('basement', 'maya', 'sofia');

    const { data } = await asUser('nana')
      .from('invites')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', seeded.id)
      .select();

    expect(data).toEqual([]);
  });

  it('cannot be redirected to a different invitee by the invitee', async () => {
    const seeded = await seedInvite('basement', 'maya', 'sofia');

    const { error } = await asUser('sofia')
      .from('invites')
      .update({ invitee_id: idOf('jordan') })
      .eq('id', seeded.id);

    expect(error?.code).toBe('42501');
  });
});
