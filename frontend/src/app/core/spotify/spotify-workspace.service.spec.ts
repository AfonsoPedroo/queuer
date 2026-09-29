import { SpotifyAuthService } from '../auth/spotify-auth.service';
import { SpotifyTrackDto } from './spotify-api.models';
import { SpotifyApiService } from './spotify-api.service';
import { SpotifyWorkspaceService } from './spotify-workspace.service';

const track = (id: string, name: string): SpotifyTrackDto => ({
  id,
  name,
  uri: `spotify:track:${id}`,
  type: 'track',
  duration_ms: 180_000,
  artists: [{ name: 'Artist' }],
  album: { name: 'Album', images: [] },
});

const profile = {
  accountId: 'listener',
  id: 'listener',
  displayName: 'Listener',
  images: [],
  product: 'premium',
  uri: 'spotify:user:listener',
};

const createApi = (recentItems: readonly { track: SpotifyTrackDto; played_at: string }[]) => ({
  getSavedTracks: vi.fn().mockResolvedValue({
    items: [{ track: track('saved', 'Saved'), added_at: '2026-09-01T00:00:00Z' }],
    total: 1,
    next: null,
  }),
  getPlaylists: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
  getRecentlyPlayed: vi.fn().mockResolvedValue({ items: recentItems }),
  getQueue: vi.fn().mockResolvedValue({ currently_playing: null, queue: [] }),
  getPlaybackState: vi.fn().mockResolvedValue(null),
  getDevices: vi.fn().mockResolvedValue({ devices: [] }),
});

describe('SpotifyWorkspaceService', () => {
  it('loads and deduplicates recently played tracks in Spotify order', async () => {
    const api = createApi([
      { track: track('recent', 'Recent'), played_at: '2026-09-03T00:00:00Z' },
      { track: track('saved', 'Saved'), played_at: '2026-09-02T00:00:00Z' },
      { track: track('recent', 'Recent'), played_at: '2026-09-01T00:00:00Z' },
    ]);
    const auth = { getProfile: vi.fn().mockResolvedValue(profile) };
    const service = new SpotifyWorkspaceService(
      auth as unknown as SpotifyAuthService,
      api as unknown as SpotifyApiService,
    );

    const result = await service.load();

    expect(result.snapshot.recentTrackIds).toEqual(['recent', 'saved']);
    expect(result.snapshot.tracks).toHaveLength(2);
    expect(result.snapshot.tracks.find((item) => item.id === 'saved')?.liked).toBe(true);
    expect(result.failedRequests).toBe(0);
  });

  it('keeps the rest of the workspace available when history cannot be loaded', async () => {
    const api = createApi([]);
    api.getRecentlyPlayed.mockRejectedValue(new Error('history unavailable'));
    const auth = { getProfile: vi.fn().mockResolvedValue(profile) };
    const service = new SpotifyWorkspaceService(
      auth as unknown as SpotifyAuthService,
      api as unknown as SpotifyApiService,
    );

    const result = await service.load();

    expect(result.snapshot.recentTrackIds).toEqual([]);
    expect(result.snapshot.tracks.map((item) => item.id)).toEqual(['saved']);
    expect(result.failedRequests).toBe(1);
  });
});
