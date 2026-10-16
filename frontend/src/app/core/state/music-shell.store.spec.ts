import { TestBed } from '@angular/core/testing';
import { SpotifyWorkspaceSnapshot } from '../models/music.models';
import { MusicShellStore } from './music-shell.store';

describe('MusicShellStore', () => {
  let store: MusicShellStore;

  beforeEach(() => {
    localStorage.removeItem('queuer.player-volume.v1');
    TestBed.configureTestingModule({});
    store = TestBed.inject(MusicShellStore);
  });

  it('starts in an explicitly fictional demo mode', () => {
    expect(store.sourceMode()).toBe('demo');
    expect(store.tracks().length).toBeGreaterThan(0);
    expect(store.profile()).toBeNull();
  });

  it('shows only the tracks returned by Spotify in Recently Played', () => {
    const tracks = store.tracks().slice(0, 3);
    const snapshot: SpotifyWorkspaceSnapshot = {
      profile: { accountId: 'account', displayName: 'Listener' },
      tracks,
      recentTrackIds: [tracks[1].id, tracks[0].id],
      playlists: [],
      queue: [],
      currentTrack: null,
      devices: [],
      isPlaying: false,
      progressSeconds: 0,
      volume: 50,
      shuffleEnabled: false,
      repeatMode: 'off',
    };
    store.replaceWithSpotify(snapshot);
    store.setCollection('recent');

    expect(store.filteredTracks().map((track) => track.id)).toEqual([tracks[1].id, tracks[0].id]);
    expect(store.recentTracks().map((track) => track.id)).toEqual([tracks[1].id, tracks[0].id]);
  });

  it('advances progress only while playback is active', () => {
    const initial = store.progressSeconds();
    store.advanceProgress();
    expect(store.progressSeconds()).toBe(initial);

    store.togglePlayback();
    store.advanceProgress();
    expect(store.progressSeconds()).toBe(initial + 1);
  });

  it('remembers the chosen volume and does not replace it with the startup device volume', () => {
    store.setVolume(28);
    const restored = new MusicShellStore();
    const tracks = restored.tracks().slice(0, 1);

    restored.replaceWithSpotify({
      profile: { accountId: 'account', displayName: 'Listener' },
      tracks,
      recentTrackIds: [],
      playlists: [],
      queue: [],
      currentTrack: null,
      devices: [],
      isPlaying: false,
      progressSeconds: 0,
      volume: 75,
      shuffleEnabled: false,
      repeatMode: 'off',
    });

    expect(restored.volume()).toBe(28);
    restored.updateRemotePlayback({ volume: 81 });
    expect(restored.volume()).toBe(28);
  });
});
