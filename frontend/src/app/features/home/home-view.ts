import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Track } from '../../core/models/music.models';
import { SpotifyIntegrationService } from '../../core/spotify/spotify-integration.service';
import { MusicShellStore } from '../../core/state/music-shell.store';
import { ArtworkComponent } from '../../shared/artwork/artwork';
import { UiIcon } from '../../shared/ui-icon/ui-icon';

type PlaylistSort = 'spotify' | 'name' | 'tracks';

const COLLAPSED_PLAYLIST_LIMIT = 6;

@Component({
  selector: 'app-home-view',
  imports: [ArtworkComponent, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home-view.html',
  styleUrl: './home-view.scss',
})
export class HomeView {
  protected readonly store = inject(MusicShellStore);
  protected readonly integration = inject(SpotifyIntegrationService);
  protected readonly playlistSort = signal<PlaylistSort>('spotify');
  protected readonly playlistsExpanded = signal(false);

  protected readonly isHome = computed(() => this.store.activeCollection() === 'home');
  protected readonly homeTracks = computed(() => this.store.filteredTracks().slice(0, 5));
  protected readonly likedCount = computed(
    () => this.store.tracks().filter((track) => track.liked).length,
  );
  protected readonly sortedPlaylists = computed(() => {
    const playlists = [...this.store.playlists()];

    switch (this.playlistSort()) {
      case 'name':
        return playlists.sort((left, right) =>
          left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
        );
      case 'tracks':
        return playlists.sort(
          (left, right) =>
            right.trackCount - left.trackCount ||
            left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
        );
      case 'spotify':
        return playlists;
    }
  });
  protected readonly visiblePlaylists = computed(() =>
    this.playlistsExpanded()
      ? this.sortedPlaylists()
      : this.sortedPlaylists().slice(0, COLLAPSED_PLAYLIST_LIMIT),
  );

  protected openCollection(collectionId: string): void {
    void this.integration.openCollection(collectionId);
  }

  protected play(track: Track): void {
    void this.integration.playTrack(track);
  }

  protected toggleSaved(track: Track): void {
    void this.integration.toggleSaved(track);
  }

  protected updatePlaylistSort(event: Event): void {
    this.playlistSort.set((event.target as HTMLSelectElement).value as PlaylistSort);
  }

  protected togglePlaylistsExpanded(): void {
    this.playlistsExpanded.update((expanded) => !expanded);
  }

  protected formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }
}
