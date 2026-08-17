/**
 * The seeded world, checked against the file it was written from.
 *
 * `supabase/seed.sql` says it is "written by hand from integration/fixtures/
 * world.ts", and `world.ts` says this file "asserts the two still agree". Both
 * have said so since the suite was stood up; neither was true, because this file
 * did not exist. Every other test in this directory reads the fixture and trusts
 * that the database matches it, so a hand-copy that drifted would not fail here —
 * it would fail somewhere else, as a policy that appears to have stopped working.
 *
 * What made it worth writing: `scripts/seed-bots.mjs` had Dorothy at
 * `dorothy@ozbots.rally.app` while the seed created her at `dorothy@rally.test`.
 * Two spellings of one account, disagreeing from the day the script was written,
 * in a field nothing reads on the path that runs locally.
 *
 * Read over the superuser connection rather than through PostgREST: `auth.users`
 * is not an exposed schema, and its `email` is half of what is being compared.
 * `resetDomainTables` deliberately leaves `auth.users`, `profiles`, `circles` and
 * `circle_members` alone, so the seeded world is intact whichever test ran first.
 */
import { sql } from './support/reset';
import {
  CIRCLE_IDS,
  MEMBERSHIPS,
  SEED_BOTS,
  SEED_HANDLES,
  SEED_USERS,
  type SeedHandle,
} from './fixtures/world';

/** Only the columns each query names — a row here is what the seed wrote. */
type PersonRow = { handle: string; name: string; email: string };
type BotRow = PersonRow & { id: string; is_bot: boolean };

describe('the seeded people', () => {
  it('are in the database exactly as the fixture spells them', async () => {
    // Asked for by handle rather than as "every non-bot profile". Several tests
    // sign in anonymously, `handle_new_user` gives each one a profile row, and
    // `resetDomainTables` leaves `profiles` alone on purpose — so the table
    // legitimately holds strangers, and how many depends on which file ran
    // first. What this asserts is that the seven the fixture names are there and
    // say what it says, which is the claim the rest of the suite leans on.
    const rows = await sql<PersonRow>(
      `select p.handle, p.name, u.email
         from public.profiles p join auth.users u on u.id = p.id
        where p.handle = any($1::text[])`,
      [SEED_HANDLES.map((h) => SEED_USERS[h].handle)],
    );

    // Whole rows, not a handle count: the email is the field with nothing else
    // watching it — nothing in the app reads one, and the suite signs in by
    // `SEED_PASSWORD` — so a seed that drifted there would go unnoticed until
    // somebody tried to sign in as a person who is not there.
    //
    // Sorted in JS on both sides rather than in SQL, so the comparison does not
    // depend on the database's collation for `you_rally`'s underscore.
    const byHandle = (a: PersonRow, b: PersonRow) => a.handle.localeCompare(b.handle);

    expect([...rows].sort(byHandle)).toEqual(
      SEED_HANDLES.map((h) => ({
        handle: SEED_USERS[h].handle,
        name: SEED_USERS[h].name,
        email: SEED_USERS[h].email,
      })).sort(byHandle),
    );
  });
});

describe('the seeded bots', () => {
  it('are the cast the fixture and the bot script both name, at fixed ids', async () => {
    const rows = await sql<BotRow>(
      `select p.id, p.handle, p.name, u.email, p.is_bot
         from public.profiles p join auth.users u on u.id = p.id
        where p.is_bot`,
    );

    // The ids matter as much as the names here, and they are why this seeds all
    // four rather than only Dorothy. `scripts/seed-bots.mjs` creates whichever
    // bot it cannot find by handle and `auth.admin.createUser` picks the uuid —
    // so before these rows existed, three of the cast were re-minted on every
    // `db reset` and the app's directory, keyed by id, ended up holding both the
    // old row and the new one.
    const byHandle = (a: BotRow, b: BotRow) => a.handle.localeCompare(b.handle);
    expect([...rows].sort(byHandle)).toEqual(
      SEED_BOTS.map((b) => ({
        id: b.id,
        handle: b.handle,
        name: b.name,
        email: b.email,
        is_bot: true,
      })).sort(byHandle),
    );
  });

  it('are the only ones, so a second Dorothy cannot arrive unnoticed', async () => {
    // `bots.test.ts` asserts that a stranger sees exactly the bots and their own
    // row. That claim is only as sharp as this count — and a duplicate bot is
    // precisely the failure this suite exists to catch early, since the app
    // renders every `is_bot` row as a person you could stake a goal with.
    const rows = await sql<{ id: string }>('select id from public.profiles where is_bot');
    expect(rows).toHaveLength(SEED_BOTS.length);
  });
});

describe('the seeded circles', () => {
  it('hold exactly the memberships the fixture describes', async () => {
    const rows = await sql<{ circle: string; handle: string }>(
      `select c.id as circle, p.handle
         from public.circle_members m
         join public.circles c on c.id = m.circle_id
         join public.profiles p on p.id = m.profile_id
        order by c.id, p.handle`,
    );

    const seeded = new Map<string, string[]>();
    for (const { circle, handle } of rows) {
      seeded.set(circle, [...(seeded.get(circle) ?? []), handle]);
    }

    // The shape these tests turn on: maya shares the basement with dre and nana,
    // the gym with sofia, and nothing at all with jordan or tomas. Every
    // negative assertion in `profiles.test.ts` and `tasks.test.ts` is really an
    // assertion about this table.
    const expected = new Map(
      (Object.keys(MEMBERSHIPS) as (keyof typeof CIRCLE_IDS)[]).map((name) => [
        CIRCLE_IDS[name],
        [...MEMBERSHIPS[name]].map((h: SeedHandle) => SEED_USERS[h].handle).sort(),
      ]),
    );

    expect(seeded).toEqual(expected);
  });
});
