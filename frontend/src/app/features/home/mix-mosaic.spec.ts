import { TestBed } from '@angular/core/testing';
import { QueuerMix, Track } from '../../core/models/music.models';
import { MusicShellStore } from '../../core/state/music-shell.store';
import { MixMosaic } from './mix-mosaic';

const track = (id: string): Track => ({
  id,
  title: `Song ${id}`,
  artist: 'Artist',
  album: 'Album',
  durationSeconds: 100,
  addedAt: '2026-01-01T00:00:00.000Z',
  artwork: { source: 'placeholder', label: 'cover' },
  tags: [],
  playlistIds: [],
  explicit: false,
  liked: false,
});

const mix = (id: string, trackIds: string[]): QueuerMix => ({
  id,
  name: id,
  description: '',
  kind: 'repeat',
  accent: 'ember',
  tracks: trackIds.map(track),
  targetCount: 50,
  updatedAt: '2026-10-07T10:00:00.000Z',
});

describe('MixMosaic playing state', () => {
  const render = (value: QueuerMix) => {
    const fixture = TestBed.createComponent(MixMosaic);
    fixture.componentRef.setInput('mix', value);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('marks only the mix playback started from, even when two mixes share the track', () => {
    const store = TestBed.inject(MusicShellStore);
    store.currentTrackId.set('shared');
    store.playbackContextId.set('on-repeat');

    expect(render(mix('on-repeat', ['shared', 'a'])).classList).toContain('mix-mosaic--now');
    expect(render(mix('rediscover', ['shared', 'b'])).classList).not.toContain('mix-mosaic--now');
  });

  it('stops showing a mix as playing once the track is no longer in it', () => {
    const store = TestBed.inject(MusicShellStore);
    store.playbackContextId.set('on-repeat');
    store.currentTrackId.set('elsewhere');

    expect(render(mix('on-repeat', ['a', 'b'])).classList).not.toContain('mix-mosaic--now');
  });

  it('shows nothing as playing when playback did not start from a mix', () => {
    const store = TestBed.inject(MusicShellStore);
    store.currentTrackId.set('shared');
    store.playbackContextId.set(null);

    expect(render(mix('on-repeat', ['shared'])).classList).not.toContain('mix-mosaic--now');
  });
});
