import { Track } from '../../core/models/music.models';
import { mixArtistLine, mixMosaic } from './mix-cover';

const track = (id: string, artist: string, url?: string): Track => ({
  id,
  title: `Song ${id}`,
  artist,
  album: 'Album',
  durationSeconds: 100,
  addedAt: '2026-01-01T00:00:00.000Z',
  artwork: url
    ? { source: 'spotify', url, alt: 'cover' }
    : { source: 'placeholder', label: 'cover' },
  tags: [],
  playlistIds: [],
  explicit: false,
  liked: false,
});

describe('mix cover helpers', () => {
  it('uses distinct real artwork first and muted tones for the rest', () => {
    const tiles = mixMosaic('daily-1', [
      track('1', 'A', 'https://i.scdn.co/a'),
      track('2', 'B', 'https://i.scdn.co/a'),
      track('3', 'C'),
      track('4', 'D', 'https://i.scdn.co/b'),
    ]);

    expect(tiles).toHaveLength(4);
    expect(tiles.map((tile) => tile.url)).toEqual([
      'https://i.scdn.co/a',
      'https://i.scdn.co/b',
      null,
      null,
    ]);
    expect(tiles.every((tile) => /^#[0-9a-f]{6}$/.test(tile.tone))).toBe(true);
  });

  it('keeps a mix recognisable by choosing tones deterministically', () => {
    expect(mixMosaic('daily-2', [])).toEqual(mixMosaic('daily-2', []));
    expect(mixMosaic('daily-2', []).map((tile) => tile.tone)).not.toEqual(
      mixMosaic('daily-3', []).map((tile) => tile.tone),
    );
  });

  it('summarises the most frequent artists with a remainder count', () => {
    const tracks = [
      track('1', 'Men I Trust'),
      track('2', 'Men I Trust, Someone'),
      track('3', 'Beach House'),
      track('4', 'Beach House'),
      track('5', 'Beach House'),
      track('6', 'Bon Iver'),
      track('7', 'Mac DeMarco'),
    ];

    expect(mixArtistLine(tracks)).toBe('Beach House, Men I Trust, Bon Iver e mais 1');
    expect(mixArtistLine(tracks, 5)).toBe('Beach House, Men I Trust, Bon Iver, Mac DeMarco');
    expect(mixArtistLine([])).toBe('');
  });
});
