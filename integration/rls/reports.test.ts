/**
 * reports: the table nobody reads.
 *
 * `device_tokens` is the only other table in this schema with this posture, and
 * this one goes further. There, `service_role` still holds everything, because
 * a delivery job has to read a token to send a push. Here nothing does: RLS on,
 * **zero policies**, and the grant revoked from `anon`, `authenticated` *and*
 * `service_role`. The owner is the only role that reaches it at all.
 *
 * That is not paranoia about a small table. A readable `reports` is a list of
 * who accused whom, and that list is more dangerous than the reports are
 * useful — the one thing a person filing a report is owed is that the person
 * they filed it about cannot find out. `authenticated` holding SELECT would
 * make the whole list one bad filter away from being enumerable; `service_role`
 * holding the platform default would have left TRUNCATE — which ignores row
 * security entirely — on the moderation evidence table, one stray statement
 * from erasing every report anyone has ever filed.
 *
 * So the assertions here are almost all negative, and the sharpest of them is
 * not "you cannot read somebody else's report" but "you cannot read your own".
 * A SELECT policy added later for a My Reports screen is one line, and it is
 * the line that turns this table into a directory of accusations.
 *
 * `reports` is not a domain table and is not in `resetDomainTables`' truncate
 * list, so this file clears it itself — over the direct connection, since no
 * client role can reach it to clean up after a test.
 */
import { asAnon, asUser, idOf } from '../support/clients';
import { sql } from '../support/reset';
import { type SeedHandle } from '../fixtures/world';

/** Not a foreign key on the table, so any uuid is a well-formed subject. */
const SUBJECT = '55555555-5555-4555-8555-555555555555';

type Row = {
  id: string;
  reporter_id: string;
  subject_kind: string;
  subject_id: string;
  reason: string;
  resolution: string | null;
  resolved_at: string | null;
};

const file = (
  who: SeedHandle,
  reason = 'harassment',
  kind = 'note',
  subject: string = SUBJECT,
) => asUser(who).rpc('report_content', { p_subject_kind: kind, p_subject_id: subject, p_reason: reason });

/** The only reader there is: the owner, over the direct connection. */
const allReports = () =>
  sql<Row>('select * from public.reports order by created_at');

afterEach(async () => {
  await sql('delete from public.reports');
});

describe('filing a report', () => {
  it('writes a row attributed to whoever is signed in', async () => {
    const { error } = await file('maya', 'harassment', 'note');

    expect(error).toBeNull();

    const rows = await allReports();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reporter_id: idOf('maya'),
      subject_kind: 'note',
      subject_id: SUBJECT,
      reason: 'harassment',
    });
  });

  it('takes no reporter argument, so there is no reporter to forge', async () => {
    // `auth.uid()` is read *inside* the function. An actor you accept as a
    // parameter is an actor the caller chooses, and a report filed in somebody
    // else's name is both a false accusation and a way to make a person look
    // like a serial reporter to whoever reads the queue.
    await file('dre');

    const rows = await allReports();
    expect(rows[0].reporter_id).toBe(idOf('dre'));
    expect(rows[0].reporter_id).not.toBe(idOf('maya'));
  });

  it('opens unresolved, with both outcome columns empty', async () => {
    await file('maya');

    const rows = await allReports();
    expect(rows[0].resolution).toBeNull();
    expect(rows[0].resolved_at).toBeNull();
  });

  it('can be filed about somebody you share no circle with', async () => {
    // Deliberate. The Global feed shows `aud = 'everyone'` tasks from people
    // you share nothing with, so the person you most need to report is
    // frequently a stranger. A visibility check here would refuse exactly the
    // reports that matter most.
    const { error } = await file('jordan', 'spam', 'task');
    expect(error).toBeNull();
    expect(await allReports()).toHaveLength(1);
  });

  it.each(['harassment', 'spam', 'sexual', 'violence', 'self_harm', 'other'])(
    'accepts the reason %s',
    async (reason) => {
      const { error } = await file('maya', reason);
      expect(error).toBeNull();
    },
  );

  it.each(['task', 'note', 'profile'])('accepts the subject kind %s', async (kind) => {
    const { error } = await file('maya', 'other', kind);
    expect(error).toBeNull();
  });
});

describe('reports are not deduplicated, and that is a decision', () => {
  it('filing the same thing twice leaves two rows', async () => {
    // Pinned because it looks like a bug and is not. Reporting the same thing
    // twice usually means it happened again, or that nothing visibly came of
    // the first one — a second report is a signal, and an `on conflict do
    // nothing` here would make the app look like it did nothing while telling
    // the user it had. Somebody will eventually want to "fix" the duplicate;
    // this test is what makes that a deliberate act.
    expect((await file('maya', 'harassment', 'note')).error).toBeNull();
    expect((await file('maya', 'harassment', 'note')).error).toBeNull();

    const rows = await allReports();
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it('and two people reporting the same thing leave two rows', async () => {
    await file('maya');
    await file('dre');

    const rows = await allReports();
    expect(rows.map((r) => r.reporter_id).sort()).toEqual([idOf('maya'), idOf('dre')].sort());
  });
});

describe('the values the queue is allowed to contain', () => {
  it('rejects a subject kind nothing produces', async () => {
    // 'avatar' is the specific one worth naming: profile photos do not exist
    // in this app, so permitting it would be a comment pretending to be a
    // check — it would read as though the moderation queue handled images, and
    // the first person to believe that would be wrong.
    const { error } = await file('maya', 'other', 'avatar');
    expect(error?.code).toBe('23514');
  });

  it('rejects a subject kind that is simply made up', async () => {
    const { error } = await file('maya', 'other', 'circle');
    expect(error?.code).toBe('23514');
  });

  it('rejects a reason outside the fixed list', async () => {
    const { error } = await file('maya', 'i_just_dont_like_them');
    expect(error?.code).toBe('23514');
  });

  it('rejects an empty reason', async () => {
    const { error } = await file('maya', '');
    expect(error?.code).toBe('23514');
  });

  it('and leaves nothing behind when it refuses', async () => {
    await file('maya', 'nonsense');
    expect(await allReports()).toEqual([]);
  });
});

describe('nobody reads this table', () => {
  it('not the person who filed the report', async () => {
    // The load-bearing one. `authenticated` holds no privilege on `reports`, so
    // this is refused before RLS is even consulted — stronger than "zero rows",
    // and the reason `report_content` is a SECURITY DEFINER function rather
    // than an insert policy: a client that wrote the table directly would need
    // a grant, and a grant is what this denies.
    await file('maya');

    const { error } = await asUser('maya').from('reports').select('*');
    expect(error?.code).toBe('42501');
  });

  it('not the person it was filed about, which is the whole point', async () => {
    await file('maya', 'harassment', 'profile', idOf('dre'));

    const { error } = await asUser('dre').from('reports').select('*');
    expect(error?.code).toBe('42501');
  });

  it('not a signed-out client', async () => {
    const { error } = await asAnon().from('reports').select('*');
    expect(error?.code).toBe('42501');
  });

  it('and the row really is there, so those are refusals rather than emptiness', async () => {
    await file('maya');
    expect(await allReports()).toHaveLength(1);
  });

  it('holds no privilege for anon, authenticated or service_role', async () => {
    // Asserted at the grant rather than through a request. `service_role` is
    // the half a platform default first got wrong: `20260815225639` left a
    // default handing every new table in `public` to all three roles, and that
    // default carried TRUNCATE — which ignores row security entirely. Nothing
    // reads this table yet, so there is nothing to keep.
    const rows = await sql<{ role: string; priv: string; can: boolean }>(`
      select r.rolname as role, p.priv,
             has_table_privilege(r.rolname, 'public.reports', p.priv) as can
      from (select unnest(array['anon','authenticated','service_role']) as rolname) r
      cross join (select unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) as priv) p`);

    expect(rows).toHaveLength(15);
    for (const row of rows) {
      expect(`${row.role} ${row.priv} ${row.can}`).toBe(`${row.role} ${row.priv} false`);
    }
  });
});

describe('nobody writes this table by hand either', () => {
  it('a signed-in client cannot insert a report directly', async () => {
    const { error } = await asUser('maya').from('reports').insert({
      reporter_id: idOf('maya'),
      subject_kind: 'note',
      subject_id: SUBJECT,
      reason: 'spam',
    });

    expect(error?.code).toBe('42501');
    expect(await allReports()).toEqual([]);
  });

  it('nor update one, nor delete one', async () => {
    // No grant at all, so these fail on privilege rather than on policy —
    // which is what keeps the function the only door. A DELETE that worked
    // would let the subject of a report erase the evidence.
    await file('maya');
    const maya = asUser('maya');

    expect((await maya.from('reports').update({ resolution: 'nothing to see' }).eq('subject_id', SUBJECT)).error?.code)
      .toBe('42501');
    expect((await maya.from('reports').delete().eq('subject_id', SUBJECT)).error?.code).toBe('42501');

    expect(await allReports()).toHaveLength(1);
  });
});

describe('none of the three functions are reachable signed out', () => {
  it('anon holds no EXECUTE on report_content, block_person or unblock_person', async () => {
    // Postgres grants EXECUTE to PUBLIC on every new function, so a SECURITY
    // DEFINER function in `public` is an open endpoint until told otherwise.
    // All three write as their owner. Asserted at the grant rather than
    // through a request, because the behavioural test below passes with or
    // without it — the bodies also check `auth.uid()` — and this is the one
    // that decides whether an unauthenticated request reaches the code at all.
    const rows = await sql<{ fn: string; can: boolean }>(`
      select p.proname as fn, has_function_privilege('anon', p.oid, 'EXECUTE') as can
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('report_content', 'block_person', 'unblock_person')`);

    expect(rows).toHaveLength(3);
    for (const r of rows) expect(`${r.fn} ${r.can}`).toBe(`${r.fn} false`);
  });

  it('and PUBLIC holds none either, which is the grant that is easy to forget', async () => {
    // Read out of the ACL rather than asked with `has_function_privilege`,
    // because PUBLIC is a pseudo-role that function takes no answer about. An
    // aclitem granted to PUBLIC renders with an empty grantee — `=X/postgres`
    // — so the presence of one is exactly the leak: every future role, and
    // every role that exists now, holding EXECUTE by default.
    const rows = await sql<{ fn: string; public_execute: boolean }>(`
      select p.proname as fn,
             exists (
               select 1 from unnest(coalesce(p.proacl, array[]::aclitem[])) a
               where a::text like '=%'
             ) as public_execute
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('report_content', 'block_person', 'unblock_person')`);

    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(`${r.fn} ${r.public_execute}`).toBe(`${r.fn} false`);
    }
  });

  it.each([
    ['report_content', { p_subject_kind: 'note', p_subject_id: SUBJECT, p_reason: 'spam' }],
    ['block_person', { p_blocked: SUBJECT }],
    ['unblock_person', { p_blocked: SUBJECT }],
  ])('a signed-out call to %s is refused', async (fn, args) => {
    const { error } = await asAnon().rpc(fn as never, args as never);

    expect(error).not.toBeNull();
    expect(await allReports()).toEqual([]);
  });

  it('and the private visibility helpers are not reachable over REST at all', async () => {
    // `private` is absent from PostgREST's exposed schemas, so `block_between`
    // and `i_blocked` cannot be called directly. That matters more than usual
    // here: `i_blocked` answers "have I blocked this person", and the symmetric
    // one answers "is there a block between us" — which, callable with any
    // uuid, would be a way of discovering that somebody blocked you.
    for (const fn of ['block_between', 'i_blocked']) {
      const { error } = await asUser('maya').rpc(fn as never, { other_profile: idOf('dre') });
      expect(error?.code).toBe('PGRST202');
    }
  });
});
