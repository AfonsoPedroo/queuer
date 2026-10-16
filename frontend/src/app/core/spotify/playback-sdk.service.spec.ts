import { SpotifyAuthService } from '../auth/spotify-auth.service';
import { MusicShellStore } from '../state/music-shell.store';
import { SpotifyApiService } from './spotify-api.service';
import { PlaybackSdkService } from './playback-sdk.service';

class FakeSpotifyPlayer {
  readonly connect = vi.fn(async () => true);
  readonly disconnect = vi.fn();
  readonly activateElement: ReturnType<typeof vi.fn>;
  private readonly listeners = new Map<string, (payload: unknown) => void>();

  constructor(onActivate: () => void) {
    this.activateElement = vi.fn(async () => onActivate());
  }

  addListener(event: string, callback: (payload: unknown) => void): boolean {
    this.listeners.set(event, callback);
    return true;
  }

  emit(event: string, payload?: unknown): void {
    this.listeners.get(event)?.(payload);
  }
}

describe('PlaybackSdkService', () => {
  let player: FakeSpotifyPlayer;
  let transferPlayback: ReturnType<typeof vi.fn>;
  let service: PlaybackSdkService;
  let store: MusicShellStore;
  let callOrder: string[];

  beforeEach(() => {
    callOrder = [];
    player = new FakeSpotifyPlayer(() => callOrder.push('activate'));
    transferPlayback = vi.fn(async () => {
      callOrder.push('transfer');
      return true;
    });

    const auth = {
      isDesktop: () => true,
      authenticated: () => true,
      getAccessToken: vi.fn(async () => ({ accessToken: 'test-access-token' })),
    } as unknown as SpotifyAuthService;
    const api = { transferPlayback } as unknown as SpotifyApiService;

    const PlayerConstructor = vi.fn(function PlayerConstructor() {
      return player;
    });
    window.Spotify = {
      Player: PlayerConstructor as unknown as new (options: SpotifyPlayerOptions) => SpotifyPlayer,
    };
    store = new MusicShellStore();
    service = new PlaybackSdkService(auth, api, store);
  });

  afterEach(() => {
    delete window.Spotify;
  });

  it('activates protected playback from the user action before transferring playback', async () => {
    const preparing = service.runCompatibilityTest();
    await Promise.resolve();
    player.emit('ready', { device_id: 'queuer-device' });
    await preparing;

    await service.transferPlaybackHere();

    expect(callOrder).toEqual(['activate', 'transfer']);
    expect(transferPlayback).toHaveBeenCalledWith('queuer-device', false);
    expect(service.phase()).toBe('ready');
    expect(service.message()).toContain('diretamente no Queuer');
  });

  it('does not report success when Spotify rejects the device transfer', async () => {
    transferPlayback.mockRejectedValue(new Error('transfer failed'));
    const preparing = service.runCompatibilityTest();
    await Promise.resolve();
    player.emit('ready', { device_id: 'queuer-device' });
    await preparing;

    await service.transferPlaybackHere();

    expect(service.phase()).toBe('error');
    expect(service.message()).toContain('não conseguiu ativar');
  });

  it('requires an authenticated desktop session', async () => {
    const auth = {
      isDesktop: () => true,
      authenticated: () => false,
    } as unknown as SpotifyAuthService;
    service = new PlaybackSdkService(
      auth,
      { transferPlayback } as unknown as SpotifyApiService,
      new MusicShellStore(),
    );

    await service.runCompatibilityTest();

    expect(service.phase()).toBe('unsupported');
    expect(player.connect).not.toHaveBeenCalled();
  });

  it('uses the SDK track as the source of truth for now playing', async () => {
    const preparing = service.runCompatibilityTest();
    await Promise.resolve();
    player.emit('ready', { device_id: 'queuer-device' });
    await preparing;

    player.emit('player_state_changed', {
      paused: false,
      position: 31_000,
      duration: 201_000,
      shuffle: true,
      repeat_mode: 2,
      track_window: {
        current_track: {
          id: 'live-track',
          uri: 'spotify:track:live-track',
          name: 'Live track',
          duration_ms: 201_000,
          artists: [{ name: 'Live artist' }],
          album: { name: 'Live album', images: [{ url: 'https://example.com/cover.jpg' }] },
        },
      },
    });

    expect(store.currentTrack()?.id).toBe('live-track');
    expect(store.currentTrack()?.artist).toBe('Live artist');
    expect(store.progressSeconds()).toBe(31);
    expect(store.isPlaying()).toBe(true);
    expect(store.shuffleEnabled()).toBe(true);
    expect(store.repeatMode()).toBe('one');
  });
});
