/**
 * The authoring scripts' Supabase client, with the key checks in one place.
 *
 * Three scripts need this now — the drafter writes candidates, the review CLI
 * approves them, the seeder publishes them — and all three are reaching a table
 * with RLS on and no policy. The service-role key is the only way in, which is
 * exactly why none of this is something the app can do.
 *
 * The key is read from the environment and never written anywhere.
 */
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { fromEnvFile } from './env.mjs';

export function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    console.error(
      'SUPABASE_SERVICE_ROLE_KEY is not set.\n' +
        'Find it under Project Settings → API in the Supabase dashboard, and pass it\n' +
        'on the command line rather than putting it in .env — that file is for the\n' +
        'publishable key, and this one bypasses every policy in the database.',
    );
    process.exit(1);
  }

  // A key goes into an HTTP header, and a header can only hold ASCII — so a
  // placeholder pasted verbatim out of a README fails deep inside fetch with
  // "Cannot convert argument to a ByteString", naming a character code and
  // nothing else. Caught here, where the answer is obvious.
  if (!/^[\x21-\x7e]{20,}$/.test(key)) {
    console.error(
      'That does not look like a service-role key.\n' +
        'If you copied the command from a README, replace the … with the real key —\n' +
        'it is a long run of plain ASCII, starting with "sb_secret_" or "eyJ".',
    );
    process.exit(1);
  }

  /** The URL is not a secret and is already in .env, next to the publishable key. */
  const url = fromEnvFile('EXPO_PUBLIC_SUPABASE_URL');
  if (!url) {
    console.error('No EXPO_PUBLIC_SUPABASE_URL, in the environment or in .env.');
    process.exit(1);
  }

  // The url comes back too: every caller that writes wants to say out loud
  // which project it is about to write to, and looking it up twice invites the
  // two answers to differ.
  const db = createClient(url, key, {
    auth: { persistSession: false },
    // Node 20 has no global WebSocket and supabase-js builds a realtime client
    // eagerly, so `createClient` throws without this. The same line, for the
    // same reason, is in integration/support/clients.ts — the app itself needs
    // neither, because React Native provides WebSocket natively.
    realtime: { transport: ws },
  });

  return { db, url };
}
