/**
 * An in-memory stand-in for supabase-js.
 *
 * Jest picks this up automatically for every unit test — no `jest.mock` call —
 * because the unit project's `roots` is `src/`, and a `__mocks__` directory at
 * the root of a project mocks node_modules packages by name. A unit test can
 * therefore never construct a real client, and never open a socket.
 *
 * It is a tiny PostgREST rather than a bag of `jest.fn()`s. A mock that always
 * says yes proves the caller compiles, not that it works: the interesting bugs
 * in a sync layer all live in the branch where the server said no. So this
 * enforces, unprompted, the constraints that `supabase/migrations/` actually
 * declares — unique keys, checks, foreign keys, enums — and reports them with
 * the real SQLSTATE and the real PostgREST error envelope.
 *
 * THERE IS NO ROW LEVEL SECURITY HERE, and there deliberately never will be.
 * Every client sees every row. RLS is a property of a running Postgres, and a
 * hand-rolled imitation of it would be a mock that lies about the one thing
 * most worth being sure of. Any test whose name contains "cannot see" belongs
 * in `integration/`, where a real database decides.
 *
 * Two other things are missing on purpose: realtime (`channel()` throws) and
 * embedded selects (`select('*, profiles(*)')` throws). Both are wire-level
 * behaviours that only a real PostgREST can be trusted to reproduce.
 *
 * Foreign keys are enforced, which means a row's parents must exist before it
 * does — exactly as in Postgres. `signInAnonymously()` creates the `profiles`
 * row for you, mirroring the `on_auth_user_created` trigger, so the common
 * path (sign in, then write your own tasks) needs no hand-seeding.
 */

// ─── the error envelope ───────────────────────────────────────────────────

export type PostgrestErrorShape = {
  message: string;
  details: string | null;
  hint: string | null;
  code: string;
};

export type AuthErrorShape = {
  name: string;
  message: string;
  status: number;
  code: string;
};

type Result<T> = { data: T; error: null } | { data: null; error: PostgrestErrorShape };

type Row = Record<string, unknown>;

const pgError = (
  code: string,
  message: string,
  details: string | null = null,
  hint: string | null = null,
): PostgrestErrorShape => ({ message, details, hint, code });

// ─── the schema, as the migrations declare it ─────────────────────────────

const ENUMS = {
  audience: ['friends', 'everyone', 'private'],
  task_source: ['staked', 'quicklog'],
  reaction_kind: ['cheer', 'in', 'cosign', 'nod', 'share'],
  reaction_target: ['task', 'post'],
  notif_tier: ['needs', 'week', 'circle'],
} as const;

type EnumName = keyof typeof ENUMS;

type Column = {
  notNull?: boolean;
  default?: () => unknown;
  enum?: EnumName;
  /** Single-column FK. The referenced column is always the parent's `id`. */
  references?: string;
};

type TableSpec = {
  pk: string[];
  columns: Record<string, Column>;
  unique?: { name: string; cols: string[] }[];
  checks?: { name: string; ok: (row: Row) => boolean }[];
};

/** `length(btrim(x, E' \t\n\r')) > 0`, the shape both text checks settled on. */
const nonBlank = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;

const num = (v: unknown): number => (typeof v === 'number' ? v : Number.NaN);

const nonNulls = (...vs: unknown[]): number =>
  vs.filter((v) => v !== null && v !== undefined).length;

const SCHEMA: Record<string, TableSpec> = {
  profiles: {
    pk: ['id'],
    columns: {
      id: { notNull: true },
      handle: { notNull: true },
      name: { notNull: true },
      joined_at: { default: () => now() },
    },
    unique: [{ name: 'profiles_handle_key', cols: ['handle'] }],
    checks: [
      {
        name: 'profiles_handle_check',
        ok: (r) => typeof r.handle === 'string' && /^[a-z0-9_.]{3,30}$/.test(r.handle),
      },
    ],
  },

  circles: {
    pk: ['id'],
    columns: {
      id: { notNull: true, default: () => uuid() },
      name: { notNull: true },
      invite_code: { notNull: true },
      created_by: { references: 'profiles' },
      created_at: { default: () => now() },
    },
    unique: [{ name: 'circles_invite_code_key', cols: ['invite_code'] }],
    checks: [
      {
        name: 'circles_invite_code_entropy',
        ok: (r) => typeof r.invite_code === 'string' && /-[0-9a-f]{16}$/.test(r.invite_code),
      },
      { name: 'circles_name_length', ok: (r) => String(r.name ?? '').length <= 80 },
    ],
  },

  circle_members: {
    pk: ['circle_id', 'profile_id'],
    columns: {
      circle_id: { notNull: true, references: 'circles' },
      profile_id: { notNull: true, references: 'profiles' },
      joined_at: { default: () => now() },
    },
  },

  tasks: {
    pk: ['id'],
    columns: {
      id: { notNull: true, default: () => uuid() },
      owner_id: { notNull: true, references: 'profiles' },
      circle_id: { references: 'circles' },
      week_start: { notNull: true },
      day: { notNull: true },
      title: { notNull: true },
      category: { notNull: true },
      points: { notNull: true },
      aud: { notNull: true, enum: 'audience', default: () => 'friends' },
      source: { notNull: true, enum: 'task_source', default: () => 'staked' },
      done_at: {},
      created_at: { default: () => now() },
      updated_at: { default: () => now() },
    },
    checks: [
      { name: 'tasks_day_check', ok: (r) => num(r.day) >= 0 && num(r.day) <= 6 },
      { name: 'tasks_title_check', ok: (r) => nonBlank(r.title) },
      { name: 'tasks_points_check', ok: (r) => num(r.points) >= 0 },
    ],
  },

  task_pairs: {
    pk: ['task_id', 'profile_id'],
    columns: {
      task_id: { notNull: true, references: 'tasks' },
      profile_id: { notNull: true, references: 'profiles' },
      done_at: {},
    },
  },

  reactions: {
    pk: ['id'],
    columns: {
      id: { notNull: true, default: () => uuid() },
      actor_id: { notNull: true, references: 'profiles' },
      // Polymorphic by design: no FK, which is why `target_type` carries the
      // weight and has to be an enum.
      target_type: { notNull: true, enum: 'reaction_target' },
      target_id: { notNull: true },
      kind: { notNull: true, enum: 'reaction_kind' },
      created_at: { default: () => now() },
    },
    unique: [
      {
        name: 'reactions_actor_id_target_type_target_id_kind_key',
        cols: ['actor_id', 'target_type', 'target_id', 'kind'],
      },
    ],
  },

  notes: {
    pk: ['id'],
    columns: {
      id: { notNull: true, default: () => uuid() },
      author_id: { notNull: true, references: 'profiles' },
      task_id: { references: 'tasks' },
      recipient_id: { references: 'profiles' },
      body: { notNull: true },
      created_at: { default: () => now() },
    },
    checks: [
      { name: 'notes_body_check', ok: (r) => nonBlank(r.body) },
      {
        name: 'notes_exactly_one_target',
        ok: (r) => nonNulls(r.task_id, r.recipient_id) === 1,
      },
    ],
  },

  week_rollups: {
    pk: ['profile_id', 'week_start'],
    columns: {
      profile_id: { notNull: true, references: 'profiles' },
      week_start: { notNull: true },
      points: { notNull: true, default: () => 0 },
      done: { notNull: true, default: () => 0 },
      total: { notNull: true, default: () => 0 },
      perfect: { notNull: true, default: () => false },
      streak_held: { notNull: true, default: () => false },
      closed_at: { default: () => now() },
    },
  },

  notifications: {
    pk: ['id'],
    columns: {
      id: { notNull: true, default: () => uuid() },
      recipient_id: { notNull: true, references: 'profiles' },
      tier: { notNull: true, enum: 'notif_tier' },
      kind: { notNull: true },
      payload: { notNull: true, default: () => ({}) },
      read_at: {},
      created_at: { default: () => now() },
    },
  },

  invites: {
    pk: ['id'],
    columns: {
      id: { notNull: true, default: () => uuid() },
      circle_id: { notNull: true, references: 'circles' },
      inviter_id: { notNull: true, references: 'profiles' },
      invitee_id: { references: 'profiles' },
      accepted_at: {},
      created_at: { default: () => now() },
    },
  },
};

// ─── determinism ──────────────────────────────────────────────────────────
//
// Ids and timestamps are sequential, not random: a test that asserts on a
// generated id should be able to write it down.

let seq = 0;
const uuid = (): string => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

const EPOCH = Date.parse('2026-08-10T00:00:00.000Z');
let ticks = 0;
const now = (): string => {
  ticks += 1;
  return new Date(EPOCH + ticks * 1000).toISOString();
};

// ─── the store ────────────────────────────────────────────────────────────

type CallLog = { method: string; table: string | null; body: unknown };

type Session = {
  access_token: string;
  refresh_token: string;
  token_type: 'bearer';
  expires_in: number;
  expires_at: number;
  user: { id: string; is_anonymous: boolean; aud: string; role: string };
};

type AuthListener = (event: string, session: Session | null) => void;

const state = {
  db: {} as Record<string, Row[]>,
  calls: [] as CallLog[],
  failures: [] as PostgrestErrorShape[],
  offline: false,
  anonymousDisabled: false,
  session: null as Session | null,
  listeners: new Set<AuthListener>(),
};

const emptyDb = (): Record<string, Row[]> => {
  const db: Record<string, Row[]> = Object.create(null);
  for (const table of Object.keys(SCHEMA)) db[table] = [];
  return db;
};

const rowsOf = (table: string): Row[] => {
  const rows = state.db[table];
  if (!rows) {
    // PostgREST's own answer to a table it has never heard of.
    throw new Error(`no such table "${table}" in the fake schema`);
  }
  return rows;
};

// ─── validation, in Postgres' order ───────────────────────────────────────

class Refusal extends Error {
  constructor(readonly pg: PostgrestErrorShape) {
    super(pg.message);
  }
}

const keyOf = (row: Row, cols: string[]): string =>
  cols.map((c) => JSON.stringify(row[c] ?? null)).join(' ');

const describeKey = (row: Row, cols: string[]): string =>
  `Key (${cols.join(', ')})=(${cols.map((c) => String(row[c])).join(', ')})`;

/**
 * `at` is the index of the row being replaced by an UPDATE, so a row does not
 * collide with the version of itself it is about to become.
 */
function validate(table: string, row: Row, at: number | null): void {
  const spec = SCHEMA[table];

  for (const [col, value] of Object.entries(row)) {
    if (!(col in spec.columns)) {
      throw new Refusal(
        pgError(
          'PGRST204',
          `Could not find the '${col}' column of '${table}' in the schema cache`,
        ),
      );
    }
    const def = spec.columns[col].enum;
    if (def && value !== null && value !== undefined) {
      const allowed: readonly string[] = ENUMS[def];
      if (!allowed.includes(String(value))) {
        throw new Refusal(
          pgError('22P02', `invalid input value for enum ${def}: "${String(value)}"`),
        );
      }
    }
  }

  for (const [col, def] of Object.entries(spec.columns)) {
    if (def.notNull && (row[col] === null || row[col] === undefined)) {
      throw new Refusal(
        pgError(
          '23502',
          `null value in column "${col}" of relation "${table}" violates not-null constraint`,
        ),
      );
    }
  }

  for (const check of spec.checks ?? []) {
    if (!check.ok(row)) {
      throw new Refusal(
        pgError(
          '23514',
          `new row for relation "${table}" violates check constraint "${check.name}"`,
        ),
      );
    }
  }

  const uniques = [
    { name: `${table}_pkey`, cols: spec.pk },
    ...(spec.unique ?? []),
  ];
  for (const u of uniques) {
    const key = keyOf(row, u.cols);
    const clash = rowsOf(table).findIndex((r, i) => i !== at && keyOf(r, u.cols) === key);
    if (clash !== -1) {
      throw new Refusal(
        pgError(
          '23505',
          `duplicate key value violates unique constraint "${u.name}"`,
          `${describeKey(row, u.cols)} already exists.`,
        ),
      );
    }
  }

  for (const [col, def] of Object.entries(spec.columns)) {
    const value = row[col];
    if (!def.references || value === null || value === undefined) continue;
    if (!rowsOf(def.references).some((r) => r.id === value)) {
      throw new Refusal(
        pgError(
          '23503',
          `insert or update on table "${table}" violates foreign key constraint "${table}_${col}_fkey"`,
          `${describeKey(row, [col])} is not present in table "${def.references}".`,
        ),
      );
    }
  }
}

function withDefaults(table: string, input: Row): Row {
  if (!SCHEMA[table]) throw new Error(`no such table "${table}" in the fake schema`);
  const row: Row = {};
  for (const [col, def] of Object.entries(SCHEMA[table].columns)) {
    if (col in input) row[col] = input[col];
    else if (def.default) row[col] = def.default();
    else row[col] = null;
  }
  // Unknown columns are kept so validate() can refuse them by name.
  for (const col of Object.keys(input)) if (!(col in row)) row[col] = input[col];
  return row;
}

// ─── the query builder ────────────────────────────────────────────────────

type Filter = { op: 'eq' | 'in'; col: string; value: unknown };
type Op = 'select' | 'insert' | 'update' | 'delete' | 'upsert';

const compare = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1; // Postgres: NULLS LAST on ASC
  if (b === null || b === undefined) return -1;
  return String(a) < String(b) ? -1 : 1;
};

class Builder<T = Row[]> implements PromiseLike<Result<T>> {
  private op: Op | null = null;
  private payload: Row[] = [];
  private patch: Row = {};
  private filters: Filter[] = [];
  private columns = '*';
  private returning = false;
  private sort: { col: string; ascending: boolean } | null = null;
  private cap: number | null = null;
  private row: 'many' | 'single' | 'maybe' = 'many';
  private onConflict: string[] | null = null;
  private settled: Promise<Result<T>> | null = null;

  constructor(private readonly table: string) {}

  select(columns = '*'): this {
    if (columns.includes('(')) {
      throw new Error(
        `embedded selects are not mocked ("${columns}"); that belongs in the integration suite`,
      );
    }
    this.columns = columns;
    if (this.op === null) this.op = 'select';
    else this.returning = true;
    return this;
  }

  insert(values: Row | Row[]): this {
    this.op = 'insert';
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }

  upsert(values: Row | Row[], options?: { onConflict?: string }): this {
    this.op = 'upsert';
    this.payload = Array.isArray(values) ? values : [values];
    this.onConflict = options?.onConflict
      ? options.onConflict.split(',').map((c) => c.trim())
      : null;
    return this;
  }

  update(values: Row): this {
    this.op = 'update';
    this.patch = values;
    return this;
  }

  delete(): this {
    this.op = 'delete';
    return this;
  }

  eq(col: string, value: unknown): this {
    this.filters.push({ op: 'eq', col, value });
    return this;
  }

  in(col: string, values: unknown[]): this {
    this.filters.push({ op: 'in', col, value: values });
    return this;
  }

  order(col: string, options?: { ascending?: boolean }): this {
    this.sort = { col, ascending: options?.ascending ?? true };
    return this;
  }

  limit(n: number): this {
    this.cap = n;
    return this;
  }

  single(): Builder<Row> {
    this.row = 'single';
    return this as unknown as Builder<Row>;
  }

  maybeSingle(): Builder<Row | null> {
    this.row = 'maybe';
    return this as unknown as Builder<Row | null>;
  }

  then<A = Result<T>, B = never>(
    onFulfilled?: ((value: Result<T>) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    if (!this.settled) this.settled = this.run();
    return this.settled.then(onFulfilled, onRejected);
  }

  private run(): Promise<Result<T>> {
    const op = this.op ?? 'select';
    const body =
      op === 'insert' || op === 'upsert' ? this.payload : op === 'update' ? this.patch : null;

    if (state.offline) {
      // fetch's own failure. Not an { error } envelope — supabase-js only
      // converts what the server actually answered.
      return Promise.reject(new TypeError('Network request failed'));
    }
    state.calls.push({ method: op, table: this.table, body });

    const forced = state.failures.shift();
    if (forced) return Promise.resolve({ data: null, error: forced });

    try {
      return Promise.resolve(this.shape(this.execute(op)));
    } catch (e) {
      if (e instanceof Refusal) return Promise.resolve({ data: null, error: e.pg });
      throw e;
    }
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      if (!(f.col in SCHEMA[this.table].columns)) {
        throw new Refusal(
          pgError('42703', `column ${this.table}.${f.col} does not exist`),
        );
      }
      return f.op === 'eq'
        ? row[f.col] === f.value
        : (f.value as unknown[]).includes(row[f.col]);
    });
  }

  private execute(op: Op): Row[] {
    const rows = rowsOf(this.table);

    if (op === 'select') {
      let out = rows.filter((r) => this.matches(r));
      if (this.sort) {
        const { col, ascending } = this.sort;
        out = [...out].sort((a, b) => (ascending ? 1 : -1) * compare(a[col], b[col]));
      }
      if (this.cap !== null) out = out.slice(0, this.cap);
      return out;
    }

    if (op === 'insert') {
      const staged = this.payload.map((r) => withDefaults(this.table, r));
      // A statement is atomic: validate everything before anything lands.
      for (const r of staged) {
        validate(this.table, r, null);
        rows.push(r);
      }
      return staged;
    }

    if (op === 'upsert') {
      const conflict = this.onConflict ?? SCHEMA[this.table].pk;
      const out: Row[] = [];
      for (const input of this.payload) {
        const staged = withDefaults(this.table, input);
        const at = rows.findIndex((r) => keyOf(r, conflict) === keyOf(staged, conflict));
        if (at === -1) {
          validate(this.table, staged, null);
          rows.push(staged);
          out.push(staged);
        } else {
          const merged = { ...rows[at], ...input };
          validate(this.table, merged, at);
          rows[at] = merged;
          out.push(merged);
        }
      }
      return out;
    }

    if (op === 'update') {
      const out: Row[] = [];
      rows.forEach((r, i) => {
        if (!this.matches(r)) return;
        const merged = { ...r, ...this.patch };
        validate(this.table, merged, i);
        rows[i] = merged;
        out.push(merged);
      });
      return out;
    }

    const doomed = rows.filter((r) => this.matches(r));
    state.db[this.table] = rows.filter((r) => !doomed.includes(r));
    return doomed;
  }

  private project(rows: Row[]): Row[] {
    if (this.columns.trim() === '*') return rows.map((r) => ({ ...r }));
    const cols = this.columns.split(',').map((c) => c.trim());
    return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
  }

  private shape(rows: Row[]): Result<T> {
    const wants = this.op === null || this.op === 'select' || this.returning;

    if (this.row === 'many') {
      const data = wants ? this.project(rows) : null;
      return { data: data as T, error: null };
    }

    if (rows.length > 1 || (rows.length === 0 && this.row === 'single')) {
      return {
        data: null,
        error: pgError(
          'PGRST116',
          'JSON object requested, multiple (or no) rows returned',
          `The result contains ${rows.length} rows`,
          rows.length > 1 ? 'Results contain multiple rows, application/vnd.pgrst.object+json requires 1 row' : null,
        ),
      };
    }

    const one = rows.length === 1 ? this.project(rows)[0] : null;
    return { data: (wants ? one : null) as T, error: null };
  }
}

// ─── auth ─────────────────────────────────────────────────────────────────

const anonError = (): AuthErrorShape => ({
  name: 'AuthApiError',
  message: 'Anonymous sign-ins are disabled',
  status: 422,
  code: 'anonymous_provider_disabled',
});

const announce = (event: string): void => {
  for (const l of state.listeners) l(event, state.session);
};

const makeAuth = () => ({
  async getSession() {
    state.calls.push({ method: 'auth.getSession', table: null, body: null });
    return { data: { session: state.session }, error: null };
  },

  async signInAnonymously() {
    if (state.offline) throw new TypeError('Network request failed');
    state.calls.push({ method: 'auth.signInAnonymously', table: null, body: null });

    if (state.anonymousDisabled) {
      return { data: { user: null, session: null }, error: anonError() };
    }

    const id = uuid();
    const user = { id, is_anonymous: true, aud: 'authenticated', role: 'authenticated' };
    state.session = {
      access_token: `fake-access-${id}`,
      refresh_token: `fake-refresh-${id}`,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(EPOCH / 1000) + 3600,
      user,
    };

    // What `on_auth_user_created` does. Without it every write by a fresh
    // anonymous user would fail its owner_id foreign key.
    rowsOf('profiles').push(
      withDefaults('profiles', {
        id,
        handle: `anon_${id.replace(/-/g, '').slice(0, 12)}`,
        name: 'Someone',
      }),
    );

    announce('SIGNED_IN');
    return { data: { user, session: state.session }, error: null };
  },

  async signOut() {
    state.calls.push({ method: 'auth.signOut', table: null, body: null });
    state.session = null;
    announce('SIGNED_OUT');
    return { error: null };
  },

  onAuthStateChange(callback: AuthListener) {
    state.listeners.add(callback);
    // supabase-js replays the current session asynchronously on subscribe, so
    // a caller that only ever reacts to the callback still gets its first one.
    void Promise.resolve().then(() => {
      if (state.listeners.has(callback)) callback('INITIAL_SESSION', state.session);
    });
    return {
      data: {
        subscription: {
          id: `sub-${state.listeners.size}`,
          callback,
          unsubscribe: () => {
            state.listeners.delete(callback);
          },
        },
      },
    };
  },

  async startAutoRefresh() {
    state.calls.push({ method: 'auth.startAutoRefresh', table: null, body: null });
  },

  async stopAutoRefresh() {
    state.calls.push({ method: 'auth.stopAutoRefresh', table: null, body: null });
  },
});

// ─── rpc ──────────────────────────────────────────────────────────────────

const RPC: Record<string, (args: Row) => unknown> = {
  create_circle(args) {
    const caller = state.session?.user.id;
    if (!caller) throw new Refusal(pgError('42501', 'not authenticated'));

    const name = args.circle_name;
    if (!nonBlank(name)) throw new Refusal(pgError('23514', 'circle name is required'));

    const slug =
      String(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 24) || 'circle';
    const invite_code = `${slug}-${uuid().replace(/-/g, '').slice(-16)}`;

    const circle = withDefaults('circles', { name, invite_code, created_by: caller });
    validate('circles', circle, null);
    rowsOf('circles').push(circle);

    const member = withDefaults('circle_members', {
      circle_id: circle.id,
      profile_id: caller,
    });
    validate('circle_members', member, null);
    rowsOf('circle_members').push(member);

    // `returns table (...)` is a set, so PostgREST answers with an array.
    return [{ id: circle.id, invite_code }];
  },

  join_circle_by_code(args) {
    const caller = state.session?.user.id;
    if (!caller) throw new Refusal(pgError('42501', 'not authenticated'));

    const circle = rowsOf('circles').find((c) => c.invite_code === args.code);
    // Deliberately generic, so invite codes cannot be enumerated.
    if (!circle) throw new Refusal(pgError('P0002', 'invalid invite code'));

    const already = rowsOf('circle_members').some(
      (m) => m.circle_id === circle.id && m.profile_id === caller,
    );
    if (!already) {
      rowsOf('circle_members').push(
        withDefaults('circle_members', { circle_id: circle.id, profile_id: caller }),
      );
    }
    return circle.id;
  },
};

// ─── the client ───────────────────────────────────────────────────────────

export function createClient(url: string, key: string, _options?: unknown) {
  if (!url || !key) {
    // supabase-js is loud about this, and a config bug that reaches a real
    // device is worth catching in a unit test.
    throw new Error('supabaseUrl and supabaseKey are required.');
  }

  return {
    auth: makeAuth(),

    from(table: string) {
      return new Builder(table);
    },

    async rpc(name: string, args: Row = {}) {
      if (state.offline) throw new TypeError('Network request failed');
      state.calls.push({ method: 'rpc', table: name, body: args });

      const forced = state.failures.shift();
      if (forced) return { data: null, error: forced };

      const fn = RPC[name];
      if (!fn) {
        return {
          data: null,
          error: pgError(
            'PGRST202',
            `Could not find the function public.${name} in the schema cache`,
          ),
        };
      }
      try {
        return { data: fn(args), error: null };
      } catch (e) {
        if (e instanceof Refusal) return { data: null, error: e.pg };
        throw e;
      }
    },

    channel(_name: string): never {
      throw new Error('realtime is not mocked; that belongs in the integration suite');
    },

    async removeAllChannels() {
      return [] as string[];
    },
  };
}

export type FakeClient = ReturnType<typeof createClient>;

// ─── the control surface ──────────────────────────────────────────────────

export const fakeSupabase = {
  /** Empty database, empty call log, online, anonymous sign-in allowed. */
  reset(): void {
    state.db = emptyDb();
    state.calls = [];
    state.failures = [];
    state.offline = false;
    state.anonymousDisabled = false;
    state.session = null;
    state.listeners.clear();
    seq = 0;
    ticks = 0;
  },

  /**
   * Insert rows directly, with defaults applied and every constraint enforced.
   * Throws rather than returning an envelope: an invalid fixture is a broken
   * test, not a server error under test.
   */
  seed(data: Record<string, Row[]>): void {
    for (const [table, rows] of Object.entries(data)) {
      for (const input of rows) {
        const row = withDefaults(table, input);
        validate(table, row, null);
        rowsOf(table).push(row);
      }
    }
  },

  /** Every row currently in a table, in insertion order. */
  rows(table: string): Row[] {
    return rowsOf(table).map((r) => ({ ...r }));
  },

  /** The next `n` requests answer with this error instead of touching data. */
  failNext(n: number, error: { code: string; message: string; details?: string; hint?: string }): void {
    for (let i = 0; i < n; i += 1) {
      state.failures.push(
        pgError(error.code, error.message, error.details ?? null, error.hint ?? null),
      );
    }
  },

  goOffline(): void {
    state.offline = true;
  },

  goOnline(): void {
    state.offline = false;
  },

  setAnonymousDisabled(disabled: boolean): void {
    state.anonymousDisabled = disabled;
  },

  /** Everything the client was asked to do, oldest first. */
  get calls(): CallLog[] {
    return state.calls;
  },

  get session(): Session | null {
    return state.session;
  },
};

fakeSupabase.reset();
