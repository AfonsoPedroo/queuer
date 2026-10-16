import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  inject,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { SpotifyIntegrationService } from '../../core/spotify/spotify-integration.service';
import { MusicShellStore } from '../../core/state/music-shell.store';
import { UiIcon } from '../../shared/ui-icon/ui-icon';
import { WorkspaceNavigationService } from '../../core/navigation/workspace-navigation.service';

@Component({
  selector: 'app-topbar',
  imports: [TranslatePipe, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './topbar.html',
  styleUrl: './topbar.scss',
})
export class Topbar {
  readonly openAccount = output<void>();
  readonly openSettings = output<void>();

  protected readonly store = inject(MusicShellStore);
  protected readonly integration = inject(SpotifyIntegrationService);
  protected readonly navigation = inject(WorkspaceNavigationService);
  protected readonly deviceMenuOpen = signal(false);

  protected openCollection(collectionId: string): void {
    if (collectionId === 'home') this.navigation.goHome();
    else this.navigation.openCollection(collectionId);
  }

  protected chooseDevice(deviceId: string): void {
    this.deviceMenuOpen.set(false);
    void this.integration.transferPlayback(deviceId);
  }

  protected profileInitial(): string {
    return (this.store.profile()?.displayName ?? 'P').charAt(0).toUpperCase();
  }

  @HostListener('document:keydown.escape')
  protected closeMenus(): void {
    this.deviceMenuOpen.set(false);
  }
}
