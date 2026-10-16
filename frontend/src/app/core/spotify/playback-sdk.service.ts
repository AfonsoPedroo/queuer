import { Injectable, signal } from '@angular/core';
import { SpotifyAuthService } from '../auth/spotify-auth.service';
import { MusicShellStore } from '../state/music-shell.store';
import { SpotifyApiService } from './spotify-api.service';
import { Track } from '../models/music.models';

export type PlaybackSdkPhase =
  'idle' | 'loading' | 'connecting' | 'ready' | 'notReady' | 'unsupported' | 'error';

@Injectable({ providedIn: 'root' })
export class PlaybackSdkService {
  readonly phase = signal<PlaybackSdkPhase>('idle');
  readonly deviceId = signal<string | null>(null);
  readonly message = signal(
    'O leitor integrado arranca automaticamente depois de ligares o Spotify.',
  );

  private player: SpotifyPlayer | null = null;
  private loadingPromise: Promise<void> | null = null;
  private preparingPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;

  constructor(
    private readonly auth: SpotifyAuthService,
    private readonly api: SpotifyApiService,
    private readonly store: MusicShellStore,
  ) {}

  prepare(): Promise<void> {
    if (this.phase() === 'ready' && this.player && this.deviceId()) return Promise.resolve();
    this.preparingPromise ??= this.connectPlayer().finally(() => {
      this.preparingPromise = null;
    });
    return this.preparingPromise;
  }

  async runCompatibilityTest(): Promise<void> {
    this.disconnect();
    try {
      await this.prepare();
    } catch {}
  }

  activateForUserGesture(): Promise<string | null> {
    const player = this.player;
    const deviceId = this.deviceId();

    if (player && deviceId) {
      const activation = player.activateElement();
      return activation
        .then(() => this.activateDevice(deviceId))
        .catch(() => this.reportActivationFailure());
    }

    return this.prepare()
      .then(() => {
        const preparedPlayer = this.player;
        const preparedDeviceId = this.deviceId();
        if (!preparedPlayer || !preparedDeviceId) return null;
        return preparedPlayer.activateElement().then(() => this.activateDevice(preparedDeviceId));
      })
      .catch(() => this.reportActivationFailure());
  }

  async transferPlaybackHere(): Promise<void> {
    await this.activateForUserGesture();
  }

  disconnect(): void {
    this.readyReject?.(new Error('player_disconnected'));
    this.readyResolve = null;
    this.readyReject = null;
    this.player?.disconnect();
    this.player = null;
    this.deviceId.set(null);
    this.phase.set('idle');
    this.message.set('O leitor integrado está desligado.');
  }

  private async connectPlayer(): Promise<void> {
    if (!this.auth.isDesktop() || !this.auth.authenticated()) {
      this.phase.set('unsupported');
      this.message.set('Liga primeiro uma conta Spotify Premium.');
      throw new Error('spotify_session_required');
    }

    this.phase.set('loading');
    this.message.set('A preparar reprodução dentro do Queuer…');
    try {
      await this.loadSdk();
      const Spotify = window.Spotify;
      if (!Spotify) throw new Error('sdk_global_missing');

      this.phase.set('connecting');
      const ready = new Promise<void>((resolve, reject) => {
        this.readyResolve = resolve;
        this.readyReject = reject;
        window.setTimeout(() => reject(new Error('sdk_ready_timeout')), 15_000);
      });
      const player = new Spotify.Player({
        name: 'Queuer',
        volume: this.store.volume() / 100,
        enableMediaSession: true,
        getOAuthToken: (callback) => {
          void this.auth
            .getAccessToken()
            .then((grant) => callback(grant.accessToken))
            .catch(() => this.fail('O leitor não conseguiu renovar a sessão do Spotify.'));
        },
      });
      this.player = player;
      this.attachListeners(player);
      if (!(await player.connect())) throw new Error('sdk_connect_failed');
      await ready;
    } catch (error: unknown) {
      if (this.phase() !== 'unsupported') {
        this.fail('O leitor integrado não ficou disponível neste computador.');
      }
      throw error;
    } finally {
      this.readyResolve = null;
      this.readyReject = null;
    }
  }

  private async activateDevice(deviceId: string): Promise<string> {
    await this.api.transferPlayback(deviceId, false);
    this.store.updateRemotePlayback({
      devices: [
        ...this.store
          .devices()
          .filter((device) => device.id !== deviceId)
          .map((device) => ({ ...device, isActive: false })),
        {
          id: deviceId,
          name: 'Queuer',
          type: 'Computer',
          isActive: true,
          isRestricted: false,
          volumePercent: this.store.volume(),
        },
      ],
    });
    this.phase.set('ready');
    this.message.set('Pronto para tocar diretamente no Queuer.');
    return deviceId;
  }

  private reportActivationFailure(): null {
    this.fail('O Queuer não conseguiu ativar o leitor integrado.');
    return null;
  }

  private fail(message: string): void {
    this.phase.set('error');
    this.message.set(message);
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
      this.message.set('Leitor preparado. O primeiro clique em Ouvir ativa-o automaticamente.');
      this.readyResolve?.();
    });
    player.addListener('not_ready', () => {
      this.deviceId.set(null);
      this.phase.set('notReady');
      this.message.set('O leitor Queuer ficou temporariamente offline.');
    });
    player.addListener('initialization_error', () => {
      const error = new Error('eme_not_supported');
      this.fail('Este sistema não disponibilizou a proteção de áudio exigida pelo Spotify.');
      this.readyReject?.(error);
    });
    player.addListener('authentication_error', () => {
      const error = new Error('sdk_authentication_failed');
      this.fail('O Spotify recusou a autenticação do leitor.');
      this.readyReject?.(error);
    });
    player.addListener('account_error', () => {
      const error = new Error('spotify_premium_required');
      this.phase.set('unsupported');
      this.message.set('A reprodução integrada requer Spotify Premium.');
      this.readyReject?.(error);
    });
    player.addListener('playback_error', () => {
      this.fail('O Spotify não conseguiu reproduzir esta música no Queuer.');
    });
    player.addListener('autoplay_failed', () => {
      this.fail('O sistema bloqueou o áudio. Volta a carregar em Ouvir.');
    });
    player.addListener('player_state_changed', (state) => {
      if (!state) return;
      this.store.updateRemotePlayback({
        currentTrack: this.mapSdkTrack(state),
        isPlaying: !state.paused,
        progressSeconds: Math.floor(state.position / 1_000),
        ...(state.shuffle === undefined ? {} : { shuffleEnabled: state.shuffle }),
        ...(state.repeat_mode === undefined
          ? {}
          : {
              repeatMode: state.repeat_mode === 2 ? 'one' : state.repeat_mode === 1 ? 'all' : 'off',
            }),
      });
    });
  }

  private mapSdkTrack(state: SpotifyPlayerState): Track | null {
    const sdkTrack = state.track_window.current_track;
    if (!sdkTrack.id) return null;
    const existing = this.store.trackMap().get(sdkTrack.id);
    const artworkUrl = sdkTrack.album.images[0]?.url;
    const artist = sdkTrack.artists.map((item) => item.name).join(', ');
    return {
      id: sdkTrack.id,
      title: sdkTrack.name,
      artist,
      ...(existing?.artistIds ? { artistIds: existing.artistIds } : {}),
      album: sdkTrack.album.name,
      durationSeconds: Math.round(sdkTrack.duration_ms / 1_000),
      addedAt: existing?.addedAt ?? new Date().toISOString(),
      artwork: artworkUrl
        ? { source: 'spotify', url: artworkUrl, alt: `Capa de ${sdkTrack.album.name}` }
        : (existing?.artwork ?? {
            source: 'placeholder',
            label: sdkTrack.album.name || sdkTrack.name,
          }),
      tags: existing?.tags ?? [],
      playlistIds: existing?.playlistIds ?? [],
      explicit: existing?.explicit ?? false,
      spotifyUrl: existing?.spotifyUrl ?? `https://open.spotify.com/track/${sdkTrack.id}`,
      uri: sdkTrack.uri,
      liked: existing?.liked ?? false,
      source: 'spotify',
      ...(existing?.releaseDate ? { releaseDate: existing.releaseDate } : {}),
    };
  }
}
