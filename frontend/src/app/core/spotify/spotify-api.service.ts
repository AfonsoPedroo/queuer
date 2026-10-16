import { Injectable } from '@angular/core';
import { SpotifyAuthService } from '../auth/spotify-auth.service';
import {
  SpotifyDevicesDto,
  SpotifyAlbumTracksPageDto,
  SpotifyAlbumsPageDto,
  SpotifyPlaybackStateDto,
  SpotifyPlaylistItemsPageDto,
  SpotifyPlaylistsPageDto,
  SpotifyQueueDto,
  SpotifyRecentlyPlayedDto,
  SpotifySavedTracksPageDto,
  SpotifySearchDto,
  SpotifyTopItemsPageDto,
  SpotifyTopTracksPageDto,
  SpotifyPlaylistDto,
} from './spotify-api.models';

const API_BASE_URL = 'https://api.spotify.com/v1';
const MAX_SEARCH_LIMIT = 10;
const MAX_SHORT_WAIT_SECONDS = 10;
const COOLDOWN_STEPS_SECONDS = [30, 300, 1800];
export const NO_PLAYBACK_DEVICE_MESSAGE =
  'Não há nenhum dispositivo Spotify disponível. Abre o Spotify neste computador ou telemóvel, inicia uma música e tenta novamente.';

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
  | 'search_budget_exhausted'
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
      'O Spotify precisa que voltes a iniciar sessão.',
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
        'O controlo de reprodução requer Spotify Premium.',
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
        'Esta conta não tem acesso à aplicação em Development Mode. Adiciona-a em Users Management no painel do Spotify.',
        status,
      );
    }
    if (reason.includes('quota')) {
      return new SpotifyApiError(
        'development_quota_exceeded',
        'A aplicação atingiu o limite temporário de pedidos do Spotify. Tenta novamente mais tarde.',
        status,
      );
    }
    if (reason.includes('scope') || reason.includes('permission')) {
      return new SpotifyApiError(
        'permission_missing',
        'Falta uma permissão necessária. Termina a sessão e volta a ligar o Spotify.',
        status,
      );
    }
    if (reason.includes('restriction')) {
      return new SpotifyApiError(
        'playback_restricted',
        'O Spotify bloqueou a reprodução neste dispositivo ou para esta música.',
        status,
      );
    }
    return new SpotifyApiError(
      'permission_missing',
      'O Spotify recusou o pedido. Verifica o Premium, a allowlist e as permissões da sessão.',
      status,
    );
  }

  if (status === 404) {
    return new SpotifyApiError('no_active_device', NO_PLAYBACK_DEVICE_MESSAGE, status);
  }

  if (status === 429) {
    return new SpotifyApiError(
      'rate_limited',
      'O Spotify limitou temporariamente os pedidos. Espera um pouco e tenta novamente.',
      status,
      retryAfterSeconds,
    );
  }

  return new SpotifyApiError(
    status >= 500 ? 'spotify_unavailable' : 'unexpected_response',
    status >= 500
      ? 'O Spotify está temporariamente indisponível.'
      : `O Spotify devolveu uma resposta inesperada (${status}).`,
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

  private readonly searchFailureCounts = new Map<string, number>();

  searchFailureSummary(): string {
    return [...this.searchFailureCounts].map(([reason, count]) => `${reason} ×${count}`).join(', ');
  }

  resetSearchFailures(): void {
    this.searchFailureCounts.clear();
  }

  private rateLimitedUntil = 0;
  private consecutiveRateLimitTrips = 0;
  private probeInFlight: Promise<number | null> | null = null;

  rateLimitRemainingSeconds(): number {
    return Math.max(0, Math.ceil((this.rateLimitedUntil - Date.now()) / 1_000));
  }

  private searchBudget: number | null = null;
  private searchesUsed = 0;

  beginSearchBudget(limit: number): void {
    this.searchBudget = limit;
    this.searchesUsed = 0;
  }

  endSearchBudget(): void {
    this.searchBudget = null;
  }

  searchBudgetRemaining(): number {
    return this.searchBudget === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, this.searchBudget - this.searchesUsed);
  }

  searchTracks(query: string, signal?: AbortSignal, limit = 10): Promise<SpotifySearchDto> {
    if (this.searchBudgetRemaining() === 0) {
      const message = 'Este refresh já usou as pesquisas que tinha disponíveis no Spotify.';
      return Promise.reject(new SpotifyApiError('search_budget_exhausted', message));
    }
    this.searchesUsed += 1;

    const remaining = this.rateLimitRemainingSeconds();
    if (remaining > 0) {
      return Promise.reject(this.rateLimitError(remaining));
    }

    const params = new URLSearchParams({
      q: query,
      type: 'track',
      limit: String(Math.min(MAX_SEARCH_LIMIT, Math.max(1, limit))),
    });
    return this.requestJson<SpotifySearchDto>(`/search?${params.toString()}`, { signal })
      .then((result) => {
        this.consecutiveRateLimitTrips = 0;
        return result;
      })
      .catch((error: unknown) => {
        if (error instanceof SpotifyApiError) {
          const reason = `${error.status ?? 'sem-estado'}:${error.code}`;
          this.searchFailureCounts.set(reason, (this.searchFailureCounts.get(reason) ?? 0) + 1);
        }
        throw error;
      });
  }

  getTopArtists(
    timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term',
    limit = 20,
  ): Promise<SpotifyTopItemsPageDto> {
    const params = new URLSearchParams({ time_range: timeRange, limit: String(limit) });
    return this.requestJson(`/me/top/artists?${params.toString()}`);
  }

  getTopTracks(
    timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term',
    limit = 50,
  ): Promise<SpotifyTopTracksPageDto> {
    const params = new URLSearchParams({ time_range: timeRange, limit: String(limit) });
    return this.requestJson(`/me/top/tracks?${params.toString()}`);
  }

  getArtistAlbums(artistId: string, limit = 10): Promise<SpotifyAlbumsPageDto> {
    const params = new URLSearchParams({ limit: String(limit) });
    return this.requestJson(`/artists/${encodeURIComponent(artistId)}/albums?${params.toString()}`);
  }

  getAlbumTracks(albumId: string, limit = 50): Promise<SpotifyAlbumTracksPageDto> {
    return this.requestJson(
      `/albums/${encodeURIComponent(albumId)}/tracks?limit=${Math.min(50, Math.max(1, limit))}`,
    );
  }

  createPlaylist(name: string, description: string): Promise<SpotifyPlaylistDto> {
    return this.requestJson('/me/playlists', {
      method: 'POST',
      body: { name, description, public: false },
    });
  }

  replacePlaylistItems(playlistId: string, uris: readonly string[]): Promise<void> {
    return this.requestVoid(`/playlists/${encodeURIComponent(playlistId)}/items`, {
      method: 'PUT',
      body: { uris: uris.slice(0, 100) },
    });
  }

  startPlayback(uri?: string, deviceId?: string): Promise<void> {
    const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
    const body = uri ? { uris: [uri] } : undefined;
    return this.requestVoid(`/me/player/play${query}`, { method: 'PUT', body });
  }

  startPlaylistPlayback(
    uris: readonly string[],
    deviceId?: string,
    positionMs?: number,
  ): Promise<void> {
    const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
    return this.requestVoid(`/me/player/play${query}`, {
      method: 'PUT',
      body: {
        uris: uris.slice(0, 100),
        ...(positionMs && positionMs > 0 ? { position_ms: Math.round(positionMs) } : {}),
      },
    });
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
        'O Spotify devolveu uma resposta vazia onde eram esperados dados.',
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

  private async send(path: string, options: RequestOptions, retryAttempt = 0): Promise<Response> {
    const cooldown = this.rateLimitRemainingSeconds();
    const isRead = (options.method ?? 'GET') === 'GET';
    if (isRead && cooldown > 0) {
      throw this.rateLimitError(cooldown);
    }
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

      if (!response.ok) {
        const error = await this.createHttpError(response);
        if (error.code === 'rate_limited') {
          return await this.handleRateLimit(error, path, options, retryAttempt);
        }
        throw error;
      }
      this.consecutiveRateLimitTrips = 0;
      return response;
    } catch (error: unknown) {
      if (error instanceof SpotifyApiError) throw error;
      if (options.signal?.aborted) throw error;
      if (retryAttempt < 2) {
        await this.sleep(1000);
        return this.send(path, options, retryAttempt + 1);
      }
      throw new SpotifyApiError(
        'network_unavailable',
        'Não foi possível contactar o Spotify. Verifica a ligação e tenta novamente.',
      );
    } finally {
      options.signal?.removeEventListener('abort', abortFromCaller);
      window.clearTimeout(timeoutId);
    }
  }

  private rateLimitError(seconds: number): SpotifyApiError {
    return new SpotifyApiError(
      'rate_limited',
      'O Spotify limitou temporariamente os pedidos. Espera um pouco e tenta novamente.',
      429,
      seconds,
    );
  }

  private async handleRateLimit(
    error: SpotifyApiError,
    path: string,
    options: RequestOptions,
    retryAttempt: number,
  ): Promise<Response> {
    if (this.rateLimitRemainingSeconds() > 0) throw error;

    const waitSeconds = await this.findOutHowLongToWait(error);
    if (this.rateLimitRemainingSeconds() > 0) throw error;

    const isShortWait = waitSeconds !== null && waitSeconds <= MAX_SHORT_WAIT_SECONDS;
    if (isShortWait && retryAttempt < 2) {
      await this.sleep(waitSeconds * 1000);
      return this.send(path, options, retryAttempt + 1);
    }

    this.startCooldown(waitSeconds);
    throw error;
  }

  private async findOutHowLongToWait(error: SpotifyApiError): Promise<number | null> {
    if (error.retryAfterSeconds !== null) {
      return Math.max(1, error.retryAfterSeconds);
    }

    if (this.probeInFlight === null) {
      this.probeInFlight = this.auth.probeRateLimit().finally(() => {
        this.probeInFlight = null;
      });
    }
    const seconds = await this.probeInFlight;
    if (seconds === null) return null;
    return Math.max(1, seconds);
  }

  private startCooldown(waitFromSpotify: number | null): void {
    this.consecutiveRateLimitTrips += 1;
    const step = Math.min(this.consecutiveRateLimitTrips, COOLDOWN_STEPS_SECONDS.length) - 1;
    const stepSeconds = COOLDOWN_STEPS_SECONDS[step] ?? 30;
    const seconds = Math.max(waitFromSpotify ?? 0, stepSeconds);
    const until = Date.now() + seconds * 1000;
    this.rateLimitedUntil = Math.max(this.rateLimitedUntil, until);
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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
