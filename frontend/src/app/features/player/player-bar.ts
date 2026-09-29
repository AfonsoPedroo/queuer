import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SpotifyIntegrationService } from '../../core/spotify/spotify-integration.service';
import { MusicShellStore } from '../../core/state/music-shell.store';
import { ArtworkComponent } from '../../shared/artwork/artwork';
import { UiIcon } from '../../shared/ui-icon/ui-icon';

@Component({
  selector: 'app-player-bar',
  imports: [ArtworkComponent, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './player-bar.html',
  styleUrl: './player-bar.scss',
})
export class PlayerBar {
  protected readonly store = inject(MusicShellStore);
  protected readonly integration = inject(SpotifyIntegrationService);

  protected seek(event: Event): void {
    void this.integration.seek(Number((event.target as HTMLInputElement).value));
  }

  protected setVolume(event: Event): void {
    void this.integration.setVolume(Number((event.target as HTMLInputElement).value));
  }

  protected formatTime(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
  }
}
