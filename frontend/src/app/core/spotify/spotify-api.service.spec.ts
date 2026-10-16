import { SpotifyApiService, classifySpotifyHttpError } from './spotify-api.service';

describe('Spotify API error classification', () => {
  it('distinguishes a missing playback device from a generic forbidden response', () => {
    const error = classifySpotifyHttpError(403, 'Player command failed: No active device found');

    expect(error.code).toBe('no_active_device');
    expect(error.status).toBe(403);
    expect(error.message).toContain('Abre o Spotify');
  });

  it('identifies Premium and OAuth scope failures', () => {
    expect(classifySpotifyHttpError(403, 'Premium account required').code).toBe('premium_required');
    expect(classifySpotifyHttpError(403, 'Insufficient client scope').code).toBe(
      'permission_missing',
    );
  });

  it('identifies Development Mode access and quota failures', () => {
    expect(
      classifySpotifyHttpError(403, 'User not registered in the Developer Dashboard').code,
    ).toBe('account_not_allowlisted');
    expect(classifySpotifyHttpError(403, 'Development mode quota exceeded').code).toBe(
      'development_quota_exceeded',
    );
  });

  it('preserves Retry-After for rate limits', () => {
    const error = classifySpotifyHttpError(429, null, 12);

    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterSeconds).toBe(12);
  });
});

describe('Spotify search rate-limit breaker', () => {
  const tooManyRequests = (retryAfter: string | null): Response =>
    new Response('{}', {
      status: 429,
      headers: retryAfter === null ? {} : { 'retry-after': retryAfter },
    });

  const setup = (probe: number | null, responses: Response[]) => {
    const auth = {
      getAccessToken: vi.fn().mockResolvedValue({ accessToken: 'test-token' }),
      probeRateLimit: vi.fn().mockResolvedValue(probe),
    };
    const fetchMock = vi.fn(async () => responses.shift() ?? tooManyRequests(null));
    vi.stubGlobal('fetch', fetchMock);
    return { api: new SpotifyApiService(auth as never), auth, fetchMock };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('uses a long Retry-After header and blocks later searches without a request', async () => {
    const { api, auth, fetchMock } = setup(null, [tooManyRequests('3600')]);

    await expect(api.searchTracks('a')).rejects.toMatchObject({ code: 'rate_limited' });
    expect(api.rateLimitRemainingSeconds()).toBeGreaterThan(3_590);
    expect(auth.probeRateLimit).not.toHaveBeenCalled();

    await expect(api.searchTracks('b')).rejects.toMatchObject({ code: 'rate_limited' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads the real wait through one probe when the WebView hides the header', async () => {
    const { api, auth, fetchMock } = setup(49_080, [tooManyRequests(null)]);

    await expect(api.searchTracks('a')).rejects.toMatchObject({ code: 'rate_limited' });

    expect(auth.probeRateLimit).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(api.rateLimitRemainingSeconds()).toBeGreaterThan(49_000);
  });

  it('escalates the cooldown on consecutive trips when the wait is unknown', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T12:00:00Z'));
    const { api } = setup(null, [tooManyRequests(null), tooManyRequests(null)]);

    await expect(api.searchTracks('a')).rejects.toMatchObject({ code: 'rate_limited' });
    expect(api.rateLimitRemainingSeconds()).toBe(30);

    vi.setSystemTime(new Date('2026-10-07T12:01:00Z'));
    expect(api.rateLimitRemainingSeconds()).toBe(0);
    await expect(api.searchTracks('b')).rejects.toMatchObject({ code: 'rate_limited' });
    expect(api.rateLimitRemainingSeconds()).toBe(300);
  });
});

describe('Spotify request protection', () => {
  const tooManyRequests = (retryAfter: string | null): Response =>
    new Response('{}', {
      status: 429,
      headers: retryAfter === null ? {} : { 'retry-after': retryAfter },
    });
  const ok = (): Response => new Response('{"items":[]}', { status: 200 });

  const setup = (probe: number | null, respond: () => Response | Promise<Response>) => {
    const auth = {
      getAccessToken: vi.fn().mockResolvedValue({ accessToken: 'test-token' }),
      probeRateLimit: vi.fn().mockResolvedValue(probe),
    };
    const fetchMock = vi.fn(async () => respond());
    vi.stubGlobal('fetch', fetchMock);
    return { api: new SpotifyApiService(auth as never), auth, fetchMock };
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('keeps every read off the network during a cooldown but lets playback writes through', async () => {
    const { api, fetchMock } = setup(null, () => tooManyRequests('3600'));
    await expect(api.searchTracks('a')).rejects.toMatchObject({ code: 'rate_limited' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(api.getTopArtists()).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(api.getDevices()).rejects.toMatchObject({ code: 'rate_limited' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(ok());
    await api.pausePlayback('device-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends one probe and trips the breaker once when parallel requests all get a 429', async () => {
    const { api, auth } = setup(null, () => tooManyRequests(null));

    await Promise.allSettled([api.getTopArtists(), api.getTopArtists(), api.getTopArtists()]);

    expect(auth.probeRateLimit).toHaveBeenCalledTimes(1);
    expect(api.rateLimitRemainingSeconds()).toBeLessThanOrEqual(30);
    expect(api.rateLimitRemainingSeconds()).toBeGreaterThan(0);
  });

  it('does not retry a request the caller cancelled', async () => {
    const controller = new AbortController();
    const { api, fetchMock } = setup(null, () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });

    await expect(api.searchTracks('a', controller.signal)).rejects.toBeInstanceOf(DOMException);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
