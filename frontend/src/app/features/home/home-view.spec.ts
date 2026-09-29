import { TestBed } from '@angular/core/testing';
import { Playlist, SpotifyWorkspaceSnapshot } from '../../core/models/music.models';
import { MusicShellStore } from '../../core/state/music-shell.store';
import { HomeView } from './home-view';

const playlist = (id: string, name: string, trackCount: number): Playlist => ({
  id,
  name,
  trackCount,
  description: `${name} playlist`,
  ownerLabel: 'Listener',
  artwork: { source: 'placeholder', label: name },
});

describe('HomeView playlists', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HomeView] }).compileComponents();
  });

  it('shows a short playlist shelf that can be expanded and sorted', () => {
    const store = TestBed.inject(MusicShellStore);
    const playlists = [
      playlist('zulu', 'Zulu', 4),
      playlist('delta', 'Delta', 30),
      playlist('echo', 'Echo', 12),
      playlist('foxtrot', 'Foxtrot', 9),
      playlist('golf', 'Golf', 3),
      playlist('hotel', 'Hotel', 18),
      playlist('alpha', 'Alpha', 22),
      playlist('bravo', 'Bravo', 7),
    ];
    const snapshot: SpotifyWorkspaceSnapshot = {
      tracks: [],
      recentTrackIds: [],
      playlists,
      queue: [],
      currentTrack: null,
      isPlaying: false,
      progressSeconds: 0,
      volume: 50,
      shuffleEnabled: false,
      repeatMode: 'off',
      devices: [],
      profile: { accountId: 'listener', displayName: 'Listener' },
    };
    store.replaceWithSpotify(snapshot);

    const fixture = TestBed.createComponent(HomeView);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.playlist-card')).toHaveLength(6);

    const expandButton = fixture.nativeElement.querySelector(
      '.playlist-toggle',
    ) as HTMLButtonElement;
    expandButton.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.playlist-card')).toHaveLength(8);

    const sortSelect = fixture.nativeElement.querySelector(
      '.playlist-sort select',
    ) as HTMLSelectElement;
    sortSelect.value = 'name';
    sortSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const firstPlaylistName = fixture.nativeElement.querySelector(
      '.playlist-card strong',
    ) as HTMLElement;
    expect(firstPlaylistName.textContent?.trim()).toBe('Alpha');
  });
});
