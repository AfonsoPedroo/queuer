import { PlaylistPrototype } from '../models/music.models';
import { HistoryTrackRecord, ListeningHistoryService } from './listening-history.service';

describe('ListeningHistoryService Claude profile', () => {
  it('keeps the aggregated dossier below the local byte budget and sends only daily recipes', () => {
    const service = new ListeningHistoryService();
    const records: HistoryTrackRecord[] = Array.from({ length: 600 }, (_, index) => ({
      key: `track-${index}`,
      title: `Very long track title ${index} ${'x'.repeat(180)}`,
      artist: `Very long artist ${index} ${'y'.repeat(180)}`,
      album: `Very long album ${index} ${'z'.repeat(180)}`,
      plays: 600 - index,
      playsLastYear: 5,
      playsLast3Years: 10,
      msPlayed: 180_000,
      firstPlayedAt: '2020-01-01T00:00:00.000Z',
      lastPlayedAt: '2026-01-01T00:00:00.000Z',
    }));
    (service as unknown as { records: HistoryTrackRecord[] }).records = records;
    const recipes: PlaylistPrototype[] = Array.from({ length: 12 }, (_, index) => ({
      id: `recipe-${index}`,
      mode: 'adjacent',
      seedArtists: [`Artist ${index}`],
      seedTracks: [{ title: `Track ${index}`, artist: `Artist ${index}` }],
      era: '2024–2026',
      discoveryPercent: 25,
      brief: 'artistas próximos e escolhas coerentes',
    }));

    const serialized = service.claudeTasteProfile(recipes);
    const profile = JSON.parse(serialized) as {
      playlistRecipes: unknown[];
      weightedTrackProfiles: unknown[];
    };

    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(120_000);
    expect(profile.playlistRecipes).toHaveLength(6);
    expect(profile.weightedTrackProfiles.length).toBeGreaterThan(0);
  });
});
