import { SpotifyTrackDto } from '../spotify/spotify-api.models';
import { SpotifyApiService } from '../spotify/spotify-api.service';
import { mapSpotifyTrack } from '../spotify/spotify-mappers';
import { MusicShellStore } from '../state/music-shell.store';
import { ClaudeCuratorService } from '../claude/claude-curator.service';
import { ListeningHistoryService } from '../history/listening-history.service';
import { Track } from '../models/music.models';
import { MixEngineService } from './mix-engine.service';

describe('MixEngineService', () => {
  beforeEach(() => {
    localStorage.setItem('queuer.language.v1', 'pt');
    localStorage.removeItem('queuer.mixes.v1');
    localStorage.removeItem('queuer.mixes.daily-date.v16');
    localStorage.removeItem('queuer.mixes.claude-plan.v5');
    localStorage.removeItem('queuer.mixes.resolved.v1');
    localStorage.removeItem('queuer.mixes.artist-tracks.v1');
    localStorage.removeItem('queuer.mixes.claude-discovery.v1');
  });

  it('fills familiar mixes without putting fallback tracks in Discovery', async () => {
    const tracks = Array.from({ length: 50 }, (_, index) => spotifyTrack(index));
    const api = {
      getTopArtists: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      getTopTracks: vi.fn().mockResolvedValue({ items: tracks, total: tracks.length, next: null }),
      resetSearchFailures: vi.fn(),
      rateLimitRemainingSeconds: vi.fn(() => 0),
      beginSearchBudget: vi.fn(),
      endSearchBudget: vi.fn(),
      searchBudgetRemaining: vi.fn(() => Number.POSITIVE_INFINITY),
      searchFailureSummary: vi.fn(() => ''),
      searchTracks: vi.fn(),
    } as unknown as SpotifyApiService;
    const history = {
      hasHeard: vi.fn().mockReturnValue(false),
      summary: () => null,
      dailyPrototypes: vi.fn().mockReturnValue([]),
      prototypes: () => [],
      reserveTracks: () => [],
    } as unknown as ListeningHistoryService;
    const claude = {
      status: () => ({ configured: false, model: 'test' }),
    } as unknown as ClaudeCuratorService;
    const service = new MixEngineService(api, new MusicShellStore(), history, claude);
    vi.spyOn(service as unknown as { pause(): Promise<void> }, 'pause').mockResolvedValue();

    await service.refreshDaily(true);

    expect(service.mixes().find((item) => item.id === 'discovery')?.tracks).toHaveLength(0);
    expect(service.mixes().find((item) => item.id === 'releases')?.tracks).toHaveLength(0);
    for (const id of ['daily-1', 'daily-2', 'daily-3', 'daily-4']) {
      const mix = service.mixes().find((item) => item.id === id);
      expect(mix?.tracks.length).toBeGreaterThan(0);
      expect(mix?.tracks.every((track) => track.source === 'spotify')).toBe(true);
    }
    expect(service.dailyMixes()).toHaveLength(4);
    expect(service.dailyMixes().every((mix) => mix.kind === 'daily')).toBe(true);
  });

  it('keeps only unheard Claude suggestions released this year in Discovery', async () => {
    const year = new Date().getFullYear();
    const library = Array.from({ length: 50 }, (_, index) => spotifyTrack(index));
    const fresh = {
      ...spotifyTrack(101),
      name: 'Fresh now',
      album: { ...spotifyTrack(101).album, release_date: `${year}-04-01` },
    };
    const heard = {
      ...spotifyTrack(102),
      name: 'Already heard',
      album: { ...spotifyTrack(102).album, release_date: `${year}-03-01` },
    };
    const old = {
      ...spotifyTrack(103),
      name: 'Old release',
      album: { ...spotifyTrack(103).album, release_date: `${year - 1}-12-01` },
    };
    const byArtist = new Map([
      [fresh.artists[0]?.name ?? '', fresh],
      [heard.artists[0]?.name ?? '', heard],
      [old.artists[0]?.name ?? '', old],
    ]);
    const api = {
      getTopArtists: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      getTopTracks: vi
        .fn()
        .mockResolvedValue({ items: library, total: library.length, next: null }),
      resetSearchFailures: vi.fn(),
      rateLimitRemainingSeconds: vi.fn(() => 0),
      beginSearchBudget: vi.fn(),
      endSearchBudget: vi.fn(),
      searchBudgetRemaining: vi.fn(() => Number.POSITIVE_INFINITY),
      searchFailureSummary: vi.fn(() => ''),
      searchTracks: vi.fn(async (query: string) => ({
        tracks: {
          items: [...byArtist.entries()].flatMap(([artist, track]) =>
            query.includes(`artist:"${artist}"`) ? [track] : [],
          ),
        },
      })),
    } as unknown as SpotifyApiService;
    const history = {
      hasHeard: vi.fn((track: { id: string }) => track.id === heard.id),
      summary: () => null,
      dailyPrototypes: vi.fn().mockReturnValue([]),
      prototypes: () => [],
      reserveTracks: () => [],
    } as unknown as ListeningHistoryService;
    const claude = {
      status: () => ({ configured: true, model: 'test' }),
      recommend: vi
        .fn()
        .mockResolvedValueOnce([
          { title: fresh.name, artist: fresh.artists[0]?.name ?? '' },
          { title: heard.name, artist: heard.artists[0]?.name ?? '' },
          { title: old.name, artist: old.artists[0]?.name ?? '' },
        ])
        .mockResolvedValueOnce([]),
    } as unknown as ClaudeCuratorService;
    const service = new MixEngineService(api, new MusicShellStore(), history, claude);
    vi.spyOn(service as unknown as { pause(): Promise<void> }, 'pause').mockResolvedValue();

    await service.refreshDaily(true);

    expect(
      service
        .mixes()
        .find((item) => item.id === 'discovery')
        ?.tracks.map((track) => track.id),
    ).toEqual([fresh.id]);
  });

  it('builds each Daily Mix from 15 favourites, 15 rarely played and 20 unheard tracks', async () => {
    const api = {
      getTopArtists: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      getTopTracks: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      resetSearchFailures: vi.fn(),
      rateLimitRemainingSeconds: vi.fn(() => 0),
      beginSearchBudget: vi.fn(),
      endSearchBudget: vi.fn(),
      searchBudgetRemaining: vi.fn(() => Number.POSITIVE_INFINITY),
      searchFailureSummary: vi.fn(() => ''),
      searchTracks: vi.fn(async (query: string) => {
        const name = /artist:"([^"]+)"/.exec(query)?.[1] ?? '';
        return {
          tracks: {
            items: [1, 2, 3].map((number) => ({
              ...spotifyTrack(1_000 + number),
              id: `${name}-${number}`,
              uri: `spotify:track:${name}-${number}`,
              name: `${name} song ${number}`,
              artists: [{ id: name, name }],
            })),
          },
        };
      }),
    } as unknown as SpotifyApiService;
    const claude = {
      status: () => ({ configured: true, model: 'test' }),
      recommend: vi.fn().mockResolvedValue([]),
      planDailyMixes: vi.fn().mockResolvedValue(familiarPlans()),
    } as unknown as ClaudeCuratorService;
    const service = new MixEngineService(api, new MusicShellStore(), familiarHistory(), claude);
    vi.spyOn(service as unknown as { pause(): Promise<void> }, 'pause').mockResolvedValue();

    await service.refreshDaily(true);

    const mixes = service.dailyMixes();
    expect(mixes.map((mix) => mix.name)).toEqual(
      familiarPlans().map((plan, index) => `Daily Mix ${index + 1} · ${plan.name}`),
    );
    expect(mixes.every((mix) => mix.tracks.length === 50)).toBe(true);
    expect(new Set(mixes.flatMap((mix) => mix.tracks.map((track) => track.id))).size).toBe(200);
    for (const mix of mixes) {
      const played = mix.tracks.filter((track) => track.id.startsWith('h')).length;
      expect(played).toBe(30);
      expect(mix.tracks.length - played).toBe(20);
    }
    expect(api.searchTracks).toHaveBeenCalledTimes(40);

    await service.refreshDaily(true);
    expect(claude.planDailyMixes).toHaveBeenCalledTimes(1);
    expect(api.searchTracks).toHaveBeenCalledTimes(40);
  });

  it('reassigns shared candidates so a later Daily Mix is not starved', () => {
    const service = new MixEngineService(
      {} as SpotifyApiService,
      new MusicShellStore(),
      { initialize: vi.fn() } as unknown as ListeningHistoryService,
      { initialize: vi.fn() } as unknown as ClaudeCuratorService,
    );
    const mappedTracks = (start: number, count: number): Track[] =>
      Array.from({ length: count }, (_, index) =>
        mapSpotifyTrack(spotifyTrack(start + index), '2026-10-07T10:00:00.000Z', false),
      ).filter((track): track is Track => track !== null);
    const shared = mappedTracks(1_000, 50);
    const firstMixAlternatives = mappedTracks(2_000, 50);
    const secondMix = mappedTracks(3_000, 50);
    const thirdMix = mappedTracks(4_000, 50);

    const allocate = (
      service as unknown as {
        allocateDailyTracks(pools: readonly (readonly Track[])[]): Track[][];
      }
    ).allocateDailyTracks.bind(service);
    const result = allocate([[...shared, ...firstMixAlternatives], secondMix, thirdMix, shared]);

    expect(result.map((tracks) => tracks.length)).toEqual([50, 50, 50, 50]);
    const identities = result.flatMap((tracks) =>
      tracks.map(
        (track) => `${track.title.toLocaleLowerCase()}::${track.artist.toLocaleLowerCase()}`,
      ),
    );
    expect(new Set(identities).size).toBe(200);
    expect(result[3]?.every((track) => shared.some((candidate) => candidate.id === track.id))).toBe(
      true,
    );
  });

  it('refuses to refresh during a Spotify cooldown without calling Claude', async () => {
    const api = {
      getTopArtists: vi.fn(),
      getTopTracks: vi.fn(),
      resetSearchFailures: vi.fn(),
      rateLimitRemainingSeconds: vi.fn(() => 120),
      beginSearchBudget: vi.fn(),
      endSearchBudget: vi.fn(),
      searchBudgetRemaining: vi.fn(() => Number.POSITIVE_INFINITY),
      searchFailureSummary: vi.fn(() => ''),
      searchTracks: vi.fn(),
    } as unknown as SpotifyApiService;
    const claude = {
      status: () => ({ configured: true, model: 'test' }),
      recommend: vi.fn(),
      planDailyMixes: vi.fn(),
    } as unknown as ClaudeCuratorService;
    const service = new MixEngineService(
      api,
      new MusicShellStore(),
      { hasHeard: vi.fn(), summary: () => null, prototypes: () => [] } as never,
      claude,
    );

    await expect(service.refreshDaily(true)).rejects.toThrow('daqui a 2 min');

    expect(service.error()).toContain('daqui a 2 min');
    expect(api.getTopArtists).not.toHaveBeenCalled();
    expect(claude.planDailyMixes).not.toHaveBeenCalled();
  });

  it('tops a mix a few tracks short up from unused favourites, without any search', async () => {
    const plans = familiarPlans().map((plan, mix) => ({
      ...plan,
      favoriteIds: Array.from({ length: 20 }, (_, index) => mix * 100 + index + 1),
      rareIds: Array.from({ length: 20 }, (_, index) => mix * 100 + 50 + index + 1),
    }));
    const api = {
      getTopArtists: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      getTopTracks: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      resetSearchFailures: vi.fn(),
      rateLimitRemainingSeconds: vi.fn(() => 0),
      beginSearchBudget: vi.fn(),
      endSearchBudget: vi.fn(),
      searchBudgetRemaining: vi.fn(() => Number.POSITIVE_INFINITY),
      searchFailureSummary: vi.fn(() => ''),
      searchTracks: vi.fn(async (query: string) => {
        const name = /artist:"([^"]+)"/.exec(query)?.[1] ?? '';
        const items = name.endsWith('-0')
          ? [1, 2].map((number) => ({
              ...spotifyTrack(3_000 + number),
              id: `${name}-${number}`,
              uri: `spotify:track:${name}-${number}`,
              name: `${name} song ${number}`,
              artists: [{ id: name, name }],
            }))
          : [];
        return { tracks: { items } };
      }),
    } as unknown as SpotifyApiService;
    const claude = {
      status: () => ({ configured: true, model: 'test' }),
      recommend: vi.fn().mockResolvedValue([]),
      planDailyMixes: vi.fn().mockResolvedValue(plans),
    } as unknown as ClaudeCuratorService;
    const service = new MixEngineService(api, new MusicShellStore(), familiarHistory(), claude);
    vi.spyOn(service as unknown as { pause(): Promise<void> }, 'pause').mockResolvedValue();

    await service.refreshDaily(true);

    const mixes = service.dailyMixes();
    expect(mixes.every((mix) => mix.tracks.length === 50)).toBe(true);
    expect(new Set(mixes.flatMap((mix) => mix.tracks.map((track) => track.id))).size).toBe(200);
    expect(api.searchTracks).toHaveBeenCalledTimes(40);
  });

  it('asks Claude for songs in the mix style when a mix is still short, and confirms them on Spotify', async () => {
    const plans = familiarPlans().map((plan, mix) => ({
      ...plan,
      favoriteIds: Array.from({ length: 20 }, (_, index) => mix * 100 + index + 1),
      rareIds: Array.from({ length: 20 }, (_, index) => mix * 100 + 50 + index + 1),
    }));
    const api = {
      getTopArtists: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      getTopTracks: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      resetSearchFailures: vi.fn(),
      rateLimitRemainingSeconds: vi.fn(() => 0),
      beginSearchBudget: vi.fn(),
      endSearchBudget: vi.fn(),
      searchBudgetRemaining: vi.fn(() => Number.POSITIVE_INFINITY),
      searchFailureSummary: vi.fn(() => ''),
      searchTracks: vi.fn(async (query: string) => {
        const exact = /^track:"(.+)" artist:"(.+)"$/.exec(query);
        if (exact) {
          const [, title = '', artist = ''] = exact;
          return {
            tracks: {
              items: [
                {
                  ...spotifyTrack(6_000),
                  id: `fill-${title}`,
                  uri: `spotify:track:fill-${title}`,
                  name: title,
                  artists: [{ id: artist, name: artist }],
                },
              ],
            },
          };
        }
        const name = /artist:"([^"]+)"/.exec(query)?.[1] ?? '';
        const items = name.endsWith('-0')
          ? [1, 2].map((number) => ({
              ...spotifyTrack(5_000 + number),
              id: `${name}-${number}`,
              uri: `spotify:track:${name}-${number}`,
              name: `${name} song ${number}`,
              artists: [{ id: name, name }],
            }))
          : [];
        return { tracks: { items } };
      }),
    } as unknown as SpotifyApiService;
    let counter = 0;
    const recommend = vi.fn(async () =>
      Array.from({ length: 12 }, () => {
        counter += 1;
        return { title: `Fill ${counter}`, artist: `Filler ${counter}`, reason: null };
      }),
    );
    const claude = {
      status: () => ({ configured: true, model: 'test' }),
      recommend,
      planDailyMixes: vi.fn().mockResolvedValue(plans),
    } as unknown as ClaudeCuratorService;
    const history = familiarHistory();
    vi.mocked(history.reserveTracks).mockReturnValue([]);
    const service = new MixEngineService(api, new MusicShellStore(), history, claude);
    vi.spyOn(service as unknown as { pause(): Promise<void> }, 'pause').mockResolvedValue();

    await service.refreshDaily(true);

    const mixes = service.dailyMixes();
    expect(mixes.map((mix) => mix.tracks.length)).toEqual([50, 50, 50, 50]);
    expect(mixes.every((mix) => mix.tracks.some((track) => track.id.startsWith('fill-')))).toBe(
      true,
    );
    expect(recommend).toHaveBeenCalledTimes(5);
  });

  it('does not spend the searches kept for Discovery and Releases on completing mixes', async () => {
    const plans = familiarPlans().map((plan, mix) => ({
      ...plan,
      favoriteIds: Array.from({ length: 20 }, (_, index) => mix * 100 + index + 1),
      rareIds: Array.from({ length: 20 }, (_, index) => mix * 100 + 50 + index + 1),
    }));
    const api = {
      getTopArtists: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      getTopTracks: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      resetSearchFailures: vi.fn(),
      rateLimitRemainingSeconds: vi.fn(() => 0),
      beginSearchBudget: vi.fn(),
      endSearchBudget: vi.fn(),
      searchBudgetRemaining: vi.fn(() => 20),
      searchFailureSummary: vi.fn(() => ''),
      searchTracks: vi.fn(async () => ({ tracks: { items: [] } })),
    } as unknown as SpotifyApiService;
    const recommend = vi.fn().mockResolvedValue([]);
    const claude = {
      status: () => ({ configured: true, model: 'test' }),
      recommend,
      planDailyMixes: vi.fn().mockResolvedValue(plans),
    } as unknown as ClaudeCuratorService;
    const history = familiarHistory();
    vi.mocked(history.reserveTracks).mockReturnValue([]);
    const service = new MixEngineService(api, new MusicShellStore(), history, claude);
    vi.spyOn(service as unknown as { pause(): Promise<void> }, 'pause').mockResolvedValue();

    await service.refreshDaily(true);

    expect(recommend).toHaveBeenCalledTimes(1);
  });

  it('shows a mix a few tracks under 50 instead of failing the whole day', async () => {
    const plans = familiarPlans().map((plan, mix) => ({
      ...plan,
      favoriteIds: Array.from({ length: 22 }, (_, index) => mix * 100 + index + 1),
      rareIds: Array.from({ length: 22 }, (_, index) => mix * 100 + 50 + index + 1),
    }));
    const api = {
      getTopArtists: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      getTopTracks: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      resetSearchFailures: vi.fn(),
      rateLimitRemainingSeconds: vi.fn(() => 0),
      beginSearchBudget: vi.fn(),
      endSearchBudget: vi.fn(),
      searchBudgetRemaining: vi.fn(() => Number.POSITIVE_INFINITY),
      searchFailureSummary: vi.fn(() => ''),
      searchTracks: vi.fn(async (query: string) => {
        const name = /artist:"([^"]+)"/.exec(query)?.[1] ?? '';
        const items = name.endsWith('-0')
          ? [1, 2].map((number) => ({
              ...spotifyTrack(4_000 + number),
              id: `${name}-${number}`,
              uri: `spotify:track:${name}-${number}`,
              name: `${name} song ${number}`,
              artists: [{ id: name, name }],
            }))
          : [];
        return { tracks: { items } };
      }),
    } as unknown as SpotifyApiService;
    const claude = {
      status: () => ({ configured: true, model: 'test' }),
      recommend: vi.fn().mockResolvedValue([]),
      planDailyMixes: vi.fn().mockResolvedValue(plans),
    } as unknown as ClaudeCuratorService;
    const history = familiarHistory();
    vi.mocked(history.reserveTracks).mockReturnValue([]);
    const service = new MixEngineService(api, new MusicShellStore(), history, claude);
    vi.spyOn(service as unknown as { pause(): Promise<void> }, 'pause').mockResolvedValue();

    await service.refreshDaily(true);

    expect(service.dailyMixes().map((mix) => mix.tracks.length)).toEqual([46, 46, 46, 46]);
    expect(service.error() ?? '').not.toContain('O Claude respondeu');
  });

  it('does not count a day as done when the never-heard share did not arrive', async () => {
    const plans = familiarPlans().map((plan, mix) => ({
      ...plan,
      favoriteIds: Array.from({ length: 24 }, (_, index) => mix * 100 + index + 1),
      rareIds: Array.from({ length: 24 }, (_, index) => mix * 100 + 50 + index + 1),
    }));
    const api = {
      getTopArtists: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      getTopTracks: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      resetSearchFailures: vi.fn(),
      rateLimitRemainingSeconds: vi.fn(() => 0),
      beginSearchBudget: vi.fn(),
      endSearchBudget: vi.fn(),
      searchBudgetRemaining: vi.fn(() => Number.POSITIVE_INFINITY),
      searchFailureSummary: vi.fn(() => ''),
      searchTracks: vi.fn(async (query: string) => {
        const name = /artist:"([^"]+)"/.exec(query)?.[1] ?? '';
        const items = name.endsWith('-0')
          ? [1, 2].map((number) => ({
              ...spotifyTrack(2_000 + number),
              id: `${name}-${number}`,
              uri: `spotify:track:${name}-${number}`,
              name: `${name} song ${number}`,
              artists: [{ id: name, name }],
            }))
          : [];
        return { tracks: { items } };
      }),
    } as unknown as SpotifyApiService;
    const claude = {
      status: () => ({ configured: true, model: 'test' }),
      recommend: vi.fn().mockResolvedValue([]),
      planDailyMixes: vi.fn().mockResolvedValue(plans),
    } as unknown as ClaudeCuratorService;
    const history = familiarHistory();
    vi.mocked(history.hasHeard).mockImplementation((track) => track.id.startsWith('h'));
    const service = new MixEngineService(api, new MusicShellStore(), history, claude);
    vi.spyOn(service as unknown as { pause(): Promise<void> }, 'pause').mockResolvedValue();

    await service.refreshDaily(true);

    expect(service.dailyMixes().every((mix) => mix.tracks.length === 50)).toBe(true);
    expect(service.error()).toBeNull();
    expect(service.notice()).toContain('abaixo do previsto');
    expect(localStorage.getItem('queuer.mixes.daily-date.v16')).toBeNull();
  });

  it('stops resolving on a Spotify rate limit and reports the wait instead of zero tracks', async () => {
    let limited = false;
    const api = {
      getTopArtists: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      getTopTracks: vi.fn().mockResolvedValue({ items: [spotifyTrack(900)], total: 1, next: null }),
      resetSearchFailures: vi.fn(),
      rateLimitRemainingSeconds: vi.fn(() => (limited ? 90 : 0)),
      beginSearchBudget: vi.fn(),
      endSearchBudget: vi.fn(),
      searchBudgetRemaining: vi.fn(() => Number.POSITIVE_INFINITY),
      searchFailureSummary: vi.fn(() => '429:rate_limited ×1'),
      searchTracks: vi.fn(async () => {
        limited = true;
        throw new Error('429');
      }),
    } as unknown as SpotifyApiService;
    const claude = {
      status: () => ({ configured: true, model: 'test' }),
      recommend: vi.fn().mockResolvedValue([]),
      planDailyMixes: vi.fn().mockResolvedValue(familiarPlans()),
    } as unknown as ClaudeCuratorService;
    const service = new MixEngineService(api, new MusicShellStore(), familiarHistory(), claude);
    vi.spyOn(service as unknown as { pause(): Promise<void> }, 'pause').mockResolvedValue();

    await service.refreshDaily(true);

    expect(service.error()).toContain('daqui a 2 min');
    expect(api.searchTracks).toHaveBeenCalledTimes(1);
  });

  it('shows the Claude failure without persisting four empty mixes as a successful day', async () => {
    const tracks = Array.from({ length: 50 }, (_, index) => spotifyTrack(300 + index));
    const api = {
      getTopArtists: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      getTopTracks: vi.fn().mockResolvedValue({ items: tracks, total: tracks.length, next: null }),
      resetSearchFailures: vi.fn(),
      rateLimitRemainingSeconds: vi.fn(() => 0),
      beginSearchBudget: vi.fn(),
      endSearchBudget: vi.fn(),
      searchBudgetRemaining: vi.fn(() => Number.POSITIVE_INFINITY),
      searchFailureSummary: vi.fn(() => ''),
      searchTracks: vi.fn(),
    } as unknown as SpotifyApiService;
    const history = {
      hasHeard: vi.fn().mockReturnValue(false),
      summary: () => null,
      dailyPrototypes: vi.fn().mockReturnValue([]),
      prototypes: () => [],
      reserveTracks: () => [],
      claudeTasteProfile: () => '{"profile":"enough listening history for the daily plan"}',
    } as unknown as ListeningHistoryService;
    const claude = {
      status: () => ({ configured: true, model: 'test' }),
      recommend: vi.fn().mockResolvedValue([]),
      planDailyMixes: vi.fn().mockRejectedValue(new Error('A Anthropic recusou o pedido.')),
    } as unknown as ClaudeCuratorService;
    const service = new MixEngineService(api, new MusicShellStore(), history, claude);

    await service.refreshDaily(true);

    expect(service.error()).toBe('A Anthropic recusou o pedido.');
    expect(service.dailyMixes()).toHaveLength(4);
    expect(service.dailyMixes().every((mix) => mix.tracks.length === 0)).toBe(true);
    expect(localStorage.getItem('queuer.mixes.daily-date.v16')).toBeNull();
    const stored = JSON.parse(localStorage.getItem('queuer.mixes.v1') ?? '[]') as Array<{
      kind: string;
      tracks: unknown[];
    }>;
    expect(
      stored.filter((mix) => mix.kind === 'daily').every((mix) => mix.tracks.length === 0),
    ).toBe(true);
  });

  it('keeps the previous four Daily Mixes atomically when a Claude refresh fails', async () => {
    const tracks = Array.from({ length: 50 }, (_, index) => spotifyTrack(400 + index));
    const api = {
      getTopArtists: vi.fn().mockResolvedValue({ items: [], total: 0, next: null }),
      getTopTracks: vi.fn().mockResolvedValue({ items: tracks, total: tracks.length, next: null }),
      resetSearchFailures: vi.fn(),
      rateLimitRemainingSeconds: vi.fn(() => 0),
      beginSearchBudget: vi.fn(),
      endSearchBudget: vi.fn(),
      searchBudgetRemaining: vi.fn(() => Number.POSITIVE_INFINITY),
      searchFailureSummary: vi.fn(() => ''),
      searchTracks: vi.fn(),
    } as unknown as SpotifyApiService;
    const history = {
      hasHeard: vi.fn().mockReturnValue(false),
      summary: () => null,
      dailyPrototypes: vi.fn().mockReturnValue([]),
      prototypes: () => [],
      reserveTracks: () => [],
      claudeTasteProfile: () => '{"profile":"enough listening history for the daily plan"}',
    } as unknown as ListeningHistoryService;
    const storedDailyMixes = Array.from({ length: 4 }, (_, mixIndex) => ({
      id: `daily-${mixIndex + 1}`,
      name: `Daily Mix ${mixIndex + 1} · Previous`,
      description: 'Previous valid selection',
      kind: 'daily',
      accent: ['ocean', 'plum', 'slate', 'moss'][mixIndex],
      tracks: Array.from({ length: 50 }, (_, trackIndex) =>
        mapSpotifyTrack(
          spotifyTrack(500 + mixIndex * 50 + trackIndex),
          '2026-10-06T10:00:00.000Z',
          false,
        ),
      ).filter(Boolean),
      targetCount: 50,
      updatedAt: '2026-10-06T10:00:00.000Z',
    }));
    localStorage.setItem('queuer.mixes.v1', JSON.stringify(storedDailyMixes));

    const claude = {
      status: () => ({ configured: true, model: 'test' }),
      recommend: vi.fn().mockResolvedValue([]),
      planDailyMixes: vi.fn().mockRejectedValue(new Error('A Anthropic está indisponível.')),
    } as unknown as ClaudeCuratorService;
    const service = new MixEngineService(api, new MusicShellStore(), history, claude);

    const previous = service.dailyMixes().map((mix) => ({
      id: mix.id,
      updatedAt: mix.updatedAt,
      trackIds: mix.tracks.map((track) => track.id),
    }));
    expect(previous.every((mix) => mix.trackIds.length === 50)).toBe(true);

    await service.refreshDaily(true);

    expect(service.error()).toBe('A Anthropic está indisponível.');
    expect(
      service.dailyMixes().map((mix) => ({
        id: mix.id,
        updatedAt: mix.updatedAt,
        trackIds: mix.tracks.map((track) => track.id),
      })),
    ).toEqual(previous);
  });
});

const historyTrack = (id: number): Track => ({
  id: `h${id}`,
  title: `Played ${id}`,
  artist: `Known ${id}`,
  album: 'Album',
  durationSeconds: 0,
  addedAt: '2026-01-01T00:00:00.000Z',
  artwork: { source: 'placeholder', label: 'cover' },
  tags: [],
  playlistIds: [],
  explicit: false,
  liked: false,
  uri: `spotify:track:h${id}`,
  source: 'spotify',
});

const familiarPlans = () =>
  Array.from({ length: 4 }, (_, mix) => ({
    name: `Universe ${mix + 1}`,
    description: `Coherent style ${mix + 1}`,
    seedArtists: Array.from({ length: 10 }, (_, artist) => `New ${mix}-${artist}`),
    favoriteIds: Array.from({ length: 20 }, (_, index) => mix * 100 + index + 1),
    rareIds: Array.from({ length: 20 }, (_, index) => mix * 100 + 50 + index + 1),
  }));

const familiarHistory = () =>
  ({
    hasHeard: vi.fn().mockReturnValue(false),
    summary: () => null,
    dailyPrototypes: vi.fn().mockReturnValue([]),
    prototypes: () => [],
    claudeTasteProfile: () => '{"profile":"enough listening history for the daily plan"}',
    familiarTrackById: vi.fn((id: number) => historyTrack(id)),
    reserveTracks: vi.fn(() =>
      Array.from({ length: 4 }, (_, mix) =>
        Array.from({ length: 4 }, (_, artist) =>
          Array.from({ length: 2 }, (_, index) => ({
            ...historyTrack(mix * 100 + 1 + artist),
            id: `reserve-${mix}-${artist}-${index}`,
            title: `Reserve ${mix}-${artist}-${index}`,
            uri: `spotify:track:reserve-${mix}-${artist}-${index}`,
          })),
        ).flat(),
      ).flat(),
    ),
  }) as unknown as ListeningHistoryService;

function spotifyTrack(index: number): SpotifyTrackDto {
  return {
    id: `track-${index}`,
    name: `Track ${index}`,
    uri: `spotify:track:${index}`,
    type: 'track',
    duration_ms: 180_000,
    explicit: false,
    artists: [{ id: `artist-${index % 8}`, name: `Artist ${index % 8}` }],
    album: {
      name: `Album ${index}`,
      images: [],
      release_date: '2026-01-01',
    },
    external_urls: { spotify: `https://open.spotify.com/track/${index}` },
  };
}
