import { SpotifyAuthService } from '../auth/spotify-auth.service';
import { MusicShellStore } from '../state/music-shell.store';
import { SpotifyIntegrationService } from './spotify-integration.service';
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
    const integration = { transferPlayback } as unknown as SpotifyIntegrationService;

    const PlayerConstructor = vi.fn(function PlayerConstructor() {
      return player;
    });
    window.Spotify = {
      Player: PlayerConstructor as unknown as new (options: SpotifyPlayerOptions) => SpotifyPlayer,
    };
    service = new PlaybackSdkService(auth, integration, new MusicShellStore());
  });

  afterEach(() => {
    delete window.Spotify;
  });

  it('activates protected playback from the user action before transferring playback', async () => {
    await service.runCompatibilityTest();
    player.emit('ready', { device_id: 'queuer-device' });

    await service.transferPlaybackHere();

    expect(callOrder).toEqual(['activate', 'transfer']);
    expect(transferPlayback).toHaveBeenCalledWith('queuer-device');
    expect(service.phase()).toBe('ready');
    expect(service.message()).toContain('now the playback device');
  });

  it('does not report success when Spotify rejects the device transfer', async () => {
    transferPlayback.mockResolvedValue(false);
    await service.runCompatibilityTest();
    player.emit('ready', { device_id: 'queuer-device' });

    await service.transferPlaybackHere();

    expect(service.phase()).toBe('error');
    expect(service.message()).toContain('could not activate');
  });

  it('requires an authenticated desktop session', async () => {
    const auth = {
      isDesktop: () => true,
      authenticated: () => false,
    } as unknown as SpotifyAuthService;
    service = new PlaybackSdkService(
      auth,
      { transferPlayback } as unknown as SpotifyIntegrationService,
      new MusicShellStore(),
    );

    await service.runCompatibilityTest();

    expect(service.phase()).toBe('unsupported');
    expect(player.connect).not.toHaveBeenCalled();
  });
});
