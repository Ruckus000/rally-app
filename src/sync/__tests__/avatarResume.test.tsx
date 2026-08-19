/**
 * Picking up an avatar screening this device abandoned.
 *
 * The leak: `pickAndUploadAvatar` uploads the bytes, writes `pending`, and
 * *then* asks the screener. Kill the app in that gap — a crash, a swipe-up, a
 * dead battery — and the row stays `pending` over a live object in a bucket
 * every signed-in account can read, with nothing on the client that ever looks
 * at it again. Nobody would report it either: `pending` renders initials, so to
 * its owner it looks exactly like a photo that was never uploaded.
 *
 * So a session becoming ready asks once. It is safe to ask when there is
 * nothing to finish (one `select`) and safe to ask twice (`mark_avatar_screened`
 * moves only rows that are still `pending`, so a duplicate verdict cannot
 * republish something the owner has since removed).
 *
 * Asserted at the engine seam rather than through `functions.invoke`, because
 * the strict Supabase fake has no edge functions and would be lying if it did.
 * What is being pinned here is *when* the resume is asked for — on a live
 * session, once, and never in a demo mode.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';

import { fakeSupabase } from '../../__mocks__/@supabase/supabase-js';
import { StoreProvider } from '../../state/store';
import { __resetSupabaseForTests } from '../../lib/supabase';
import { __resetSessionForTests, currentUserId } from '../session';
import { __resetOutboxForTests } from '../outbox';
import * as transportModule from '../transport';

const realEnv = { ...process.env };
const mockResume = jest.fn();
let build: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  // Without these `hasSupabaseConfig()` is false and every assertion below
  // passes for the wrong reason — no client is ever built for any account.
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  fakeSupabase.reset();
  __resetSupabaseForTests();
  __resetSessionForTests();
  __resetOutboxForTests();

  mockResume.mockReset();
  mockResume.mockResolvedValue(undefined);
  // The real transport, with the one call this file is about recorded. The
  // rest stays real so the engine's own pull still works and this does not
  // become a test of a fake talking to itself.
  const real = transportModule.supabaseTransport;
  build = jest
    .spyOn(transportModule, 'supabaseTransport')
    .mockImplementation(() => ({ ...real(), resumePendingAvatar: mockResume }));
});

afterEach(() => {
  build.mockRestore();
  jest.useRealTimers();
  process.env = { ...realEnv };
});

const mount = (account: 'live' | 'seeded') =>
  render(
    <StoreProvider persist sync restored={{ account }}>
      {null}
    </StoreProvider>,
  );

const settle = async (ms = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

it('asks once when a live session becomes ready', async () => {
  mount('live');
  await settle();

  const me = currentUserId();
  expect(me).toBeTruthy();
  expect(mockResume).toHaveBeenCalledWith(me);
});

it('does not ask again on every poll', async () => {
  mount('live');
  await settle();
  // Four more pull cycles. The row is finished or it never was pending; either
  // way this is a `select` a minute, forever, for nothing.
  await settle(4 * 60_000);

  expect(mockResume).toHaveBeenCalledTimes(1);
});

it('never asks for a demo account, which makes no network calls at all', async () => {
  mount('seeded');
  await settle(5 * 60_000);

  // Not merely "resume was not called": no transport is built at all, because
  // no engine is. `syncOn` is false in every demo mode, and this feature sits
  // behind that same gate rather than beside it.
  expect(build).not.toHaveBeenCalled();
  expect(mockResume).not.toHaveBeenCalled();
});
