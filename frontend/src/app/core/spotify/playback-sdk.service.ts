import { Injectable, signal } from '@angular/core';
import { SpotifyAuthService } from '../auth/spotify-auth.service';
import { MusicShellStore } from '../state/music-shell.store';
import { SpotifyIntegrationService } from './spotify-integration.service';

export type PlaybackSdkPhase =
  'idle' | 'loading' | 'connecting' | 'ready' | 'notReady' | 'unsupported' | 'error';

@Injectable({ providedIn: 'root' })
export class PlaybackSdkService {
  readonly phase = signal<PlaybackSdkPhase>('idle');
  readonly deviceId = signal<string | null>(null);
  readonly message = signal(
    'Enable Queuer as a Spotify Connect device to play audio without another Spotify app.',
  );

  private player: SpotifyPlayer | null = null;
  private loadingPromise: Promise<void> | null = null;

  constructor(
    private readonly auth: SpotifyAuthService,
    private readonly integration: SpotifyIntegrationService,
    private readonly store: MusicShellStore,
  ) {}
  // Embedded playback stays opt-in because WebView2 DRM support varies between machines.
  async runCompatibilityTest(): Promise<void> {
    if (!this.auth.isDesktop() || !this.auth.authenticated()) {
      this.phase.set('unsupported');
      this.message.set('Connect a Premium Spotify account in the desktop app first.');
      return;
    }

    this.disconnect();
    this.phase.set('loading');
    this.message.set('Loading Spotify’s official Web Playback SDK…');
    try {
      await this.loadSdk();
      const Spotify = window.Spotify;
      if (!Spotify) throw new Error('sdk_global_missing');

      this.phase.set('connecting');
      this.message.set('Creating Queuer as a Spotify Connect playback device…');
      const player = new Spotify.Player({
        name: 'Queuer',
        volume: 0.72,
        enableMediaSession: true,
        getOAuthToken: (callback) => {
          void this.auth
            .getAccessToken()
            .then((grant) => callback(grant.accessToken))
            .catch(() => {
              this.phase.set('error');
              this.message.set('The SDK could not obtain a valid access token.');
            });
        },
      });
      this.player = player;
      this.attachListeners(player);
      const connected = await player.connect();
      if (!connected) {
        this.phase.set('error');
        this.message.set('The SDK loaded but could not connect to Spotify.');
      }
    } catch {
      this.phase.set('error');
      this.message.set('The official SDK could not initialize inside this WebView2 runtime.');
    }
  }

  async transferPlaybackHere(): Promise<void> {
    const deviceId = this.deviceId();
    const player = this.player;
    if (!deviceId || !player) return;
    try {
      // WebView needs a real user interaction before it can play audio.
      await player.activateElement();
      const transferred = await this.integration.transferPlayback(deviceId);
      if (!transferred) throw new Error('playback_transfer_failed');
      this.message.set('Queuer is now the playback device. Choose a track to start listening.');
    } catch {
      this.phase.set('error');
      this.message.set('Queuer could not activate its embedded Spotify playback device.');
    }
  }

  disconnect(): void {
    this.player?.disconnect();
    this.player = null;
    this.deviceId.set(null);
    if (this.phase() === 'ready') {
      this.phase.set('idle');
      this.message.set('Queuer playback disconnected.');
    }
  }

  private loadSdk(): Promise<void> {
    if (window.Spotify) return Promise.resolve();
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => reject(new Error('sdk_load_timeout')), 15_000);
      const previousReadyHandler = window.onSpotifyWebPlaybackSDKReady;
      window.onSpotifyWebPlaybackSDKReady = () => {
        window.clearTimeout(timeoutId);
        previousReadyHandler?.();
        resolve();
      };

      const existing = document.querySelector<HTMLScriptElement>('script[data-queuer-spotify-sdk]');
      if (existing) {
        existing.addEventListener('error', () => reject(new Error('sdk_load_failed')), {
          once: true,
        });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      script.dataset['queuerSpotifySdk'] = 'true';
      script.addEventListener('error', () => reject(new Error('sdk_load_failed')), { once: true });
      document.head.append(script);
    }).finally(() => {
      this.loadingPromise = null;
    });
    return this.loadingPromise;
  }

  private attachListeners(player: SpotifyPlayer): void {
    player.addListener('ready', ({ device_id: deviceId }) => {
      this.deviceId.set(deviceId);
      this.phase.set('ready');
      this.message.set(
        'Queuer connected as a Spotify device. Activate it to confirm protected audio playback.',
      );
    });
    player.addListener('not_ready', () => {
      this.phase.set('notReady');
      this.message.set('The Queuer playback device went offline.');
    });
    player.addListener('initialization_error', () => {
      this.phase.set('error');
      this.message.set(
        'This WebView2 runtime could not initialize Spotify protected playback (EME/DRM).',
      );
    });
    player.addListener('authentication_error', () => {
      this.phase.set('error');
      this.message.set('Spotify rejected the SDK authentication token.');
    });
    player.addListener('account_error', () => {
      this.phase.set('unsupported');
      this.message.set('This playback path requires an eligible Spotify Premium account.');
    });
    player.addListener('playback_error', () => {
      this.phase.set('error');
      this.message.set('The SDK connected but WebView2 could not play this item.');
    });
    player.addListener('autoplay_failed', () => {
      this.phase.set('error');
      this.message.set('WebView2 blocked autoplay. Activate the Queuer player again.');
    });
    player.addListener('player_state_changed', (state) => {
      if (!state) return;
      this.store.isPlaying.set(!state.paused);
      this.store.progressSeconds.set(Math.floor(state.position / 1_000));
    });
  }
}
