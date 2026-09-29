import { classifySpotifyHttpError } from './spotify-api.service';

describe('Spotify API error classification', () => {
  it('distinguishes a missing playback device from a generic forbidden response', () => {
    const error = classifySpotifyHttpError(403, 'Player command failed: No active device found');

    expect(error.code).toBe('no_active_device');
    expect(error.status).toBe(403);
    expect(error.message).toContain('Open Spotify');
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
