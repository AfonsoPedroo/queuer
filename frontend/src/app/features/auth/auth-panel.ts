import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { PlaybackSdkService } from '../../core/spotify/playback-sdk.service';
import { SpotifyIntegrationService } from '../../core/spotify/spotify-integration.service';
import { UiIcon } from '../../shared/ui-icon/ui-icon';

@Component({
  selector: 'app-auth-panel',
  imports: [TranslatePipe, UiIcon],
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
        return 'À espera do browser';
      case 'exchangingCode':
        return 'A concluir a ligação segura';
      case 'refreshing':
        return 'A renovar a sessão';
      case 'authenticated':
        return 'Ligado';
      case 'sessionAvailable':
        return 'Sessão guardada disponível';
      case 'signedOut':
        return 'Pronto para ligar';
      case 'error':
        return 'Precisa de atenção';
      default:
        return 'Configuração necessária';
    }
  });

  protected readonly playbackLabel = computed(() => {
    switch (this.playbackSdk.phase()) {
      case 'ready':
        return 'Pronto';
      case 'loading':
      case 'connecting':
        return 'A preparar';
      case 'error':
      case 'notReady':
        return 'Indisponível';
      case 'unsupported':
        return 'Não suportado';
      default:
        return 'A iniciar';
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
