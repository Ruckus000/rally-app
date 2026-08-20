/**
 * The other half of the resume: whether it should have asked at all.
 *
 * `engine`'s job is *when* (a live session, once). This one's job is *whether*
 * — and the answer is "only for a row that is still `pending`". An account with
 * a screened photo, a refused one, or no photo pays one `select` and stops
 * there; sending it to the screener anyway would hand the model an image it has
 * already judged, on every launch, forever.
 *
 * `lib/supabase` is faked here rather than using the shared in-memory client,
 * because that one has no edge functions on purpose — a screening verdict is a
 * model's answer, and a double that invents one would be lying about the only
 * thing this call is for.
 */
import { supabaseTransport } from '../transport';

const ME = '11111111-1111-4111-8111-111111111111';

const mockSelect = jest.fn();
const mockInvoke = jest.fn();

jest.mock('../../lib/supabase', () => ({
  hasSupabaseConfig: () => true,
  getSupabase: () => ({
    from: () => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => mockSelect(columns, column, value),
      }),
    }),
    functions: { invoke: (fn: string, options: unknown) => mockInvoke(fn, options) },
  }),
}));

const answers = (avatar_state: string | null) =>
  mockSelect.mockResolvedValue({ data: [{ avatar_state }], error: null });

beforeEach(() => {
  mockSelect.mockReset();
  mockInvoke.mockReset();
  mockInvoke.mockResolvedValue({ data: { state: 'ready' }, error: null });
});

it('finishes a screening that was interrupted', async () => {
  answers('pending');

  await supabaseTransport().resumePendingAvatar(ME);

  // No path and no profile in the body: `screen-image` reads `auth.uid()` and
  // the row itself, so there is nothing here for this device to get wrong about
  // which photo it is finishing.
  expect(mockInvoke).toHaveBeenCalledWith('screen-image', { body: {} });
});

it.each(['ready', 'refused', 'none', null])('leaves a %s row alone', async (state) => {
  answers(state);

  await supabaseTransport().resumePendingAvatar(ME);

  expect(mockInvoke).not.toHaveBeenCalled();
});

it('says nothing and throws nothing when the read fails', async () => {
  mockSelect.mockResolvedValue({ data: null, error: { message: 'offline' } });

  await expect(supabaseTransport().resumePendingAvatar(ME)).resolves.toBeUndefined();
  expect(mockInvoke).not.toHaveBeenCalled();
});

it('swallows a screener that cannot be reached, leaving the row pending', async () => {
  answers('pending');
  mockInvoke.mockRejectedValue(new TypeError('Network request failed'));

  // Nothing is waiting on this and there is no queue behind it. The row stays
  // `pending`, which renders initials, and the next launch asks again.
  await expect(supabaseTransport().resumePendingAvatar(ME)).resolves.toBeUndefined();
});
