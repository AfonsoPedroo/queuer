import { Injectable, signal } from '@angular/core';
import { SpotifyAuthService } from '../auth/spotify-auth.service';
import { PlaybackDevice, QueuerMix, Track } from '../models/music.models';
import { I18nService } from '../i18n/i18n.service';
import { MusicShellStore } from '../state/music-shell.store';
import { MixEngineService } from '../mixes/mix-engine.service';
import {
  NO_PLAYBACK_DEVICE_MESSAGE,
  SpotifyApiError,
  SpotifyApiService,
  type SpotifyApiErrorCode,
} from './spotify-api.service';
import { mapSpotifyDevice, mapSpotifyRepeatMode, mapSpotifyTrack } from './spotify-mappers';
import { PlaybackSdkService } from './playback-sdk.service';
import { SpotifyWorkspaceService } from './spotify-workspace.service';

const PLAYBACK_SYNC_INTERVAL_MS = 30_000;
const ERROR_TITLES: Partial<Record<SpotifyApiErrorCode, string>> = {
  no_active_device: 'Nenhum dispositivo disponível',
  premium_required: 'É necessário Spotify Premium',
  account_not_allowlisted: 'Conta sem acesso',
  development_quota_exceeded: 'Limite do Spotify atingido',
  playback_restricted: 'Reprodução bloqueada',
  permission_missing: 'Falta uma permissão do Spotify',
  authentication_required: 'Volta a ligar o Spotify',
  rate_limited: 'Pedidos ao Spotify limitados',
  network_unavailable: 'Não foi possível chegar ao Spotify',
  spotify_unavailable: 'Spotify indisponível',
};

@Injectable({ providedIn: 'root' })
export class SpotifyIntegrationService {
  readonly mode = signal<'demo' | 'spotify'>('demo');
  readonly syncing = signal(false);
  readonly searching = signal(false);
  readonly searchResults = signal<readonly Track[]>([]);
  readonly lastError = signal<string | null>(null);

  private pollingTimer: number | null = null;
  private refreshInProgress: Promise<void> | null = null;
  private controlChain: Promise<void> = Promise.resolve();
  private searchTimer: number | null = null;
  private searchAbortController: AbortController | null = null;
  private searchSequence = 0;

  constructor(
    readonly auth: SpotifyAuthService,
    private readonly api: SpotifyApiService,
    private readonly store: MusicShellStore,
    private readonly workspace: SpotifyWorkspaceService,
    private readonly mixes: MixEngineService,
    private readonly playbackSdk: PlaybackSdkService,
    private readonly i18n: I18nService = new I18nService(),
  ) {}

  async initialize(): Promise<void> {
    await this.auth.initialize();
    if (this.auth.authenticated()) {
      await this.loadSpotifyWorkspace();
    }
  }

  destroy(): void {
    if (this.pollingTimer !== null) window.clearInterval(this.pollingTimer);
    this.pollingTimer = null;
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.searchAbortController?.abort();
    this.searchAbortController = null;
    this.searchSequence += 1;
    this.playbackSdk.disconnect();
    this.auth.destroy();
  }

  searchSpotify(query: string): void {
    if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
    this.searchAbortController?.abort();
    this.searchAbortController = null;
    const normalized = query.trim();
    const sequence = ++this.searchSequence;
    if (this.mode() !== 'spotify' || normalized.length < 2) {
      this.searchResults.set([]);
      this.searching.set(false);
      return;
    }

    this.searching.set(true);
    this.searchTimer = window.setTimeout(async () => {
      const controller = new AbortController();
      this.searchAbortController = controller;
      try {
        const response = await this.api.searchTracks(normalized, controller.signal);
        if (sequence !== this.searchSequence) return;
        const tracks = (response.tracks?.items ?? [])
          .map((track) => mapSpotifyTrack(track, new Date().toISOString(), false))
          .filter((track): track is Track => track !== null);
        this.searchResults.set(tracks);
      } catch (error: unknown) {
        if (sequence === this.searchSequence)
          this.handleError(error, 'A pesquisa no Spotify falhou.');
      } finally {
        if (sequence === this.searchSequence) {
          this.searchAbortController = null;
          this.searching.set(false);
        }
      }
    }, 350);
  }

  async loadSpotifyWorkspace(): Promise<void> {
    if (!this.auth.isDesktop()) return;
    this.syncing.set(true);
    this.lastError.set(null);

    try {
      const { snapshot, failedRequests } = await this.workspace.load();
      this.store.replaceWithSpotify(snapshot);
      this.mode.set('spotify');
      this.startPolling();
      void this.playbackSdk.prepare().catch(() => undefined);
      this.store.showToast(
        failedRequests > 0 ? 'Spotify ligado com dados limitados' : 'Spotify ligado',
        failedRequests > 0
          ? 'Algumas áreas não estão disponíveis para esta conta ou configuração.'
          : this.i18n.t('{count} músicas guardadas carregadas.', {
              count: snapshot.tracks.filter((track) => track.liked).length,
            }),
      );
      try {
        await this.mixes.initialize();
        for (const mix of this.mixes.mixes().filter((item) => item.syncEnabled)) {
          try {
            const synced = await this.syncMixToSpotify(mix);
            this.mixes.markSynced(mix.id, synced.playlistId, synced.spotifyUrl);
          } catch {}
        }
      } catch {
        this.store.showToast(
          'Spotify ligado; mixes por atualizar',
          'Volta a ligar a conta se faltar a permissão para ler os artistas mais ouvidos.',
        );
      }
    } catch (error: unknown) {
      this.handleError(
        error,
        'Não foi possível carregar os dados. A demonstração continua disponível.',
      );
      this.mode.set('demo');
      this.store.restoreDemo();
    } finally {
      this.syncing.set(false);
    }
  }

  async disconnect(): Promise<void> {
    await this.auth.logout();
    this.stopPolling();
    this.playbackSdk.disconnect();
    this.mode.set('demo');
    this.store.restoreDemo();
    this.store.showToast(
      'Sessão terminada',
      'A sessão segura do Spotify foi removida deste computador.',
    );
  }

  async openCollection(collectionId: string, options: { reuse?: boolean } = {}): Promise<void> {
    if (this.mode() !== 'spotify' || ['home', 'liked', 'recent'].includes(collectionId)) {
      this.store.setCollection(collectionId);
      return;
    }
    if (
      options.reuse &&
      this.store.tracks().some((track) => track.playlistIds.includes(collectionId))
    ) {
      this.store.setCollection(collectionId);
      return;
    }

    if (collectionId.startsWith('artist:') || collectionId.startsWith('album:')) {
      const separator = collectionId.indexOf(':');
      const type = collectionId.slice(0, separator);
      let name = collectionId.slice(separator + 1);
      try {
        name = decodeURIComponent(name);
      } catch {}
      this.syncing.set(true);
      try {
        const response = await this.api.searchTracks(`${type}:"${name.replace(/"/g, '')}"`);
        const tracks = (response.tracks?.items ?? [])
          .map((track) => mapSpotifyTrack(track, new Date().toISOString(), false))
          .filter((track): track is Track => track !== null);
        this.store.mergeSpotifyCollection(collectionId, tracks);
      } catch (error: unknown) {
        this.handleError(
          error,
          type === 'artist'
            ? 'Não foi possível abrir o artista.'
            : 'Não foi possível abrir o álbum.',
        );
      } finally {
        this.syncing.set(false);
      }
      return;
    }

    this.syncing.set(true);
    try {
      const page = await this.api.getPlaylistItems(collectionId);
      const tracks = page.items
        .map((entry) =>
          mapSpotifyTrack(
            entry.item ?? entry.track ?? null,
            entry.added_at ?? new Date().toISOString(),
            false,
          ),
        )
        .filter((track): track is Track => track !== null);
      this.store.mergeSpotifyCollection(collectionId, tracks);
    } catch (error: unknown) {
      this.handleError(
        error,
        'Esta playlist não pode ser lida. Em Development Mode, o Spotify pode mostrar apenas playlists tuas ou colaborativas.',
      );
    } finally {
      this.syncing.set(false);
    }
  }

  playTrack(track: Track, contextId: string | null = null): Promise<void> {
    this.store.playbackContextId.set(contextId);
    this.store.registerTracks([track]);
    if (this.mode() === 'demo') {
      this.store.playTrack(track.id);
      return Promise.resolve();
    }
    if (!track.uri) {
      this.store.showToast(
        'Não é possível reproduzir',
        'O Spotify não forneceu uma música válida.',
      );
      return Promise.resolve();
    }
    this.store.playTrack(track.id);
    const queuerDevice = this.playbackSdk.activateForUserGesture();
    return this.enqueueControl(async () => {
      const deviceId = (await queuerDevice) ?? (await this.resolvePlaybackDeviceId());
      await this.api.startPlayback(track.uri, deviceId);
    }, true);
  }

  async extendQueue(tracks: readonly Track[], seedId: string): Promise<void> {
    if (tracks.length === 0 || this.store.currentTrackId() !== seedId) return;
    const known = new Set([seedId, ...this.store.queueIds()]);
    const fresh = tracks.filter((track) => !known.has(track.id));
    if (fresh.length === 0) return;
    this.store.registerTracks(fresh);
    this.store.appendToQueue(fresh.map((track) => track.id));
    if (this.mode() === 'demo' || !this.store.isPlaying()) return;

    const current = this.store.currentTrack();
    const progressMs = this.store.progressSeconds() * 1_000;
    const byId = new Map(this.store.tracks().map((track) => [track.id, track]));
    const uris = [current, ...this.store.queueIds().map((id) => byId.get(id))].flatMap((track) =>
      track?.uri ? [track.uri] : [],
    );
    if (!current?.uri || uris.length < 2) return;
    const queuerDevice = this.playbackSdk.activateForUserGesture();
    await this.enqueueControl(async () => {
      if (this.store.currentTrackId() !== seedId) return;
      const deviceId = (await queuerDevice) ?? (await this.resolvePlaybackDeviceId());
      await this.api.startPlaylistPlayback(uris, deviceId, progressMs);
    });
  }

  playTracks(tracks: readonly Track[], contextId: string | null = null): Promise<void> {
    this.store.playbackContextId.set(contextId);
    this.store.registerTracks(tracks);
    if (this.mode() === 'demo') {
      this.store.playSequence(tracks.map((track) => track.id));
      return Promise.resolve();
    }
    const playable = tracks.filter((track) => track.uri);
    if (playable.length === 0) {
      this.store.showToast('Esta mix ainda não tem músicas reproduzíveis');
      return Promise.resolve();
    }
    this.store.playSequence(playable.map((track) => track.id));
    const queuerDevice = this.playbackSdk.activateForUserGesture();
    return this.enqueueControl(async () => {
      const deviceId = (await queuerDevice) ?? (await this.resolvePlaybackDeviceId());
      await this.api.startPlaylistPlayback(
        playable.flatMap((track) => (track.uri ? [track.uri] : [])),
        deviceId,
      );
    }, true);
  }

  async syncMixToSpotify(
    mix: QueuerMix,
  ): Promise<{ readonly playlistId: string; readonly spotifyUrl?: string }> {
    if (this.mode() !== 'spotify') {
      throw new Error('Liga o Spotify antes de sincronizar uma mix.');
    }
    const uris = mix.tracks.flatMap((track) => (track.uri ? [track.uri] : [])).slice(0, 100);
    if (uris.length === 0) throw new Error('Esta mix ainda não tem músicas para sincronizar.');

    let playlistId = mix.spotifyPlaylistId;
    let spotifyUrl = mix.spotifyUrl;
    if (!playlistId) {
      const playlist = await this.api.createPlaylist(
        `Queuer · ${mix.name}`,
        'Atualizada pelo Queuer. Alterações manuais podem ser substituídas na próxima sincronização.',
      );
      playlistId = playlist.id;
      spotifyUrl = playlist.external_urls?.spotify;
    }
    await this.api.replacePlaylistItems(playlistId, uris);
    this.store.showToast(
      'Mix sincronizada com o Spotify',
      this.i18n.t('{count} músicas · {name}', { count: uris.length, name: mix.name }),
    );
    return { playlistId, ...(spotifyUrl ? { spotifyUrl } : {}) };
  }

  togglePlayback(): Promise<void> {
    if (this.mode() === 'demo') {
      this.store.togglePlayback();
      return Promise.resolve();
    }
    const wasPlaying = this.store.isPlaying();
    this.store.togglePlayback();
    const queuerDevice = wasPlaying
      ? Promise.resolve<string | null>(null)
      : this.playbackSdk.activateForUserGesture();
    return this.enqueueControl(async () => {
      if (wasPlaying) {
        await this.api.pausePlayback(this.store.activeDevice()?.id);
        return;
      }
      const deviceId = (await queuerDevice) ?? (await this.resolvePlaybackDeviceId());
      await this.api.startPlayback(undefined, deviceId);
    }, true);
  }

  next(): Promise<void> {
    if (this.mode() === 'demo') {
      this.store.playNext();
      return Promise.resolve();
    }
    return this.enqueueControl(async () => {
      const deviceId = await this.resolvePlaybackDeviceId();
      await this.api.next(deviceId);
    }, true);
  }

  previous(): Promise<void> {
    if (this.mode() === 'demo') {
      this.store.playPrevious();
      return Promise.resolve();
    }
    return this.enqueueControl(async () => {
      const deviceId = await this.resolvePlaybackDeviceId();
      await this.api.previous(deviceId);
    }, true);
  }

  seek(percent: number): Promise<void> {
    this.store.setProgressPercent(percent);
    if (this.mode() === 'demo') return Promise.resolve();
    const duration = this.store.currentTrack()?.durationSeconds ?? 0;
    return this.enqueueControl(async () => {
      const deviceId = await this.resolvePlaybackDeviceId();
      await this.api.seek((percent / 100) * duration * 1_000, deviceId);
    });
  }

  setVolume(volume: number): Promise<void> {
    this.store.setVolume(volume);
    if (this.mode() === 'demo') return Promise.resolve();
    return this.enqueueControl(() => this.api.setVolume(volume, this.store.activeDevice()?.id));
  }

  toggleMute(): Promise<void> {
    this.store.toggleMute();
    if (this.mode() === 'demo') return Promise.resolve();
    return this.enqueueControl(() =>
      this.api.setVolume(this.store.volume(), this.store.activeDevice()?.id),
    );
  }

  toggleShuffle(): Promise<void> {
    this.store.toggleShuffle();
    if (this.mode() === 'demo') return Promise.resolve();
    const enabled = this.store.shuffleEnabled();
    return this.enqueueControl(async () => {
      try {
        await this.api.setShuffle(enabled, this.store.activeDevice()?.id);
      } catch (error: unknown) {
        this.store.shuffleEnabled.set(!enabled);
        throw error;
      }
    });
  }

  cycleRepeat(): Promise<void> {
    const previousRepeat = this.store.repeatMode();
    this.store.cycleRepeat();
    if (this.mode() === 'demo') return Promise.resolve();
    const apiMode =
      this.store.repeatMode() === 'one'
        ? 'track'
        : this.store.repeatMode() === 'all'
          ? 'context'
          : 'off';
    return this.enqueueControl(async () => {
      try {
        await this.api.setRepeat(apiMode, this.store.activeDevice()?.id);
      } catch (error: unknown) {
        this.store.repeatMode.set(previousRepeat);
        throw error;
      }
    });
  }

  async transferPlayback(deviceId: string): Promise<boolean> {
    if (this.mode() === 'demo') {
      this.store.showToast('O Spotify não está ligado');
      return false;
    }
    let transferred = false;
    await this.enqueueControl(async () => {
      await this.api.transferPlayback(deviceId, this.store.isPlaying());
      transferred = true;
    }, true);
    return transferred;
  }

  addToQueue(track: Track): Promise<void> {
    if (this.mode() === 'demo') {
      this.store.addTrackNext(track.id);
      return Promise.resolve();
    }
    const uri = track.uri;
    if (!uri) return Promise.resolve();
    return this.enqueueControl(async () => {
      const deviceId = await this.resolvePlaybackDeviceId();
      await this.api.addToQueue(uri, deviceId);
      this.store.showToast('Adicionada à fila do Spotify', track.title);
    }, true);
  }

  async toggleSaved(track: Track): Promise<void> {
    if (this.mode() === 'demo') {
      this.store.toggleLiked(track.id);
      return;
    }
    if (!track.uri) return;
    const nextLiked = !track.liked;
    this.store.setTrackLiked(track.id, nextLiked);
    try {
      if (nextLiked) await this.api.saveToLibrary(track.uri);
      else await this.api.removeFromLibrary(track.uri);
      this.store.showToast(
        nextLiked ? 'Guardada na biblioteca' : 'Removida da biblioteca',
        track.title,
      );
    } catch (error: unknown) {
      this.store.setTrackLiked(track.id, !nextLiked);
      this.handleError(error, 'O Spotify não conseguiu atualizar a biblioteca.');
    }
  }

  async openOnSpotify(track: Track): Promise<void> {
    if (!track.spotifyUrl) {
      this.store.showSpotifyUnavailable();
      return;
    }
    try {
      await this.auth.openExternalUrl(track.spotifyUrl);
    } catch (error: unknown) {
      this.handleError(error, 'Não foi possível abrir a página no Spotify.');
    }
  }

  // Keep remote controls in order so rapid clicks do not race each other.
  private enqueueControl(action: () => Promise<void>, refreshAfter = false): Promise<void> {
    const run = async (): Promise<void> => {
      try {
        await action();
        if (refreshAfter) await this.refreshPlayback();
      } catch (error: unknown) {
        this.handleError(error, 'O Spotify não conseguiu concluir esta ação.');
        await this.refreshPlayback();
      }
    };
    this.controlChain = this.controlChain.then(run, run);
    return this.controlChain;
  }

  private refreshPlayback(): Promise<void> {
    if (this.refreshInProgress) return this.refreshInProgress;
    this.refreshInProgress = this.performPlaybackRefresh().finally(() => {
      this.refreshInProgress = null;
    });
    return this.refreshInProgress;
  }

  private async resolvePlaybackDeviceId(): Promise<string> {
    const pickDevice = (devices: readonly PlaybackDevice[]): PlaybackDevice | null =>
      devices.find((device) => device.isActive && !device.isRestricted && device.id) ??
      devices.find((device) => !device.isRestricted && device.id) ??
      null;

    let devices = this.store.devices();
    let device = pickDevice(devices);
    if (!device) {
      const response = await this.api.getDevices();
      devices = response.devices.map(mapSpotifyDevice);
      this.store.updateRemotePlayback({ devices });
      device = pickDevice(devices);
    }

    if (!device) {
      throw new SpotifyApiError('no_active_device', NO_PLAYBACK_DEVICE_MESSAGE);
    }

    if (!device.isActive) {
      await this.api.transferPlayback(device.id, false);
      this.store.updateRemotePlayback({
        devices: devices.map((item) => ({ ...item, isActive: item.id === device.id })),
      });
    }
    return device.id;
  }

  private async performPlaybackRefresh(): Promise<void> {
    if (this.mode() !== 'spotify' || document.hidden) return;
    const [playbackResult, queueResult, devicesResult] = await Promise.allSettled([
      this.api.getPlaybackState(),
      this.api.getQueue(),
      this.api.getDevices(),
    ]);

    const playback = playbackResult.status === 'fulfilled' ? playbackResult.value : null;
    const queue = queueResult.status === 'fulfilled' ? queueResult.value : null;
    const devices = devicesResult.status === 'fulfilled' ? devicesResult.value.devices : undefined;

    const playbackFailed = playbackResult.status === 'rejected';
    this.store.updateRemotePlayback({
      ...(playbackFailed
        ? {}
        : {
            currentTrack: mapSpotifyTrack(
              playback?.item ?? queue?.currently_playing ?? null,
              new Date().toISOString(),
              false,
            ),
            isPlaying: playback?.is_playing ?? false,
            progressSeconds: Math.floor((playback?.progress_ms ?? 0) / 1_000),
            volume: playback?.device.volume_percent ?? null,
          }),
      ...(playback
        ? {
            shuffleEnabled: playback.shuffle_state,
            repeatMode: mapSpotifyRepeatMode(playback.repeat_state),
          }
        : {}),
      ...(devices ? { devices: devices.map(mapSpotifyDevice) } : {}),
      ...(queue
        ? {
            queue: queue.queue
              .map((track) => mapSpotifyTrack(track, new Date().toISOString(), false))
              .filter((track): track is Track => track !== null),
          }
        : {}),
    });
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollingTimer = window.setInterval(
      () => void this.refreshPlayback(),
      PLAYBACK_SYNC_INTERVAL_MS,
    );
  }

  private stopPolling(): void {
    if (this.pollingTimer !== null) window.clearInterval(this.pollingTimer);
    this.pollingTimer = null;
  }

  private handleError(error: unknown, fallback: string): void {
    const message = error instanceof SpotifyApiError ? error.message : fallback;
    this.lastError.set(message);
    const title =
      error instanceof SpotifyApiError
        ? (ERROR_TITLES[error.code] ?? 'Ação do Spotify falhou')
        : 'Ação do Spotify falhou';
    this.store.showToast(title, message, 'error');
  }
}
