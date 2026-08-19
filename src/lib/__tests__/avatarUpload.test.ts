/**
 * The avatar sequence, pinned at the two places it can quietly go wrong.
 *
 * Two properties are worth a test rig at all, and both are invisible from the
 * screen. The first is *what gets uploaded*: a bug that skips the downscale
 * still produces a working avatar, just a 12 MB one carrying the GPS tag of
 * wherever the photo was taken, into a bucket every signed-in account can
 * read. The second is *what gets left behind*: an object with no row, or a row
 * cleared over an object that is still there, both look completely fine to the
 * person who took the photo and are readable by anyone who learns the name.
 *
 * Neither shows up in a screenshot, so they are asserted here — on the calls
 * made and their order, since the actual JPEG encoder is native and there is
 * nothing to be learned from a fake one.
 */
import { pickAndUploadAvatar, clearAvatar } from '../avatarUpload';

/** Every call the module makes to anything outside itself, in order. */
const mockCalls: string[] = [];

const mockPermission = jest.fn();
const mockLaunch = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) => mockPermission(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunch(...args),
}));

/**
 * The manipulator, faked down to the three things this module asks of it: what
 * resize was requested, when the render happened, and some bytes back.
 *
 * `MOCK_RE_ENCODED` is the whole point of the fake — the module never reads the
 * picked file, so if these bytes are what reaches the upload then the upload
 * body came out of the manipulator and not off the camera roll.
 */
const MOCK_RE_ENCODED = 'c21hbGw='; // "small"
const mockResize = jest.fn();
const mockSave = jest.fn();

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: (uri: string) => {
      mockCalls.push(`manipulate:${uri}`);
      const context = {
        resize: (size: unknown) => {
          mockResize(size);
          mockCalls.push('resize');
          return context;
        },
        renderAsync: async () => {
          mockCalls.push('render');
          return { saveAsync: mockSave };
        },
      };
      return context;
    },
  },
}));

const mockUpload = jest.fn();
const mockRemove = jest.fn();
const mockRpc = jest.fn();
const mockInvoke = jest.fn();

jest.mock('../supabase', () => ({
  hasSupabaseConfig: () => true,
  getSupabase: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, body: Uint8Array, options: unknown) => {
          mockCalls.push(`upload:${bucket}:${path}`);
          return mockUpload(path, body, options);
        },
        remove: (paths: string[]) => {
          mockCalls.push(`remove:${paths.join(',')}`);
          return mockRemove(paths);
        },
      }),
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockCalls.push(`rpc:${fn}:${args.p_path}`);
      return mockRpc(fn, args);
    },
    functions: {
      invoke: (fn: string, options: unknown) => {
        mockCalls.push(`invoke:${fn}`);
        return mockInvoke(fn, options);
      },
    },
  }),
}));

const ME = '11111111-1111-4111-8111-111111111111';
jest.mock('../../sync/session', () => ({ currentUserId: () => ME }));

beforeEach(() => {
  mockCalls.length = 0;
  [mockPermission, mockLaunch, mockResize, mockSave, mockUpload, mockRemove, mockRpc, mockInvoke].forEach((m) => m.mockReset());

  mockPermission.mockResolvedValue({ granted: true });
  mockLaunch.mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///camera/IMG_0001.HEIC', width: 4032, height: 3024 }],
  });
  mockSave.mockResolvedValue({ uri: 'file:///cache/out.jpg', base64: MOCK_RE_ENCODED });
  mockUpload.mockResolvedValue({ data: { path: 'ok' }, error: null });
  mockRemove.mockResolvedValue({ data: [], error: null });
  mockRpc.mockResolvedValue({ error: null });
  mockInvoke.mockResolvedValue({ data: { state: 'ready' }, error: null });
});

/** Where in `calls` a thing happened, or -1. */
const at = (prefix: string) => mockCalls.findIndex((c) => c.startsWith(prefix));

describe('what actually goes up', () => {
  it('shrinks to a 512px long edge and re-encodes before anything is uploaded', async () => {
    await pickAndUploadAvatar();

    expect(mockResize).toHaveBeenCalledWith({ width: 512 });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'jpeg', base64: true }),
    );
    // Order, not just occurrence: uploading first and shrinking after would
    // satisfy both assertions above and send the camera original.
    expect(at('render')).toBeGreaterThanOrEqual(0);
    expect(at('render')).toBeLessThan(at('upload:'));
  });

  it('uploads the re-encoded bytes, as jpeg, under the signed-in account', async () => {
    await pickAndUploadAvatar();

    const [path, body, options] = mockUpload.mock.calls[0];
    expect(body).toEqual(new Uint8Array([115, 109, 97, 108, 108])); // "small"
    expect(path).toMatch(new RegExp(`^${ME}/[0-9a-f-]+\\.jpg$`));
    expect(options).toMatchObject({ contentType: 'image/jpeg' });
  });

  it('resizes on the height when the photo is taller than it is wide', async () => {
    mockLaunch.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///camera/tall.jpg', width: 3024, height: 4032 }],
    });
    await pickAndUploadAvatar();
    expect(mockResize).toHaveBeenCalledWith({ height: 512 });
  });

  it('leaves a photo that is already small alone', async () => {
    mockLaunch.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///camera/tiny.jpg', width: 200, height: 200 }],
    });
    await pickAndUploadAvatar();
    expect(mockResize).not.toHaveBeenCalled();
  });
});

describe('nothing points at bytes that are not there', () => {
  it('does not call set_avatar when the upload failed', async () => {
    mockUpload.mockResolvedValue({ data: null, error: { message: 'network' } });

    await expect(pickAndUploadAvatar()).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('deletes the object it just uploaded when set_avatar fails', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'nope' } });

    const result = await pickAndUploadAvatar();
    expect(result).toEqual({ ok: false, reason: 'failed' });
    const uploaded = mockUpload.mock.calls[0][0];
    expect(mockRemove).toHaveBeenCalledWith([uploaded]);
  });
});

describe('screening', () => {
  it('returns a renderable outcome on a refusal and does not report a photo', async () => {
    mockInvoke.mockResolvedValue({ data: { state: 'refused' }, error: null });

    await expect(pickAndUploadAvatar()).resolves.toEqual({ ok: false, reason: 'blocked' });
    // The edge function already deleted the object and wrote `refused`, so the
    // client neither deletes nor clears — but it must not answer `ok`.
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][1].p_path).toEqual(expect.any(String));
  });

  it('rolls the upload back when screening cannot be reached', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'offline' } });

    await expect(pickAndUploadAvatar()).resolves.toEqual({ ok: false, reason: 'failed' });
    const uploaded = mockUpload.mock.calls[0][0];
    expect(mockRemove).toHaveBeenCalledWith([uploaded]);
    expect(mockRpc).toHaveBeenLastCalledWith('set_avatar', { p_path: null });
  });

  it('reports the path only once the screener says ready', async () => {
    const result = await pickAndUploadAvatar();
    const uploaded = mockUpload.mock.calls[0][0];
    expect(result).toEqual({ ok: true, path: uploaded });
    expect(mockInvoke).toHaveBeenCalledWith('screen-image', { body: {} });
  });
});

describe('clearing and replacing', () => {
  it('deletes the object as well as clearing the row, in that order', async () => {
    await expect(clearAvatar(`${ME}/old.jpg`)).resolves.toBe(true);

    expect(mockRemove).toHaveBeenCalledWith([`${ME}/old.jpg`]);
    expect(mockRpc).toHaveBeenCalledWith('set_avatar', { p_path: null });
    // Clearing the row first would leave a delete that fails invisible behind
    // a profile that already looks empty.
    expect(at('remove:')).toBeLessThan(at('rpc:'));
  });

  it('leaves the row alone when the object could not be deleted', async () => {
    mockRemove.mockResolvedValue({ data: null, error: { message: 'denied' } });

    await expect(clearAvatar(`${ME}/old.jpg`)).resolves.toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('deletes the old object when a photo is replaced', async () => {
    const old = `${ME}/old.jpg`;
    await pickAndUploadAvatar(old);

    expect(mockRemove).toHaveBeenCalledWith([old]);
    // After the row moved, never before: a replace that dies mid-flight should
    // leave the old photo working rather than a row over missing bytes.
    expect(at(`rpc:set_avatar:${ME}/`)).toBeLessThan(at(`remove:${old}`));
  });
});

describe('outcomes rather than throws', () => {
  it('reports a refused permission and never opens the picker', async () => {
    mockPermission.mockResolvedValue({ granted: false });

    await expect(pickAndUploadAvatar()).resolves.toEqual({ ok: false, reason: 'no-permission' });
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('reports a cancelled pick', async () => {
    mockLaunch.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickAndUploadAvatar()).resolves.toEqual({ ok: false, reason: 'cancelled' });
  });

  it('does not throw when the picker itself blows up', async () => {
    mockLaunch.mockRejectedValue(new Error('activity destroyed'));
    await expect(pickAndUploadAvatar()).resolves.toEqual({ ok: false, reason: 'failed' });
  });

  it('does not throw when the manipulator blows up', async () => {
    mockSave.mockRejectedValue(new Error('out of memory'));
    await expect(pickAndUploadAvatar()).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
