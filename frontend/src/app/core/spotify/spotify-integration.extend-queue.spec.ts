import { TestBed } from '@angular/core/testing';
import { Track } from '../models/music.models';
import { MusicShellStore } from '../state/music-shell.store';
import { SpotifyIntegrationService } from './spotify-integration.service';

const track = (id: string): Track => ({
  id,
  title: `Song ${id}`,
  artist: 'Artist',
  album: 'Album',
  durationSeconds: 0,
  addedAt: '2026-01-01T00:00:00.000Z',
  artwork: { source: 'placeholder', label: 'cover' },
  tags: [],
  playlistIds: [],
  explicit: false,
  liked: false,
  uri: `spotify:track:${id}`,
  source: 'spotify',
});

describe('SpotifyIntegrationService.extendQueue', () => {
  it('adds similar tracks behind the playing one without duplicates', async () => {
    const store = TestBed.inject(MusicShellStore);
    const integration = TestBed.inject(SpotifyIntegrationService);
    store.currentTrackId.set('seed');
    const before = [...store.queueIds()];
    store.appendToQueue(['a']);

    await integration.extendQueue([track('a'), track('b'), track('seed'), track('c')], 'seed');

    expect(store.queueIds()).toEqual([...before, 'a', 'b', 'c']);
  });

  it('ignores the answer when another track started in the meantime', async () => {
    const store = TestBed.inject(MusicShellStore);
    const integration = TestBed.inject(SpotifyIntegrationService);
    store.currentTrackId.set('someone-else');
    const before = [...store.queueIds()];

    await integration.extendQueue([track('b')], 'seed');

    expect(store.queueIds()).toEqual(before);
  });
});
