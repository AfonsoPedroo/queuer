import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { PlaybackSdkService } from '../../core/spotify/playback-sdk.service';
import { SpotifyIntegrationService } from '../../core/spotify/spotify-integration.service';
import { UiIcon } from '../../shared/ui-icon/ui-icon';

@Component({
  selector: 'app-auth-panel',
  imports: [UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './auth-panel.html',
  styleUrl: './auth-panel.scss',
})
export class AuthPanel {
  readonly closed = output<void>();
  readonly connected = output<void>();

  protected readonly integration = inject(SpotifyIntegrationService);
  protected readonly playbackSdk = inject(PlaybackSdkService);
  protected readonly auth = this.integration.auth;
  protected readonly clientIdInput = signal(this.auth.clientId());
  protected readonly copied = signal(false);

  protected readonly phaseLabel = computed(() => {
    switch (this.auth.status().phase) {
      case 'authorizing':
        return 'Waiting for your browser';
      case 'exchangingCode':
        return 'Completing secure exchange';
      case 'refreshing':
        return 'Refreshing session';
      case 'authenticated':
        return 'Connected';
      case 'sessionAvailable':
        return 'Saved session available';
      case 'signedOut':
        return 'Ready to connect';
      case 'error':
        return 'Needs attention';
      default:
        return 'Setup required';
    }
  });

  protected updateClientId(event: Event): void {
    this.clientIdInput.set((event.target as HTMLInputElement).value);
    this.auth.clearError();
  }

  protected async connect(): Promise<void> {
    try {
      const clientId = this.clientIdInput().trim();
      if (!this.auth.configured() || clientId !== this.auth.clientId()) {
        await this.auth.configure(clientId);
      }
      await this.auth.login();
      this.connected.emit();
    } catch {}
  }

  protected async disconnect(): Promise<void> {
    try {
      await this.integration.disconnect();
    } catch {}
  }

  protected async copyRedirect(): Promise<void> {
    await navigator.clipboard.writeText(this.auth.status().redirectUriRegistration);
    this.copied.set(true);
    window.setTimeout(() => this.copied.set(false), 1_500);
  }
}
