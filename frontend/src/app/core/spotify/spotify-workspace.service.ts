import { Injectable } from '@angular/core';
import { SpotifyAuthService } from '../auth/spotify-auth.service';
import { SpotifyWorkspaceSnapshot, Track } from '../models/music.models';
import { SpotifyApiService } from './spotify-api.service';
import {
  mapSpotifyDevice,
  mapSpotifyPlaylist,
  mapSpotifyRepeatMode,
  mapSpotifyTrack,
} from './spotify-mappers';

export interface SpotifyWorkspaceResult {
  readonly snapshot: SpotifyWorkspaceSnapshot;
  readonly failedRequests: number;
}

@Injectable({ providedIn: 'root' })
export class SpotifyWorkspaceService {
  constructor(
    private readonly auth: SpotifyAuthService,
    private readonly api: SpotifyApiService,
  ) {}

  async load(): Promise<SpotifyWorkspaceResult> {
    const profile = await this.auth.getProfile();
    const [savedResult, playlistsResult, recentResult, queueResult, playbackResult, devicesResult] =
      await Promise.allSettled([
        this.api.getSavedTracks(),
        this.api.getPlaylists(),
        this.api.getRecentlyPlayed(),
        this.api.getQueue(),
        this.api.getPlaybackState(),
        this.api.getDevices(),
      ]);

    const savedPage = savedResult.status === 'fulfilled' ? savedResult.value : null;
    const savedTracks = (savedPage?.items ?? [])
      .map((item) => mapSpotifyTrack(item.track, item.added_at, true))
      .filter((track): track is Track => track !== null);
    const likedIds = new Set(savedTracks.map((track) => track.id));

    const recentPage = recentResult.status === 'fulfilled' ? recentResult.value : null;
    const recentTracks = (recentPage?.items ?? [])
      .map((item) => mapSpotifyTrack(item.track, item.played_at, likedIds.has(item.track.id ?? '')))
      .filter((track): track is Track => track !== null);
    const recentTrackIds = [...new Set(recentTracks.map((track) => track.id))];

    const tracks = new Map(savedTracks.map((track) => [track.id, track]));
    for (const track of recentTracks) {
      const savedTrack = tracks.get(track.id);
      tracks.set(
        track.id,
        savedTrack ? { ...track, addedAt: savedTrack.addedAt, liked: true } : track,
      );
    }

    const queueResponse = queueResult.status === 'fulfilled' ? queueResult.value : null;
    const queue = (queueResponse?.queue ?? [])
      .map((track) =>
        mapSpotifyTrack(track, new Date().toISOString(), likedIds.has(track.id ?? '')),
      )
      .filter((track): track is Track => track !== null);

    const playback = playbackResult.status === 'fulfilled' ? playbackResult.value : null;
    const playbackTrack = playback?.item ?? queueResponse?.currently_playing ?? null;
    const currentTrack = mapSpotifyTrack(
      playbackTrack,
      new Date().toISOString(),
      likedIds.has(playbackTrack?.id ?? ''),
    );

    const playlists = (
      playlistsResult.status === 'fulfilled' ? playlistsResult.value.items : []
    ).map(mapSpotifyPlaylist);
    const devices = (devicesResult.status === 'fulfilled' ? devicesResult.value.devices : []).map(
      mapSpotifyDevice,
    );

    const snapshot: SpotifyWorkspaceSnapshot = {
      tracks: [...tracks.values()],
      recentTrackIds,
      playlists,
      queue,
      currentTrack,
      isPlaying: playback?.is_playing ?? false,
      progressSeconds: Math.floor((playback?.progress_ms ?? 0) / 1_000),
      volume: playback?.device.volume_percent ?? null,
      shuffleEnabled: playback?.shuffle_state ?? false,
      repeatMode: mapSpotifyRepeatMode(playback?.repeat_state),
      devices,
      profile: {
        accountId: profile.accountId || profile.id,
        displayName: profile.displayName?.trim() || 'Spotify listener',
        ...(profile.images[0]?.url ? { imageUrl: profile.images[0].url } : {}),
      },
    };

    const failedRequests = [
      savedResult,
      playlistsResult,
      recentResult,
      queueResult,
      playbackResult,
      devicesResult,
    ].filter((result) => result.status === 'rejected').length;

    return { snapshot, failedRequests };
  }
}
