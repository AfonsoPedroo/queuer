import { computed, Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { AccessTokenGrant, AuthStatus, CommandError, SpotifyProfile } from './auth.models';

const CLIENT_ID_STORAGE_KEY = 'queuer.spotify-client-id';
const REDIRECT_REGISTRATION = 'http://127.0.0.1:43821/callback';

const INITIAL_STATUS: AuthStatus = {
  phase: 'unconfigured',
  configured: false,
  authenticated: false,
  hasStoredSession: false,
  expiresAtUnixMs: null,
  scopes: [],
  redirectUriRegistration: REDIRECT_REGISTRATION,
};

@Injectable({ providedIn: 'root' })
export class SpotifyAuthService {
  readonly isDesktop = signal(this.detectTauri());
  readonly status = signal<AuthStatus>(INITIAL_STATUS);
  readonly profile = signal<SpotifyProfile | null>(null);
  readonly clientId = signal('');
  readonly busy = signal(false);
  readonly error = signal<CommandError | null>(null);

  readonly authenticated = computed(() => this.status().authenticated);
  readonly configured = computed(() => this.status().configured);
  readonly displayName = computed(() => this.profile()?.displayName ?? 'Spotify account');

  private initialization: Promise<void> | null = null;
  private unlistenStatus: UnlistenFn | null = null;

  initialize(): Promise<void> {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  }

  async configure(clientId: string, remember = true): Promise<void> {
    const normalized = clientId.trim();
    if (!this.isDesktop()) {
      this.error.set({
        code: 'desktop_required',
        message: 'Spotify sign-in is available in the desktop application.',
        recoverable: true,
      });
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      const status = await invoke<AuthStatus>('spotify_configure', { clientId: normalized });
      this.clientId.set(normalized);
      this.status.set(status);
      if (remember) localStorage.setItem(CLIENT_ID_STORAGE_KEY, normalized);
    } catch (error: unknown) {
      this.error.set(this.toCommandError(error));
      throw error;
    } finally {
      this.busy.set(false);
    }
  }

  async login(): Promise<SpotifyProfile> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const profile = await invoke<SpotifyProfile>('spotify_start_login');
      this.profile.set(profile);
      await this.refreshStatus();
      return profile;
    } catch (error: unknown) {
      this.error.set(this.toCommandError(error));
      throw error;
    } finally {
      this.busy.set(false);
    }
  }

  async cancelLogin(): Promise<void> {
    try {
      await invoke('spotify_cancel_login');
    } catch (error: unknown) {
      this.error.set(this.toCommandError(error));
    }
  }

  async logout(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const status = await invoke<AuthStatus>('spotify_logout');
      this.status.set(status);
      this.profile.set(null);
    } catch (error: unknown) {
      this.error.set(this.toCommandError(error));
      throw error;
    } finally {
      this.busy.set(false);
    }
  }

  async getAccessToken(): Promise<AccessTokenGrant> {
    if (!this.isDesktop()) {
      throw new Error('desktop_required');
    }
    try {
      const grant = await invoke<AccessTokenGrant>('spotify_get_valid_access_token');
      await this.refreshStatus();
      return grant;
    } catch (error: unknown) {
      this.error.set(this.toCommandError(error));
      throw error;
    }
  }

  async getProfile(): Promise<SpotifyProfile> {
    const profile = await invoke<SpotifyProfile>('spotify_get_profile');
    this.profile.set(profile);
    return profile;
  }

  async openExternalUrl(url: string): Promise<void> {
    if (!this.isDesktop()) return;
    await invoke('open_external_url', { url });
  }

  clearError(): void {
    this.error.set(null);
  }

  destroy(): void {
    this.unlistenStatus?.();
    this.unlistenStatus = null;
  }

  private async initializeOnce(): Promise<void> {
    if (!this.isDesktop()) return;

    this.unlistenStatus = await listen<AuthStatus>('spotify-auth://status', (event) => {
      this.status.set(event.payload);
    });

    const rememberedClientId = localStorage.getItem(CLIENT_ID_STORAGE_KEY)?.trim() ?? '';
    if (rememberedClientId) {
      this.clientId.set(rememberedClientId);
      try {
        await this.configure(rememberedClientId, false);
      } catch {
        return;
      }
    } else {
      await this.refreshStatus();
    }

    if (this.status().hasStoredSession) {
      try {
        await this.getProfile();
        await this.refreshStatus();
      } catch {}
    }
  }

  private async refreshStatus(): Promise<void> {
    if (!this.isDesktop()) return;
    const status = await invoke<AuthStatus>('spotify_auth_status');
    this.status.set(status);
  }

  private detectTauri(): boolean {
    return (
      typeof window !== 'undefined' &&
      Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__')
    );
  }

  private toCommandError(error: unknown): CommandError {
    if (this.isCommandError(error)) return error;
    return {
      code: 'desktop_command_failed',
      message: 'The desktop application could not complete that action.',
      recoverable: true,
    };
  }

  private isCommandError(value: unknown): value is CommandError {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
      typeof record['code'] === 'string' &&
      typeof record['message'] === 'string' &&
      typeof record['recoverable'] === 'boolean'
    );
  }
}
