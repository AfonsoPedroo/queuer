export type AuthPhase =
  | 'unconfigured'
  | 'signedOut'
  | 'sessionAvailable'
  | 'authorizing'
  | 'exchangingCode'
  | 'refreshing'
  | 'authenticated'
  | 'error';

export interface AuthStatus {
  readonly phase: AuthPhase;
  readonly configured: boolean;
  readonly authenticated: boolean;
  readonly hasStoredSession: boolean;
  readonly expiresAtUnixMs: number | null;
  readonly scopes: readonly string[];
  readonly redirectUriRegistration: string;
}

export interface AccessTokenGrant {
  readonly accessToken: string;
  readonly expiresAtUnixMs: number;
}

export interface SpotifyProfile {
  readonly accountId: string;
  readonly id: string;
  readonly displayName: string | null;
  readonly images: readonly {
    readonly url: string;
    readonly height: number | null;
    readonly width: number | null;
  }[];
  readonly product: string | null;
  readonly uri: string;
}

export interface CommandError {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
}
