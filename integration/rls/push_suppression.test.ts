/**
 * A bot may cheer you. It may not wake you up.
 *
 * The Oz bots cheer real people's staked tasks on purpose — a Global feed that
 * never reacts to you reads as a room full of people ignoring you. So the bell
 * showing "🔥 Dorothy Gale cheered you" is wanted, and this file asserts it
 * still happens.
 *
 * What is not wanted is the buzz. `push_on_notification` carries every
 * notification row to a lock screen, and a fictional character is not a good
 * enough reason to light somebody's phone at three in the morning.
 *
 * ── How this is observed ──────────────────────────────────────────────────
 *
 * The trigger is inert without `push_function_url` and `push_webhook_secret` in
 * Vault, which is exactly what stops `npm run test:integration` firing real
 * notifications at a real phone. So a test that wants to see the push *happen*
 * has to supply them — and must not leave them behind for the next file.
 *
 * Both problems are solved by doing everything inside one rolled-back
 * transaction: the secrets never exist outside it, and `net.http_request_queue`
 * is read before the `pg_net` worker that drains it can possibly have run.
 */
import { sql, sqlInTx } from '../support/reset';

/** Nothing listens here, so even a bug that queued a request harms nobody. */
const NOWHERE = 'http://127.0.0.1:1/push';

const configureVault = [
  `select vault.create_secret('${NOWHERE}', 'push_function_url')`,
  `select vault.create_secret('probe-secret', 'push_webhook_secret')`,
];

/**
 * Writes one notification attributed to `actorSql`, and answers how many pushes
 * it queued. The insert goes straight into `notifications` rather than through
 * a reaction, because the trigger under test is on that table and a cheer is
 * just one way to reach it.
 */
async function pushesQueuedFor(actorSql: string): Promise<number> {
  const rows = await sqlInTx<{ n: number }>([
    ...configureVault,
    `insert into public.notifications (recipient_id, tier, kind, payload)
     select p.id, 'circle', 'cheer',
            jsonb_build_object('actor_name', 'Someone', 'task_title', 'Run 5k')
              || ${actorSql}
     from public.profiles p where p.handle = 'maya'`,
    `select count(*)::int as n from net.http_request_queue`,
  ]);
  return rows[0].n;
}

const asActor = (handleOrBot: string) =>
  `jsonb_build_object('actor_id', (select id from public.profiles where handle = '${handleOrBot}'))`;

describe('who gets to make a phone buzz', () => {
  it('a real person cheering you does', async () => {
    // The control, and the mutation check for everything below: if this ever
    // returns 0, the suppression is not being tested — the trigger is simply
    // not firing, and every other assertion here passes for the wrong reason.
    expect(await pushesQueuedFor(asActor('dre'))).toBe(1);
  });

  it('a bot does not', async () => {
    expect(await pushesQueuedFor(asActor('dorothy.gale'))).toBe(0);
  });

  it('nor any of the other three', async () => {
    for (const bot of ['the.scarecrow', 'tin.man', 'cowardly.lion']) {
      expect(await pushesQueuedFor(asActor(bot))).toBe(0);
    }
  });

  it('a notification with no actor still does', async () => {
    // The default has to be deliver. A future notification kind that names no
    // actor must not go silently missing for a reason nobody wrote down —
    // suppression is a thing you opt into by being a bot, not a thing that
    // happens whenever the payload is unfamiliar.
    expect(await pushesQueuedFor(`'{}'::jsonb`)).toBe(1);
  });

  it('and a malformed actor id does not raise, or take a real push down with it', async () => {
    // `actor_id` is compared as text precisely so this cannot throw. A raise
    // here would be swallowed by the function's own exception handler, which
    // returns without pushing — turning a garbled payload into a silent, and
    // very hard to find, loss of somebody's notification.
    expect(await pushesQueuedFor(`jsonb_build_object('actor_id', 'not-a-uuid')`)).toBe(1);
  });
});

describe('the bell still rings', () => {
  it('a bot cheer writes the notification row, which is the whole point', async () => {
    // Suppression is about the last hop only. Losing the row would mean the
    // bots cheer into nothing, which is the behaviour this was built to avoid.
    const rows = await sqlInTx<{ n: number }>([
      ...configureVault,
      `insert into public.notifications (recipient_id, tier, kind, payload)
       select p.id, 'circle', 'cheer',
              jsonb_build_object('actor_name', 'Dorothy Gale', 'task_title', 'Run 5k')
                || ${asActor('dorothy.gale')}
       from public.profiles p where p.handle = 'maya'`,
      `select count(*)::int as n from public.notifications
        where payload ->> 'actor_name' = 'Dorothy Gale'`,
    ]);
    expect(rows[0].n).toBe(1);
  });
});

describe('the lookup it does on every notification', () => {
  it('is indexed, so this does not become a scan of every profile', async () => {
    // Runs on every insert into `notifications`. Without the partial index it
    // is a sequential scan of `profiles`, which is fine at four bots and four
    // people and is not fine later.
    const rows = await sql<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'profiles_bots_idx'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/WHERE is_bot/);
  });
});
