/**
 * Bring up a local Supabase stack for the integration suite — or reuse one
 * that is already running.
 *
 * Plain CommonJS on purpose: globalSetup runs outside Jest's module registry,
 * and this is the one place where a transform surprise costs an hour.
 *
 * If a stack is already up we leave it alone and, crucially, do not stop it in
 * teardown — a developer's running stack surviving the suite means the second
 * run starts in seconds instead of a minute.
 */
const { execFileSync } = require('node:child_process');

const EXCLUDE = 'studio,imgproxy,logflare,vector,edge-runtime,supavisor,mailpit';

const sh = (args, opts = {}) =>
  execFileSync('npx', ['supabase', ...args], {
    encoding: 'utf8',
    stdio: opts.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    ...opts,
  });

const status = () => {
  try {
    return JSON.parse(sh(['status', '-o', 'json'], { quiet: true }));
  } catch {
    return null;
  }
};

module.exports = async () => {
  let info = status();
  let startedByUs = false;

  if (!info) {
    console.log('\n[integration] starting a local Supabase stack…');
    sh(['start', '-x', EXCLUDE]);
    startedByUs = true;
    info = status();
    if (!info) throw new Error('supabase start reported success but status is unreadable');
  } else {
    console.log('\n[integration] reusing the Supabase stack already running');
  }

  // Applies both migrations and runs supabase/seed.sql. The only full reset in
  // the run; per-test isolation is a truncate (see support/reset.ts).
  sh(['db', 'reset', '--local']);

  process.env.RALLY_IT_URL = info.API_URL;
  process.env.RALLY_IT_ANON_KEY = info.ANON_KEY;
  process.env.RALLY_IT_SERVICE_KEY = info.SERVICE_ROLE_KEY;
  process.env.RALLY_IT_DB_URL = info.DB_URL;
  process.env.RALLY_IT_STARTED_BY_US = startedByUs ? '1' : '';

  globalThis.__RALLY_STARTED_SUPABASE__ = startedByUs;
};
