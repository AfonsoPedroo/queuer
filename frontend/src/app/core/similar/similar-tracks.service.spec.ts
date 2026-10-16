import { ClaudeCuratorService } from '../claude/claude-curator.service';
import { ListeningHistoryService } from '../history/listening-history.service';
import { Track } from '../models/music.models';
import { SimilarTracksService } from './similar-tracks.service';

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

const setup = (options: { configured?: boolean; candidates?: number; ids?: number[] } = {}) => {
  const candidates = Array.from({ length: options.candidates ?? 12 }, (_, index) => ({
    id: index + 1,
    title: `T${index + 1}`,
    artist: 'A',
  }));
  const claude = {
    status: () => ({ configured: options.configured ?? true, model: 'test' }),
    similarTrackIds: vi.fn().mockResolvedValue(options.ids ?? [3, 1, 99]),
  } as unknown as ClaudeCuratorService;
  const history = {
    summary: () => ({}),
    similarCandidates: vi.fn(() => candidates),
    similarTrackById: vi.fn((id: number) => (id <= candidates.length ? track(`h${id}`) : null)),
  } as unknown as ListeningHistoryService;
  return { service: new SimilarTracksService(claude, history), claude, history };
};

describe('SimilarTracksService', () => {
  it('maps the ids Claude picked to history tracks, in order, dropping unknown ids', async () => {
    const { service } = setup();

    const tracks = await service.forTrack({ title: 'Reverie', artist: 'Men I Trust' });

    expect(tracks.map((item) => item.id)).toEqual(['h3', 'h1']);
  });

  it('asks Claude once per seed and remembers the answer', async () => {
    const { service, claude } = setup();

    await service.forTrack({ title: 'Reverie', artist: 'Men I Trust' });
    await service.forTrack({ title: 'REVERIE', artist: 'men i trust' });

    expect(claude.similarTrackIds).toHaveBeenCalledTimes(1);
  });

  it('does nothing without Claude, without history depth, or when Claude fails', async () => {
    expect(
      await setup({ configured: false }).service.forTrack({ title: 'a', artist: 'b' }),
    ).toEqual([]);
    expect(await setup({ candidates: 4 }).service.forTrack({ title: 'a', artist: 'b' })).toEqual(
      [],
    );

    const failing = setup();
    vi.mocked(failing.claude.similarTrackIds).mockRejectedValueOnce(new Error('boom'));
    expect(await failing.service.forTrack({ title: 'a', artist: 'b' })).toEqual([]);
    expect((await failing.service.forTrack({ title: 'a', artist: 'b' })).length).toBe(2);
  });
});
