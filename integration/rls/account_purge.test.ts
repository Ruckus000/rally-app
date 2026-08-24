/**
 * The fortnight running out, and what the cascade takes with it.
 *
 * `account_deletion.test.ts` covers the scheduling and the disappearing. This
 * covers the end: who `accounts_due_for_purge` names, who may ask it, and
 * whether deleting the `auth.users` row actually leaves nothing behind.
 *
 * **Every account in this file is created for it and deleted by it.** Not one
 * assertion touches a seeded user, and that is not tidiness — `profiles` and
 * `auth.users` are deliberately outside `resetDomainTables`' truncate list
 * because they come from `seed.sql`, so deleting maya here would delete her for
 * every file that runs afterwards, and the failures would land somewhere else
 * entirely.
 *
 * The clock is moved rather than waited for: `deleted_at` is backdated over
 * the direct `pg` connection. A fourteen-day window cannot be tested any other
 * way, and a test that took its window as a parameter would be testing a
 * function this schema deliberately does not have — see the migration on why
 * `accounts_due_for_purge` takes no arguments.
 *
 * What is *not* here: the edge function, the schedule firing, and the HTTP
 * call. `cron` running at 03:17 and `net.http_post` reaching a function are
 * infrastructure this suite has no way to observe, and the Vault secrets that
 * would make the nudge fire are deliberately absent so that no integration run
 * ever calls out. The function's own contract is asserted where it can be —
 * that the RPC behind it answers correctly, and that nobody else may call it.
 */
import { asAnon, asService, asUser, idOf } from '../support/clients';
import { asRole, sql } from '../support/reset';

const WEEK = '2026-08-10';

/** A throwaway account, with a profile the signup trigger makes for it. */
async function makeAccount(tag: string): Promise<string> {
  const { data, error } = await asService().auth.admin.createUser({
    email: `${tag}@rally.test`,
    password: 'rally-test-password',
    email_confirm: true,
  });
  expect(error).toBeNull();
  return data.user!.id;
}

/** Gone from `auth.users`, which is what the purge would do. */
const destroy = (id: string) => asService().auth.admin.deleteUser(id);

const schedule = (id: string, daysAgo = 0) =>
  sql(`update public.profiles set deleted_at = now() - ($2 || ' days')::interval where id = $1`, [
    id,
    String(daysAgo),
  ]);

const due = async (): Promise<string[]> => {
  const { data, error } = await asService().rpc('accounts_due_for_purge');
  expect(error).toBeNull();
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
};

// ─── who is due ────────────────────────────────────────────────────────────

describe('accounts_due_for_purge', () => {
  it('names nobody who has not asked', async () => {
    const id = await makeAccount('purge.untouched');
    try {
      expect(await due()).not.toContain(id);
    } finally {
      await destroy(id);
    }
  });

  it('does not name an account whose fortnight is still running', async () => {
    // Thirteen days, not thirteen and a bit. The boundary is the only thing
    // this function decides, and a test at day zero would pass against a
    // window of any length at all — including none.
    const id = await makeAccount('purge.waiting');
    try {
      await schedule(id, 13);
      expect(await due()).not.toContain(id);
    } finally {
      await destroy(id);
    }
  });

  it('names one whose fortnight is up', async () => {
    const id = await makeAccount('purge.ready');
    try {
      await schedule(id, 15);
      expect(await due()).toContain(id);
    } finally {
      await destroy(id);
    }
  });

  it('is no longer due once it is cancelled', async () => {
    const id = await makeAccount('purge.reprieved');
    try {
      await schedule(id, 15);
      expect(await due()).toContain(id);

      await sql('update public.profiles set deleted_at = null where id = $1', [id]);

      expect(await due()).not.toContain(id);
    } finally {
      await destroy(id);
    }
  });
});

// ─── who may ask ───────────────────────────────────────────────────────────

describe('who may call it', () => {
  it('is not callable by any role a client can act as', async () => {
    // Asked at the grant, over `pg`, rather than through REST. The function has
    // to live in `public` so PostgREST can expose it to the collector, which
    // means "it is not reachable" is no longer something its schema says for
    // it — the EXECUTE grant is the whole defence, so the EXECUTE grant is what
    // gets asked.
    for (const role of ['anon', 'authenticated']) {
      const { error } = await asRole(role, 'select public.accounts_due_for_purge()');
      expect(error).toBe('42501');
    }
  });

  it('is callable by the collector', async () => {
    // The other half. A revoke one step too far leaves this suite green and
    // deletion permanently unfinished.
    const { error } = await asService().rpc('accounts_due_for_purge');
    expect(error).toBeNull();
  });

  it('refuses a signed-in caller through REST as well', async () => {
    const { error } = await asUser('maya').rpc('accounts_due_for_purge');
    expect(error).not.toBeNull();

    const anon = await asAnon().rpc('accounts_due_for_purge');
    expect(anon.error).not.toBeNull();
  });

  it('takes no arguments, so the window is not the callers to choose', async () => {
    // The security property, asserted against the catalogue. A leaked webhook
    // secret plus an interval parameter would be every pending account deleted
    // in one request.
    const rows = await sql<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'accounts_due_for_purge'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].args).toBe('');
  });
});

// ─── what the cascade takes ────────────────────────────────────────────────

describe('destroying the account', () => {
  it('takes the notifications it caused in other peoples feeds', async () => {
    // The one thing the cascade could never reach. `notifications` has no actor
    // column — the sender lives in `payload->>'actor_id'`, which is jsonb with
    // no foreign key — so before the trigger this left the departed account's
    // uuid *and display name* sitting in somebody else's list forever.
    const id = await makeAccount('purge.actor');
    await sql(
      `insert into public.notifications (recipient_id, tier, kind, payload)
       values ($1, 'circle', 'cheer', jsonb_build_object('actor_id', $2::text, 'actor_name', 'Gone'))`,
      [idOf('maya'), id],
    );

    const before = await sql<{ n: string }>(
      `select count(*) as n from public.notifications where payload->>'actor_id' = $1`,
      [id],
    );
    expect(Number(before[0].n)).toBe(1);

    await destroy(id);

    const after = await sql<{ n: string }>(
      `select count(*) as n from public.notifications where payload->>'actor_id' = $1`,
      [id],
    );
    expect(Number(after[0].n)).toBe(0);
  });

  it('leaves other peoples notifications alone', async () => {
    // The trigger deletes by actor, and the rows it walks belong to strangers.
    // A predicate one character wrong here empties somebody else's feed.
    const doomed = await makeAccount('purge.doomed');
    const bystander = await makeAccount('purge.bystander');
    try {
      for (const actor of [doomed, bystander]) {
        await sql(
          `insert into public.notifications (recipient_id, tier, kind, payload)
           values ($1, 'circle', 'cheer', jsonb_build_object('actor_id', $2::text))`,
          [idOf('maya'), actor],
        );
      }

      await destroy(doomed);

      const left = await sql<{ n: string }>(
        `select count(*) as n from public.notifications where payload->>'actor_id' = $1`,
        [bystander],
      );
      expect(Number(left[0].n)).toBe(1);
    } finally {
      await destroy(bystander);
    }
  });

  it('takes the profile, the goals and the rollups with it', async () => {
    const id = await makeAccount('purge.rows');
    await sql(
      `insert into public.tasks (owner_id, week_start, day, title, category, points, aud)
       values ($1, $2, 0, 'a goal that should not survive', 'move', 3, 'everyone')`,
      [id, WEEK],
    );
    await sql(
      `insert into public.week_rollups (profile_id, week_start, points, done, total, perfect, streak_held)
       values ($1, $2, 5, 1, 1, false, false)`,
      [id, WEEK],
    );

    await destroy(id);

    for (const q of [
      'select count(*) as n from public.profiles where id = $1',
      'select count(*) as n from public.tasks where owner_id = $1',
      'select count(*) as n from public.week_rollups where profile_id = $1',
    ]) {
      const rows = await sql<{ n: string }>(q, [id]);
      expect(Number(rows[0].n)).toBe(0);
    }
  });

  it('enqueues its photos for the collector rather than orphaning them', async () => {
    // `task-media` needs nothing from the purge function: the cascade deletes
    // the rows and `enqueue_media_gc` writes each path into the queue that
    // `collect-media` already drains. Asserted because "the other function
    // handles it" is exactly the kind of claim that stops being true quietly.
    const id = await makeAccount('purge.photos');
    const task = await sql<{ id: string }>(
      `insert into public.tasks (owner_id, week_start, day, title, category, points, aud)
       values ($1, $2, 0, 'a goal with a photo', 'move', 3, 'everyone') returning id`,
      [id, WEEK],
    );
    // The path is not free-form: `task_media_path_is_its_own` requires it to be
    // exactly `<owner>/<task>/<media id>.jpg`, so the id has to be minted here
    // rather than defaulted, and the path built from it.
    const media = await sql<{ id: string }>('select gen_random_uuid() as id');
    const path = `${id}/${task[0].id}/${media[0].id}.jpg`;
    await sql(
      `insert into public.task_media (id, task_id, owner_id, path, width, height)
       values ($1, $2, $3, $4, 100, 100)`,
      [media[0].id, task[0].id, id, path],
    );

    await destroy(id);

    const queued = await sql<{ path: string }>('select path from public.media_gc where path = $1', [
      path,
    ]);
    expect(queued.map((r) => r.path)).toEqual([path]);
    await sql('delete from public.media_gc where path = $1', [path]);
  });
});
