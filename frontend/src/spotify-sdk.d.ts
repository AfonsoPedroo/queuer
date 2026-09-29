interface Window {
  Spotify?: {
    Player: new (options: SpotifyPlayerOptions) => SpotifyPlayer;
  };
  onSpotifyWebPlaybackSDKReady?: () => void;
}

interface SpotifyPlayerOptions {
  readonly name: string;
  readonly volume?: number;
  readonly enableMediaSession?: boolean;
  readonly getOAuthToken: (callback: (accessToken: string) => void) => void;
}

interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  activateElement(): Promise<void>;
  addListener(event: 'ready', callback: (payload: { readonly device_id: string }) => void): boolean;
  addListener(
    event: 'not_ready',
    callback: (payload: { readonly device_id: string }) => void,
  ): boolean;
  addListener(
    event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
    callback: (payload: { readonly message: string }) => void,
  ): boolean;
  addListener(
    event: 'player_state_changed',
    callback: (state: SpotifyPlayerState | null) => void,
  ): boolean;
  addListener(event: 'autoplay_failed', callback: () => void): boolean;
}

interface SpotifyPlayerState {
  readonly paused: boolean;
  readonly position: number;
  readonly duration: number;
  readonly track_window: {
    readonly current_track: {
      readonly id: string | null;
      readonly uri: string;
      readonly name: string;
      readonly duration_ms: number;
      readonly artists: readonly { readonly name: string }[];
      readonly album: {
        readonly name: string;
        readonly images: readonly { readonly url: string }[];
      };
    };
  };
}
