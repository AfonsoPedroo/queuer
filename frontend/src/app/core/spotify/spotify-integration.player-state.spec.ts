import { TestBed } from '@angular/core/testing';
import { MusicShellStore } from '../state/music-shell.store';
import { SpotifyApiService } from './spotify-api.service';
import { SpotifyIntegrationService } from './spotify-integration.service';

const setup = (api: Partial<Record<keyof SpotifyApiService, unknown>>) => {
  TestBed.configureTestingModule({
    providers: [{ provide: SpotifyApiService, useValue: api }],
  });
  const store = TestBed.inject(MusicShellStore);
  const integration = TestBed.inject(SpotifyIntegrationService);
  integration.mode.set('spotify');
  const refresh = () =>
    (
      integration as unknown as { performPlaybackRefresh(): Promise<void> }
    ).performPlaybackRefresh();
  return { store, integration, refresh };
};

describe('SpotifyIntegrationService player state', () => {
  it('keeps shuffle, repeat and the playing track when the playback request fails', async () => {
    const { store, refresh } = setup({
      getPlaybackState: vi.fn().mockRejectedValue(new Error('429')),
      getQueue: vi.fn().mockRejectedValue(new Error('429')),
      getDevices: vi.fn().mockRejectedValue(new Error('429')),
    });
    store.shuffleEnabled.set(true);
    store.repeatMode.set('all');
    store.currentTrackId.set('playing-now');
    store.isPlaying.set(true);

    await refresh();

    expect(store.shuffleEnabled()).toBe(true);
    expect(store.repeatMode()).toBe('all');
    expect(store.currentTrackId()).toBe('playing-now');
    expect(store.isPlaying()).toBe(true);
  });

  it('keeps shuffle when Spotify reports no active playback, but stops the player', async () => {
    const { store, refresh } = setup({
      getPlaybackState: vi.fn().mockResolvedValue(null),
      getQueue: vi.fn().mockResolvedValue(null),
      getDevices: vi.fn().mockResolvedValue({ devices: [] }),
    });
    store.shuffleEnabled.set(true);
    store.isPlaying.set(true);

    await refresh();

    expect(store.shuffleEnabled()).toBe(true);
    expect(store.isPlaying()).toBe(false);
  });

  it('takes shuffle from Spotify when it reports a state', async () => {
    const { store, refresh } = setup({
      getPlaybackState: vi.fn().mockResolvedValue({
        is_playing: true,
        progress_ms: 0,
        shuffle_state: false,
        repeat_state: 'off',
        device: { id: 'd', name: 'Queuer', type: 'Computer', is_active: true, volume_percent: 50 },
        item: null,
      }),
      getQueue: vi.fn().mockResolvedValue(null),
      getDevices: vi.fn().mockResolvedValue({ devices: [] }),
    });
    store.shuffleEnabled.set(true);

    await refresh();

    expect(store.shuffleEnabled()).toBe(false);
  });

  it('puts shuffle back when Spotify refuses the change', async () => {
    const { store, integration } = setup({
      setShuffle: vi.fn().mockRejectedValue(new Error('no device')),
      getPlaybackState: vi.fn().mockRejectedValue(new Error('x')),
      getQueue: vi.fn().mockRejectedValue(new Error('x')),
      getDevices: vi.fn().mockRejectedValue(new Error('x')),
    });
    expect(store.shuffleEnabled()).toBe(false);

    await integration.toggleShuffle();

    expect(store.shuffleEnabled()).toBe(false);
  });
});
