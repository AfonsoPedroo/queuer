import { Injectable } from '@angular/core';
import { SpotifyAuthService } from '../auth/spotify-auth.service';
import {
  SpotifyDevicesDto,
  SpotifyPlaybackStateDto,
  SpotifyPlaylistItemsPageDto,
  SpotifyPlaylistsPageDto,
  SpotifyQueueDto,
  SpotifyRecentlyPlayedDto,
  SpotifySavedTracksPageDto,
  SpotifySearchDto,
} from './spotify-api.models';

const API_BASE_URL = 'https://api.spotify.com/v1';
export const NO_PLAYBACK_DEVICE_MESSAGE =
  'No Spotify playback device is available. Open Spotify on this computer or phone, start any track once, and try again.';

interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export type SpotifyApiErrorCode =
  | 'authentication_required'
  | 'permission_missing'
  | 'premium_required'
  | 'account_not_allowlisted'
  | 'development_quota_exceeded'
  | 'playback_restricted'
  | 'rate_limited'
  | 'no_active_device'
  | 'spotify_unavailable'
  | 'network_unavailable'
  | 'unexpected_response';

export class SpotifyApiError extends Error {
  constructor(
    readonly code: SpotifyApiErrorCode,
    message: string,
    readonly status: number | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}

export function classifySpotifyHttpError(
  status: number,
  spotifyMessage: string | null = null,
  retryAfterSeconds: number | null = null,
): SpotifyApiError {
  const reason = spotifyMessage?.trim().toLocaleLowerCase() ?? '';

  if (status === 401) {
    return new SpotifyApiError(
      'authentication_required',
      'Spotify requires you to sign in again.',
      status,
    );
  }

  if (status === 403) {
    if (reason.includes('no active device') || reason.includes('device not found')) {
      return new SpotifyApiError('no_active_device', NO_PLAYBACK_DEVICE_MESSAGE, status);
    }
    if (reason.includes('premium')) {
      return new SpotifyApiError(
        'premium_required',
        'Spotify playback control requires Premium on the signed-in account.',
        status,
      );
    }
    if (
      reason.includes('not registered') ||
      reason.includes('not approved') ||
      reason.includes('allowlist')
    ) {
      return new SpotifyApiError(
        'account_not_allowlisted',
        'This account is not allowed to use the Spotify Development Mode app. Add it under Users Management in the developer dashboard.',
        status,
      );
    }
    if (reason.includes('quota')) {
      return new SpotifyApiError(
        'development_quota_exceeded',
        'This Spotify Development Mode app has reached its request quota. Wait before trying again.',
        status,
      );
    }
    if (reason.includes('scope') || reason.includes('permission')) {
      return new SpotifyApiError(
        'permission_missing',
        'This login is missing a Spotify permission required for that action. Sign out and connect again.',
        status,
      );
    }
    if (reason.includes('restriction')) {
      return new SpotifyApiError(
        'playback_restricted',
        'Spotify blocked playback on the selected device or for this item.',
        status,
      );
    }
    return new SpotifyApiError(
      'permission_missing',
      'Spotify refused this request. Verify Premium, the Development Mode allowlist, and the permissions granted during sign-in.',
      status,
    );
  }

  if (status === 404) {
    return new SpotifyApiError('no_active_device', NO_PLAYBACK_DEVICE_MESSAGE, status);
  }

  if (status === 429) {
    return new SpotifyApiError(
      'rate_limited',
      'Spotify temporarily limited requests. Wait before trying again.',
      status,
      retryAfterSeconds,
    );
  }

  return new SpotifyApiError(
    status >= 500 ? 'spotify_unavailable' : 'unexpected_response',
    status >= 500
      ? 'Spotify is temporarily unavailable.'
      : `Spotify returned an unexpected response (${status}).`,
    status,
  );
}

@Injectable({ providedIn: 'root' })
export class SpotifyApiService {
  constructor(private readonly auth: SpotifyAuthService) {}

  getSavedTracks(): Promise<SpotifySavedTracksPageDto> {
    return this.requestJson('/me/tracks?limit=50');
  }

  getPlaylists(): Promise<SpotifyPlaylistsPageDto> {
    return this.requestJson('/me/playlists?limit=50');
  }

  getPlaylistItems(playlistId: string): Promise<SpotifyPlaylistItemsPageDto> {
    return this.requestJson(`/playlists/${encodeURIComponent(playlistId)}/items?limit=50`);
  }

  getQueue(): Promise<SpotifyQueueDto> {
    return this.requestJson('/me/player/queue');
  }

  getPlaybackState(): Promise<SpotifyPlaybackStateDto | null> {
    return this.requestNullable('/me/player');
  }

  getDevices(): Promise<SpotifyDevicesDto> {
    return this.requestJson('/me/player/devices');
  }

  getRecentlyPlayed(): Promise<SpotifyRecentlyPlayedDto> {
    return this.requestJson('/me/player/recently-played?limit=30');
  }

  searchTracks(query: string, signal?: AbortSignal): Promise<SpotifySearchDto> {
    const params = new URLSearchParams({ q: query, type: 'track', limit: '10' });
    return this.requestJson(`/search?${params.toString()}`, { signal });
  }

  startPlayback(uri?: string, deviceId?: string): Promise<void> {
    const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
    const body = uri ? { uris: [uri] } : undefined;
    return this.requestVoid(`/me/player/play${query}`, { method: 'PUT', body });
  }

  pausePlayback(deviceId?: string): Promise<void> {
    return this.requestVoid(this.withDevice('/me/player/pause', deviceId), { method: 'PUT' });
  }

  next(deviceId?: string): Promise<void> {
    return this.requestVoid(this.withDevice('/me/player/next', deviceId), { method: 'POST' });
  }

  previous(deviceId?: string): Promise<void> {
    return this.requestVoid(this.withDevice('/me/player/previous', deviceId), { method: 'POST' });
  }

  seek(positionMs: number, deviceId?: string): Promise<void> {
    return this.requestVoid(
      this.withDevice(
        `/me/player/seek?position_ms=${Math.max(0, Math.round(positionMs))}`,
        deviceId,
      ),
      { method: 'PUT' },
    );
  }

  setVolume(volumePercent: number, deviceId?: string): Promise<void> {
    const safeVolume = Math.max(0, Math.min(100, Math.round(volumePercent)));
    return this.requestVoid(
      this.withDevice(`/me/player/volume?volume_percent=${safeVolume}`, deviceId),
      { method: 'PUT' },
    );
  }

  setShuffle(enabled: boolean, deviceId?: string): Promise<void> {
    return this.requestVoid(this.withDevice(`/me/player/shuffle?state=${enabled}`, deviceId), {
      method: 'PUT',
    });
  }

  setRepeat(mode: 'off' | 'context' | 'track', deviceId?: string): Promise<void> {
    return this.requestVoid(this.withDevice(`/me/player/repeat?state=${mode}`, deviceId), {
      method: 'PUT',
    });
  }

  transferPlayback(deviceId: string, play = false): Promise<void> {
    return this.requestVoid('/me/player', {
      method: 'PUT',
      body: { device_ids: [deviceId], play },
    });
  }

  addToQueue(uri: string, deviceId?: string): Promise<void> {
    return this.requestVoid(
      this.withDevice(`/me/player/queue?uri=${encodeURIComponent(uri)}`, deviceId),
      { method: 'POST' },
    );
  }

  saveToLibrary(uri: string): Promise<void> {
    return this.requestVoid(`/me/library?uris=${encodeURIComponent(uri)}`, { method: 'PUT' });
  }

  removeFromLibrary(uri: string): Promise<void> {
    return this.requestVoid(`/me/library?uris=${encodeURIComponent(uri)}`, { method: 'DELETE' });
  }

  private async requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(path, options);
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      throw new SpotifyApiError(
        'unexpected_response',
        'Spotify returned an empty response where data was expected.',
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  private async requestNullable<T>(path: string, options: RequestOptions = {}): Promise<T | null> {
    const response = await this.send(path, options);
    if (response.status === 204 || response.headers.get('content-length') === '0') return null;
    return (await response.json()) as T;
  }

  private async requestVoid(path: string, options: RequestOptions = {}): Promise<void> {
    await this.send(path, options);
  }

  private async send(path: string, options: RequestOptions): Promise<Response> {
    const grant = await this.auth.getAccessToken();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
    const abortFromCaller = (): void => controller.abort();
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });

    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${grant.accessToken}`,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });

      if (!response.ok) throw await this.createHttpError(response);
      return response;
    } catch (error: unknown) {
      if (error instanceof SpotifyApiError) throw error;
      throw new SpotifyApiError(
        'network_unavailable',
        'Spotify could not be reached. Check your connection and try again.',
      );
    } finally {
      options.signal?.removeEventListener('abort', abortFromCaller);
      window.clearTimeout(timeoutId);
    }
  }

  private async createHttpError(response: Response): Promise<SpotifyApiError> {
    const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
    let spotifyMessage: string | null = null;
    try {
      const payload = (await response.json()) as {
        readonly error?: { readonly message?: unknown } | string;
      };
      if (typeof payload.error === 'string') spotifyMessage = payload.error;
      else if (typeof payload.error?.message === 'string') spotifyMessage = payload.error.message;
    } catch {}
    return classifySpotifyHttpError(
      response.status,
      spotifyMessage,
      Number.isFinite(retryAfter) ? retryAfter : null,
    );
  }

  private withDevice(path: string, deviceId?: string): string {
    if (!deviceId) return path;
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}device_id=${encodeURIComponent(deviceId)}`;
  }
}
