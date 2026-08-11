/**
 * Stop the stack only if this run started it. A developer who already had one
 * running keeps it, which is what makes the second run fast.
 */
const { execFileSync } = require('node:child_process');

module.exports = async () => {
  if (process.env.RALLY_IT_STARTED_BY_US !== '1') {
    console.log('[integration] leaving the pre-existing Supabase stack running');
    return;
  }
  console.log('[integration] stopping the Supabase stack this run started');
  execFileSync('npx', ['supabase', 'stop', '--no-backup'], { stdio: 'inherit' });
};
