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
  readonly artistIds?: readonly string[];
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
  readonly releaseDate?: string;
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

export type MixKind = 'discovery' | 'releases' | 'daily' | 'rediscover' | 'repeat' | 'custom';
export type MixAccent = 'ember' | 'moss' | 'ocean' | 'plum' | 'sand' | 'slate';

export interface QueuerMix {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: MixKind;
  readonly accent: MixAccent;
  readonly tracks: readonly Track[];
  readonly targetCount: number;
  readonly updatedAt: string;
  readonly prompt?: string;
  readonly spotifyPlaylistId?: string;
  readonly spotifyUrl?: string;
  readonly syncEnabled?: boolean;
}

export interface ListeningHistorySummary {
  readonly importedAt: string;
  readonly firstPlayedAt: string | null;
  readonly lastPlayedAt: string | null;
  readonly playCount: number;
  readonly distinctTrackCount: number;
  readonly totalHours: number;
  readonly sourceFileCount: number;
  readonly topArtists: readonly { readonly name: string; readonly plays: number }[];
  readonly topTracks: readonly {
    readonly title: string;
    readonly artist: string;
    readonly plays: number;
  }[];
}

export type PlaylistPrototypeMode =
  'adjacent' | 'deep-cuts' | 'rediscover' | 'era' | 'comfort' | 'contrast';

export interface PlaylistPrototype {
  readonly id: string;
  readonly mode: PlaylistPrototypeMode;
  readonly seedArtists: readonly string[];
  readonly seedTracks: readonly { readonly title: string; readonly artist: string }[];
  readonly era: string;
  readonly discoveryPercent: number;
  readonly brief: string;
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
