import { Track } from '../../core/models/music.models';

export interface MosaicTile {
  readonly url: string | null;
  readonly tone: string;
}

const TONES = [
  '#3b5a63',
  '#7a4a3a',
  '#2d3a45',
  '#5b3f5f',
  '#3a5a4a',
  '#6f5a49',
  '#59606b',
  '#8a4a3d',
] as const;

function hash(value: string): number {
  let result = 0;
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) >>> 0;
  return result;
}

export function mixMosaic(seed: string, tracks: readonly Track[]): readonly MosaicTile[] {
  const urls: string[] = [];
  for (const track of tracks) {
    if (urls.length === 4) break;
    const artwork = track.artwork;
    if (artwork.source === 'spotify' && artwork.url && !urls.includes(artwork.url)) {
      urls.push(artwork.url);
    }
  }
  return Array.from({ length: 4 }, (_, index) => ({
    url: urls[index] ?? null,
    tone: TONES[hash(`${seed}:${index}`) % TONES.length] ?? TONES[0],
  }));
}

export function mixArtistLine(
  tracks: readonly Track[],
  visible = 3,
  andMore: (count: number) => string = (count) => 'e mais ' + count,
): string {
  const counts = new Map<string, number>();
  for (const track of tracks) {
    const artist = track.artist.split(',')[0]?.trim();
    if (artist) counts.set(artist, (counts.get(artist) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  if (ranked.length === 0) return '';
  const names = ranked.slice(0, visible).map(([name]) => name);
  const rest = ranked.length - names.length;
  return rest > 0 ? names.join(', ') + ' ' + andMore(rest) : names.join(', ');
}
