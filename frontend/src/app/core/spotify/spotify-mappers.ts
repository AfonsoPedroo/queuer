import { PlaybackDevice, Playlist, RepeatMode, Track } from '../models/music.models';
import {
  SpotifyDeviceDto,
  SpotifyPlaybackStateDto,
  SpotifyPlaylistDto,
  SpotifyTrackDto,
} from './spotify-api.models';

export function mapSpotifyTrack(
  dto: SpotifyTrackDto | null,
  addedAt: string,
  liked: boolean,
): Track | null {
  if (!dto?.id || dto.type !== 'track' || dto.is_local) return null;

  const image = dto.album?.images?.[0];
  const artists = dto.artists
    .map((artist) => artist.name)
    .filter(Boolean)
    .join(', ');

  return {
    id: dto.id,
    title: dto.name,
    artist: artists || 'Unknown artist',
    album: dto.album?.name ?? 'Unknown album',
    durationSeconds: Math.max(0, Math.round(dto.duration_ms / 1_000)),
    addedAt,
    artwork: image?.url
      ? { source: 'spotify', url: image.url, alt: `Artwork for ${dto.album?.name ?? dto.name}` }
      : { source: 'placeholder', label: `No artwork available for ${dto.name}` },
    tags: [],
    playlistIds: [],
    explicit: dto.explicit ?? false,
    liked,
    uri: dto.uri,
    spotifyUrl: dto.external_urls?.spotify,
    source: 'spotify',
  };
}

export function mapSpotifyPlaylist(dto: SpotifyPlaylistDto): Playlist {
  const image = dto.images?.[0];

  return {
    id: dto.id,
    name: dto.name,
    description: dto.description?.trim() || 'Spotify playlist',
    artwork: image?.url
      ? { source: 'spotify', url: image.url, alt: `Artwork for ${dto.name}` }
      : { source: 'placeholder', label: `No artwork available for ${dto.name}` },
    ownerLabel: dto.owner?.display_name?.trim() || 'Spotify',
    trackCount: dto.items?.total ?? dto.tracks?.total ?? 0,
    spotifyUrl: dto.external_urls?.spotify,
    source: 'spotify',
  };
}

export function mapSpotifyDevice(dto: SpotifyDeviceDto): PlaybackDevice {
  return {
    id: dto.id ?? '',
    name: dto.name,
    type: dto.type,
    isActive: dto.is_active,
    isRestricted: dto.is_restricted,
    volumePercent: dto.volume_percent,
  };
}

export function mapSpotifyRepeatMode(
  value: SpotifyPlaybackStateDto['repeat_state'] | undefined,
): RepeatMode {
  if (value === 'track') return 'one';
  if (value === 'context') return 'all';
  return 'off';
}
