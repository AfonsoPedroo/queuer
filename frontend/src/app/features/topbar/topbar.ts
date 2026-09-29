import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { SpotifyIntegrationService } from '../../core/spotify/spotify-integration.service';
import { MusicShellStore } from '../../core/state/music-shell.store';
import { UiIcon } from '../../shared/ui-icon/ui-icon';

@Component({
  selector: 'app-topbar',
  imports: [UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './topbar.html',
  styleUrl: './topbar.scss',
})
export class Topbar {
  readonly openAccount = output<void>();

  protected readonly store = inject(MusicShellStore);
  protected readonly integration = inject(SpotifyIntegrationService);
  protected readonly deviceMenuOpen = signal(false);

  @ViewChild('trackSearch') private searchInput?: ElementRef<HTMLInputElement>;

  constructor() {
    effect(() => {
      this.store.focusSearchRequest();
      queueMicrotask(() => {
        this.searchInput?.nativeElement.focus();
        this.searchInput?.nativeElement.select();
      });
    });
  }

  protected updateQuery(event: Event): void {
    this.store.query.set((event.target as HTMLInputElement).value);
  }

  protected clearQuery(): void {
    this.store.query.set('');
    this.searchInput?.nativeElement.focus();
  }

  protected openCollection(collectionId: string): void {
    void this.integration.openCollection(collectionId);
  }

  protected chooseDevice(deviceId: string): void {
    this.deviceMenuOpen.set(false);
    void this.integration.transferPlayback(deviceId);
  }

  protected profileInitial(): string {
    return (this.store.profile()?.displayName ?? 'P').charAt(0).toUpperCase();
  }
}
