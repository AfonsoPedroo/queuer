export interface SpotifyImageDto {
  readonly url: string;
  readonly height?: number | null;
  readonly width?: number | null;
}

export interface SpotifyArtistDto {
  readonly id?: string | null;
  readonly name: string;
  readonly uri?: string;
  readonly external_urls?: { readonly spotify?: string };
}

export interface SpotifyTrackDto {
  readonly id: string | null;
  readonly name: string;
  readonly uri: string;
  readonly type: 'track' | string;
  readonly duration_ms: number;
  readonly explicit?: boolean;
  readonly artists: readonly SpotifyArtistDto[];
  readonly album?: {
    readonly id?: string | null;
    readonly name: string;
    readonly images?: readonly SpotifyImageDto[];
    readonly external_urls?: { readonly spotify?: string };
  };
  readonly external_urls?: { readonly spotify?: string };
  readonly is_local?: boolean;
}

export interface SpotifySavedTracksPageDto {
  readonly items: readonly {
    readonly added_at: string;
    readonly track: SpotifyTrackDto | null;
  }[];
  readonly total: number;
  readonly next: string | null;
}

export interface SpotifyPlaylistDto {
  readonly id: string;
  readonly name: string;
  readonly description?: string | null;
  readonly images?: readonly SpotifyImageDto[];
  readonly owner?: { readonly display_name?: string | null };
  readonly items?: { readonly total: number };
  readonly tracks?: { readonly total: number };
  readonly external_urls?: { readonly spotify?: string };
}

export interface SpotifyPlaylistsPageDto {
  readonly items: readonly SpotifyPlaylistDto[];
  readonly total: number;
  readonly next: string | null;
}

export interface SpotifyPlaylistItemsPageDto {
  readonly items: readonly {
    readonly added_at?: string | null;
    readonly item?: SpotifyTrackDto | null;
    readonly track?: SpotifyTrackDto | null;
  }[];
  readonly total: number;
  readonly next: string | null;
}

export interface SpotifyQueueDto {
  readonly currently_playing: SpotifyTrackDto | null;
  readonly queue: readonly SpotifyTrackDto[];
}

export interface SpotifyPlaybackStateDto {
  readonly device: SpotifyDeviceDto;
  readonly repeat_state: 'off' | 'track' | 'context';
  readonly shuffle_state: boolean;
  readonly is_playing: boolean;
  readonly progress_ms: number | null;
  readonly item: SpotifyTrackDto | null;
}

export interface SpotifyDeviceDto {
  readonly id: string | null;
  readonly is_active: boolean;
  readonly is_private_session: boolean;
  readonly is_restricted: boolean;
  readonly name: string;
  readonly type: string;
  readonly volume_percent: number | null;
}

export interface SpotifyDevicesDto {
  readonly devices: readonly SpotifyDeviceDto[];
}

export interface SpotifySearchDto {
  readonly tracks?: {
    readonly items: readonly SpotifyTrackDto[];
    readonly total: number;
    readonly next: string | null;
  };
}

export interface SpotifyRecentlyPlayedDto {
  readonly items: readonly {
    readonly track: SpotifyTrackDto;
    readonly played_at: string;
  }[];
}
