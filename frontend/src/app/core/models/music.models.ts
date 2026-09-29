export type DemoArtworkVariant =
  | 'aurora'
  | 'cinder'
  | 'dusk'
  | 'forest'
  | 'glacier'
  | 'halo'
  | 'lagoon'
  | 'orchid'
  | 'solar'
  | 'velvet';

export type Artwork =
  | {
      readonly source: 'demo';
      readonly variant: DemoArtworkVariant;
      readonly monogram: string;
    }
  | {
      readonly source: 'spotify';
      readonly url: string;
      readonly alt: string;
    }
  | {
      readonly source: 'placeholder';
      readonly label: string;
    };

export interface Track {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly durationSeconds: number;
  readonly addedAt: string;
  readonly artwork: Artwork;
  readonly tags: readonly string[];
  readonly playlistIds: readonly string[];
  readonly explicit: boolean;
  readonly spotifyUrl?: string;
  readonly uri?: string;
  readonly liked: boolean;
  readonly source?: 'demo' | 'spotify';
}

export interface Playlist {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly artwork: Artwork;
  readonly ownerLabel: string;
  readonly trackCount: number;
  readonly spotifyUrl?: string;
  readonly source?: 'demo' | 'spotify';
}

export interface UserProfile {
  readonly accountId: string;
  readonly displayName: string;
  readonly imageUrl?: string;
}

export interface PlaybackDevice {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly isActive: boolean;
  readonly isRestricted: boolean;
  readonly volumePercent: number | null;
}

export interface SpotifyWorkspaceSnapshot {
  readonly tracks: readonly Track[];
  readonly recentTrackIds: readonly string[];
  readonly playlists: readonly Playlist[];
  readonly queue: readonly Track[];
  readonly currentTrack: Track | null;
  readonly isPlaying: boolean;
  readonly progressSeconds: number;
  readonly volume: number | null;
  readonly shuffleEnabled: boolean;
  readonly repeatMode: RepeatMode;
  readonly devices: readonly PlaybackDevice[];
  readonly profile: UserProfile;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface ToastMessage {
  readonly id: number;
  readonly title: string;
  readonly detail?: string;
  readonly tone: 'neutral' | 'error';
}

export interface PaletteCommand {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly icon: string;
  readonly shortcut?: string;
  readonly keywords: readonly string[];
  readonly disabled?: boolean;
  readonly run: () => void;
}
