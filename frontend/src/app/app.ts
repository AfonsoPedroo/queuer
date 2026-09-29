import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  inject,
  signal,
} from '@angular/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { SpotifyIntegrationService } from './core/spotify/spotify-integration.service';
import { MusicShellStore } from './core/state/music-shell.store';
import { AuthPanel } from './features/auth/auth-panel';
import { CommandPalette } from './features/command-palette/command-palette';
import { HomeView } from './features/home/home-view';
import { PlayerBar } from './features/player/player-bar';
import { Topbar } from './features/topbar/topbar';
import { UiIcon } from './shared/ui-icon/ui-icon';

@Component({
  selector: 'app-root',
  imports: [AuthPanel, CommandPalette, HomeView, PlayerBar, Topbar, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements OnDestroy {
  protected readonly store = inject(MusicShellStore);
  protected readonly integration = inject(SpotifyIntegrationService);
  protected readonly accountOpen = signal(false);

  private readonly progressTimer = window.setInterval(() => this.store.advanceProgress(), 1_000);

  constructor() {
    void this.integration.initialize();
  }

  ngOnDestroy(): void {
    window.clearInterval(this.progressTimer);
    this.integration.destroy();
  }

  protected handleConnected(): void {
    this.accountOpen.set(false);
    void this.integration.loadSpotifyWorkspace();
  }

  protected minimizeWindow(): void {
    void getCurrentWindow().minimize();
  }

  protected toggleMaximize(): void {
    void getCurrentWindow().toggleMaximize();
  }

  protected closeWindow(): void {
    void getCurrentWindow().close();
  }

  @HostListener('document:keydown', ['$event'])
  protected handleGlobalKeydown(event: KeyboardEvent): void {
    const target = event.target;
    const isEditable =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable);

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.store.openCommandPalette();
      return;
    }

    if (event.key === 'Escape') {
      if (this.accountOpen()) this.accountOpen.set(false);
      this.store.closeOverlays();
      return;
    }

    if (!isEditable && event.key === '/') {
      event.preventDefault();
      this.store.requestSearchFocus();
      return;
    }

    if (!isEditable && event.code === 'Space' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      void this.integration.togglePlayback();
    }
  }
}
