import { Injectable, signal } from '@angular/core';
import { SpotifyAuthService } from '../auth/spotify-auth.service';
import { PlaybackDevice, Track } from '../models/music.models';
import { MusicShellStore } from '../state/music-shell.store';
import {
  NO_PLAYBACK_DEVICE_MESSAGE,
  SpotifyApiError,
  SpotifyApiService,
  type SpotifyApiErrorCode,
} from './spotify-api.service';
import { mapSpotifyDevice, mapSpotifyRepeatMode, mapSpotifyTrack } from './spotify-mappers';
import { SpotifyWorkspaceService } from './spotify-workspace.service';

const PLAYBACK_SYNC_INTERVAL_MS = 30_000;
const ERROR_TITLES: Partial<Record<SpotifyApiErrorCode, string>> = {
  no_active_device: 'No playback device',
  premium_required: 'Spotify Premium required',
  account_not_allowlisted: 'Account not allowed',
  development_quota_exceeded: 'Spotify quota reached',
  playback_restricted: 'Playback restricted',
  permission_missing: 'Spotify permission missing',
  authentication_required: 'Spotify sign-in required',
  rate_limited: 'Spotify rate limit reached',
  network_unavailable: 'Spotify is unreachable',
  spotify_unavailable: 'Spotify is unavailable',
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
        if (sequence === this.searchSequence) this.handleError(error, 'Spotify search failed.');
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
      this.store.showToast(
        failedRequests > 0 ? 'Spotify connected with limited data' : 'Spotify connected',
        failedRequests > 0
          ? 'Some Spotify views are unavailable for this account or app configuration.'
          : `${snapshot.tracks.filter((track) => track.liked).length} saved tracks loaded.`,
      );
    } catch (error: unknown) {
      this.handleError(
        error,
        'Spotify data could not be loaded. The fictional demo remains available.',
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
    this.mode.set('demo');
    this.store.restoreDemo();
    this.store.showToast(
      'Signed out',
      'The secure Spotify session was removed from this computer.',
    );
  }

  async openCollection(collectionId: string): Promise<void> {
    if (this.mode() !== 'spotify' || ['home', 'liked', 'recent'].includes(collectionId)) {
      this.store.setCollection(collectionId);
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
        'This playlist cannot be read. In Development Mode, Spotify may expose items only for playlists you own or collaborate on.',
      );
    } finally {
      this.syncing.set(false);
    }
  }

  playTrack(track: Track): Promise<void> {
    if (this.mode() === 'demo') {
      this.store.playTrack(track.id);
      return Promise.resolve();
    }
    if (!track.uri) {
      this.store.showToast('This item cannot be played', 'Spotify did not provide a playable URI.');
      return Promise.resolve();
    }
    this.store.playTrack(track.id);
    return this.enqueueControl(async () => {
      const deviceId = await this.resolvePlaybackDeviceId();
      await this.api.startPlayback(track.uri, deviceId);
    }, true);
  }

  togglePlayback(): Promise<void> {
    if (this.mode() === 'demo') {
      this.store.togglePlayback();
      return Promise.resolve();
    }
    const wasPlaying = this.store.isPlaying();
    this.store.togglePlayback();
    return this.enqueueControl(async () => {
      if (wasPlaying) {
        await this.api.pausePlayback(this.store.activeDevice()?.id);
        return;
      }
      const deviceId = await this.resolvePlaybackDeviceId();
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
    return this.enqueueControl(() =>
      this.api.setShuffle(this.store.shuffleEnabled(), this.store.activeDevice()?.id),
    );
  }

  cycleRepeat(): Promise<void> {
    this.store.cycleRepeat();
    if (this.mode() === 'demo') return Promise.resolve();
    const apiMode =
      this.store.repeatMode() === 'one'
        ? 'track'
        : this.store.repeatMode() === 'all'
          ? 'context'
          : 'off';
    return this.enqueueControl(() => this.api.setRepeat(apiMode, this.store.activeDevice()?.id));
  }

  async transferPlayback(deviceId: string): Promise<boolean> {
    if (this.mode() === 'demo') {
      this.store.showToast('Spotify is not connected');
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
      this.store.showToast('Added to Spotify queue', track.title);
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
        nextLiked ? 'Saved to your tracks' : 'Removed from saved tracks',
        track.title,
      );
    } catch (error: unknown) {
      this.store.setTrackLiked(track.id, !nextLiked);
      this.handleError(error, 'Spotify could not update your saved tracks.');
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
      this.handleError(error, 'The Spotify page could not be opened.');
    }
  }

  // Keep remote controls in order so rapid clicks do not race each other.
  private enqueueControl(action: () => Promise<void>, refreshAfter = false): Promise<void> {
    const run = async (): Promise<void> => {
      try {
        await action();
        if (refreshAfter) await this.refreshPlayback();
      } catch (error: unknown) {
        this.handleError(error, 'Spotify could not complete that playback action.');
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

    this.store.updateRemotePlayback({
      currentTrack: mapSpotifyTrack(
        playback?.item ?? queue?.currently_playing ?? null,
        new Date().toISOString(),
        false,
      ),
      isPlaying: playback?.is_playing ?? false,
      progressSeconds: Math.floor((playback?.progress_ms ?? 0) / 1_000),
      volume: playback?.device.volume_percent ?? null,
      shuffleEnabled: playback?.shuffle_state ?? false,
      repeatMode: mapSpotifyRepeatMode(playback?.repeat_state),
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
        ? (ERROR_TITLES[error.code] ?? 'Spotify action failed')
        : 'Spotify action failed';
    this.store.showToast(title, message, 'error');
  }
}
