/**
 * The signing cache for goal photos, pinned at the three things that depend on
 * it being right.
 *
 * **Churn.** Every pull hands this the whole feed's worth of paths, and realtime
 * kicks a pull on any change behind a 400 ms debounce. Signing per pull would be
 * a round trip per photo per keystroke somebody else is making — and, worse, it
 * would mint a new URL each time, which makes `sameMoments` and `carryThreads`
 * report every card as changed and re-render the feed on a timer. The stability
 * of the string is load-bearing, not just the call count.
 *
 * **Bearer tokens.** A signed URL is a link anybody can follow. They are held in
 * memory, never written to disk, and dropped on sign-out.
 *
 * **Failure is a missing photo, never a failed pull.** A path that cannot be
 * signed is absent from the answer; the rows are still worth having.
 */
import { cachedMediaUrl, resetMediaUrls, signMediaUrls, MEDIA_URL_TTL_SECONDS } from '../mediaUrl';

const mockSign = jest.fn();
jest.mock('../../sync/transport', () => ({
  signMedia: (paths: string[], seconds: number) => mockSign(paths, seconds),
}));

const P1 = 'owner-1/task-1/media-1.jpg';
const P2 = 'owner-1/task-2/media-2.jpg';

/** Answers every path it is given, so a test can assert on what was asked. */
const signsEverything = () =>
  mockSign.mockImplementation(async (paths: string[]) =>
    Object.fromEntries(paths.map((p, i) => [p, `https://signed.test/${p}?sig=${i}`])),
  );

beforeEach(() => {
  resetMediaUrls();
  mockSign.mockReset();
  signsEverything();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the cache in front of signing', () => {
  it('signs a path once and keeps handing back the same string', async () => {
    const first = await signMediaUrls([P1]);
    const second = await signMediaUrls([P1]);

    expect(mockSign).toHaveBeenCalledTimes(1);
    // Same string, not merely a valid one. A different URL each pull would read
    // as "this card changed" to every guard downstream.
    expect(second[P1]).toBe(first[P1]);
  });

  it('asks only for the paths it does not already hold', async () => {
    await signMediaUrls([P1]);
    mockSign.mockClear();

    await signMediaUrls([P1, P2]);

    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockSign.mock.calls[0]![0]).toEqual([P2]);
  });

  it('makes one request for a path two overlapping pulls both want', async () => {
    // Realtime kicks a pull on every change, so two pulls in flight over the
    // same feed is the ordinary case rather than the rare one.
    let release: (v: Record<string, string>) => void = () => {};
    mockSign.mockImplementation(
      () => new Promise<Record<string, string>>((resolve) => (release = resolve)),
    );

    const a = signMediaUrls([P1]);
    const b = signMediaUrls([P1]);
    release({ [P1]: 'https://signed.test/one' });

    expect(await a).toEqual({ [P1]: 'https://signed.test/one' });
    expect(await b).toEqual({ [P1]: 'https://signed.test/one' });
    expect(mockSign).toHaveBeenCalledTimes(1);
  });

  it('signs for an hour, not the week the transport used to default to', async () => {
    await signMediaUrls([P1]);
    expect(mockSign).toHaveBeenCalledWith([P1], MEDIA_URL_TTL_SECONDS);
    expect(MEDIA_URL_TTL_SECONDS).toBe(3600);
  });

  it('re-signs once the URL is close enough to expiry to be no use', async () => {
    jest.useFakeTimers();
    const first = await signMediaUrls([P1]);

    // Past the refresh margin: a URL handed out now might still be loading when
    // it dies, so the cache stops offering it.
    jest.setSystemTime(Date.now() + MEDIA_URL_TTL_SECONDS * 1000);
    expect(cachedMediaUrl(P1)).toBeNull();

    mockSign.mockClear();
    signsEverything();
    const second = await signMediaUrls([P1]);

    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(second[P1]).toBeDefined();
    expect(first[P1]).toBeDefined();
  });
});

describe('when signing does not work', () => {
  it('leaves the path out rather than failing the pull', async () => {
    mockSign.mockResolvedValue({});

    await expect(signMediaUrls([P1])).resolves.toEqual({});
  });

  it('survives a transport that throws', async () => {
    // Offline, or no Supabase config at all in a demo build.
    mockSign.mockRejectedValue(new Error('Network request failed'));

    await expect(signMediaUrls([P1])).resolves.toEqual({});
  });

  it('does not cache a failure, so the next pull asks again', async () => {
    mockSign.mockResolvedValue({});
    await signMediaUrls([P1]);

    mockSign.mockClear();
    signsEverything();
    const retried = await signMediaUrls([P1]);

    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(retried[P1]).toBeDefined();
  });

  it('signs the paths it can when one of a batch fails', async () => {
    mockSign.mockResolvedValue({ [P2]: 'https://signed.test/two' });

    const out = await signMediaUrls([P1, P2]);

    expect(out).toEqual({ [P2]: 'https://signed.test/two' });
  });
});

describe('sign-out', () => {
  it('forgets every URL, because they outlive the account by an hour', async () => {
    await signMediaUrls([P1]);
    expect(cachedMediaUrl(P1)).not.toBeNull();

    resetMediaUrls();

    expect(cachedMediaUrl(P1)).toBeNull();
  });
});
