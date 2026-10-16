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
import { SettingsPanel } from './features/settings/settings-panel';
import { SettingsService } from './core/settings/settings.service';
import { CommandPalette } from './features/command-palette/command-palette';
import { HomeView } from './features/home/home-view';
import { PlayerBar } from './features/player/player-bar';
import { Topbar } from './features/topbar/topbar';
import { UiIcon } from './shared/ui-icon/ui-icon';
import { TranslatePipe } from './core/i18n/translate.pipe';
import { ListeningHistoryService } from './core/history/listening-history.service';
import { MixEngineService } from './core/mixes/mix-engine.service';
import { WorkspaceNavigationService } from './core/navigation/workspace-navigation.service';

@Component({
  selector: 'app-root',
  imports: [
    AuthPanel,
    CommandPalette,
    HomeView,
    PlayerBar,
    SettingsPanel,
    Topbar,
    TranslatePipe,
    UiIcon,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App implements OnDestroy {
  protected readonly store = inject(MusicShellStore);
  protected readonly integration = inject(SpotifyIntegrationService);
  protected readonly accountOpen = signal(false);
  protected readonly settingsOpen = signal(false);
  private readonly history = inject(ListeningHistoryService);
  private readonly mixes = inject(MixEngineService);
  private readonly navigation = inject(WorkspaceNavigationService);
  private readonly settings = inject(SettingsService);

  private readonly progressTimer = window.setInterval(() => this.store.advanceProgress(), 1_000);

  constructor() {
    this.registerMediaKeys();
    void this.history.initialize();
    void this.mixes.initialize();
    void this.integration.initialize();
  }

  private registerMediaKeys(): void {
    const session = typeof navigator === 'undefined' ? undefined : navigator.mediaSession;
    if (!session) return;
    const bind = (action: MediaSessionAction, handler: () => void): void => {
      try {
        session.setActionHandler(action, handler);
      } catch {}
    };
    bind('play', () => {
      if (!this.store.isPlaying()) void this.integration.togglePlayback();
    });
    bind('pause', () => {
      if (this.store.isPlaying()) void this.integration.togglePlayback();
    });
    bind('nexttrack', () => void this.integration.next());
    bind('previoustrack', () => void this.integration.previous());
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

  @HostListener('document:mouseup', ['$event'])
  protected handleMouseNavigation(event: MouseEvent): void {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    if (event.button === 3) this.navigation.back();
    else this.navigation.forward();
  }

  @HostListener('document:mousedown', ['$event'])
  protected suppressNativeMouseNavigation(event: MouseEvent): void {
    if (event.button === 3 || event.button === 4) event.preventDefault();
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

    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      if (event.key === 'ArrowLeft') this.navigation.back();
      else this.navigation.forward();
      return;
    }

    if (event.key === 'Escape') {
      if (this.accountOpen()) this.accountOpen.set(false);
      if (this.settingsOpen()) this.settingsOpen.set(false);
      this.store.closeOverlays();
      return;
    }

    if (!isEditable && event.key === '/') {
      event.preventDefault();
      this.store.requestSearchFocus();
      return;
    }

    const isControl =
      target instanceof HTMLElement &&
      target.closest('button, a[href], select, [role="button"], [role="menuitem"]') !== null;
    if (!isEditable && !isControl && event.code === 'Space' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      void this.integration.togglePlayback();
    }
  }
}
