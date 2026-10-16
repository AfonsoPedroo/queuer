import { computed, Injectable, signal } from '@angular/core';
import {
  ClaudeCuratorService,
  ClaudeDailyMixPlan,
  RecommendationCandidate,
} from '../claude/claude-curator.service';
import { ListeningHistoryService } from '../history/listening-history.service';
import { MixAccent, QueuerMix, Track } from '../models/music.models';
import { SpotifyApiService } from '../spotify/spotify-api.service';
import { SpotifyTrackDto } from '../spotify/spotify-api.models';
import { SpotifyArtistDto } from '../spotify/spotify-api.models';
import { SpotifySearchDto } from '../spotify/spotify-api.models';
import { mapSpotifyTrack } from '../spotify/spotify-mappers';
import { I18nService } from '../i18n/i18n.service';
import { MusicShellStore } from '../state/music-shell.store';
import { readSavedCache, writeSavedCache } from './saved-cache';
import {
  baseTrackTitle,
  formatWait,
  normalizeText,
  recordingIdentity,
  weaveByShare,
} from './track-helpers';

const STORAGE_KEY = 'queuer.mixes.v1';
const DAILY_DATE_KEY = 'queuer.mixes.daily-date.v16';
const CLAUDE_PLAN_CACHE_KEY = 'queuer.mixes.claude-plan.v5';
const CLAUDE_DISCOVERY_CACHE_KEY = 'queuer.mixes.claude-discovery.v1';
const RESOLVED_CACHE_KEY = 'queuer.mixes.resolved.v1';
const ARTIST_TRACKS_CACHE_KEY = 'queuer.mixes.artist-tracks.v1';

const TARGET_TRACKS = 50;
const MIN_MIX_TRACKS = 45;
const DAILY_FAVORITES = 15;
const DAILY_RARE = 15;
const DAILY_NEW = 20;
const DAILY_NEW_ARTISTS = 10;
const MIN_FAMILIAR_PER_LIST = 8;
const MIN_NEW_PER_MIX = 10;
const MAX_TOP_UP_PER_MIX = 10;
const MAX_CLAUDE_FILL_PER_MIX = 15;

const REFRESH_SEARCH_BUDGET = 60;
const AUX_SEARCH_RESERVE = 20;
const DISCOVERY_ARTIST_SEARCHES = 12;
const RELEASE_ARTIST_SEARCHES = 8;
const EXACT_SEARCH_PAUSE_MS = 250;
const SEARCH_SPACING_MS = 500;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RESOLVED_HIT_TTL_MS = 30 * ONE_DAY_MS;
const RESOLVED_MISS_TTL_MS = ONE_DAY_MS;
const ARTIST_TRACKS_TTL_MS = 7 * ONE_DAY_MS;
const RECENT_TRACKS_TTL_MS = ONE_DAY_MS;
const RESOLVED_CACHE_MAX_ENTRIES = 1500;
const ARTIST_TRACKS_MAX_ENTRIES = 120;

interface SavedTrack {
  readonly track: Track | null;
  readonly at: number;
}

interface SavedSearch {
  readonly tracks: readonly Track[];
  readonly at: number;
}

export interface ResolvedDailyMixPlan {
  readonly name: string;
  readonly description: string;
  readonly seedArtists: readonly string[];
  readonly favoriteTracks: readonly Track[];
  readonly rareTracks: readonly Track[];
}

@Injectable({ providedIn: 'root' })
export class MixEngineService {
  private readonly mixesState = signal<readonly QueuerMix[]>(this.readStoredMixes());
  private initialization: Promise<void> | null = null;
  private lastRealSearchAt = 0;

  readonly mixes = this.mixesState.asReadonly();
  readonly selectedMixId = signal<string | null>(null);
  readonly generating = signal<string | null>(null);
  readonly generationDetail = signal('');
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);
  readonly selectedMix = computed(
    () => this.mixes().find((mix) => mix.id === this.selectedMixId()) ?? null,
  );
  readonly featuredMixes = computed(() =>
    this.mixes().filter((mix) => mix.kind === 'discovery' || mix.kind === 'releases'),
  );
  readonly dailyMixes = computed(() => this.mixes().filter((mix) => mix.kind === 'daily'));
  readonly memoryMixes = computed(() =>
    this.mixes().filter((mix) => ['rediscover', 'repeat'].includes(mix.kind)),
  );

  constructor(
    private readonly api: SpotifyApiService,
    private readonly store: MusicShellStore,
    private readonly history: ListeningHistoryService,
    private readonly claude: ClaudeCuratorService,
    private readonly i18n: I18nService = new I18nService(),
  ) {
    if (this.mixesState().length === 0) this.installDemoMixes();
  }

  initialize(): Promise<void> {
    this.initialization ??= Promise.all([this.history.initialize(), this.claude.initialize()]).then(
      () => undefined,
    );
    return this.initialization;
  }

  clearCaches(): void {
    const keys = [
      DAILY_DATE_KEY,
      CLAUDE_PLAN_CACHE_KEY,
      CLAUDE_DISCOVERY_CACHE_KEY,
      RESOLVED_CACHE_KEY,
      ARTIST_TRACKS_CACHE_KEY,
    ];
    for (const key of keys) {
      try {
        localStorage.removeItem(key);
      } catch {}
    }
  }

  async refreshDaily(force = false): Promise<void> {
    const today = this.todayKey();
    if (!force && localStorage.getItem(DAILY_DATE_KEY) === today && this.hasRealDailyMixes()) {
      return;
    }

    this.generating.set('daily');
    this.generationDetail.set('A ler os teus artistas mais ouvidos…');
    this.error.set(null);
    this.notice.set(null);
    this.api.resetSearchFailures();
    this.api.beginSearchBudget(REFRESH_SEARCH_BUDGET);
    try {
      const { artists, libraryTracks } = await this.loadSpotifyTaste();

      const tasteArtists = this.uniqueNames([
        ...(this.history.summary()?.topArtists.map((artist) => artist.name) ?? []),
        ...artists.map((artist) => artist.name),
        ...libraryTracks.map((track) => track.artist),
      ]).slice(0, 30);
      const dailyRecipes = this.history.dailyPrototypes(today, 6);
      const currentYear = new Date().getFullYear();
      const answers = await this.askClaude(today, dailyRecipes, tasteArtists, currentYear);
      const claudeDailyPlans = answers.claudeDailyPlans;
      let claudePlanError = answers.claudePlanError;
      const discoverySuggestions = answers.discoverySuggestions;
      const discoverySeedArtists = answers.discoverySeedArtists;
      let discoveryClaudeTracks: Track[] = [];

      const plannedDailyPools: Track[][] = [];
      const dailySearchCache = new Map<string, Promise<SpotifySearchDto>>();
      if (claudeDailyPlans.length === 4) {
        for (let index = 0; index < claudeDailyPlans.length; index += 1) {
          const plan = claudeDailyPlans[index];
          if (!plan) continue;
          if (this.api.rateLimitRemainingSeconds() > 0) break;
          this.generationDetail.set(
            this.i18n.t('A confirmar a Daily Mix {index} no Spotify…', { index: index + 1 }),
          );
          plannedDailyPools.push(await this.resolveDailyPlanPool(plan, dailySearchCache));
        }
      }
      const plannedDailyTracks = await this.fillShortMixesWithClaude(
        this.topUpShortMixes(this.allocateDailyTracks(plannedDailyPools)),
        claudeDailyPlans,
        dailySearchCache,
      );
      const claudePlanUsable =
        claudeDailyPlans.length === 4 &&
        plannedDailyTracks.length === 4 &&
        plannedDailyTracks.every((tracks) => tracks.length >= MIN_MIX_TRACKS);
      if (this.claude.status().configured && !claudePlanUsable && !claudePlanError) {
        claudePlanError = this.describePlanFailure(plannedDailyTracks, plannedDailyPools);
        this.error.set(claudePlanError);
      }

      const newPerMix = plannedDailyTracks.map(
        (tracks) => tracks.filter((track) => !this.history.hasHeard(track)).length,
      );
      const enoughNewMusic = newPerMix.every((count) => count >= MIN_NEW_PER_MIX);
      if (claudePlanUsable && !enoughNewMusic) {
        this.notice.set(
          this.i18n.t(
            'Mixes prontas. As músicas novas ficaram abaixo do previsto ({counts} de {target}); atualiza mais tarde para completar.',
            { counts: newPerMix.join(', '), target: DAILY_NEW },
          ),
        );
      }

      if (discoverySuggestions.length > 0 && this.api.rateLimitRemainingSeconds() === 0) {
        this.generationDetail.set('A confirmar a Descoberta no Spotify…');
        discoveryClaudeTracks = await this.resolveCurrentDiscovery(
          discoverySuggestions,
          discoverySeedArtists,
          currentYear,
          dailySearchCache,
        );
      }

      const styleArtists: readonly SpotifyArtistDto[] = artists.length
        ? artists.slice(0, 12)
        : this.uniqueNames(libraryTracks.map((track) => track.artist))
            .slice(0, 12)
            .map((name) => ({ name, genres: [] }));

      this.generationDetail.set('A separar os teus estilos musicais…');
      const { releases, catalogByArtist } = await this.findReleases(
        styleArtists,
        currentYear,
        dailySearchCache,
      );
      const liked = this.store.tracks().filter((track) => track.liked);
      const recentIds = new Set(this.store.queueIds());
      const repeats = liked.filter((track) => !recentIds.has(track.id));
      const couldNotSearch =
        this.api.rateLimitRemainingSeconds() > 0 || this.api.searchBudgetRemaining() === 0;
      const keepIfEmpty = (fresh: readonly Track[], id: string): readonly Track[] => {
        if (fresh.length > 0 || !couldNotSearch) return fresh;
        return this.mixes().find((mix) => mix.id === id)?.tracks ?? fresh;
      };
      const discoveryTracks = keepIfEmpty(
        this.uniqueTracks(discoveryClaudeTracks).slice(0, TARGET_TRACKS),
        'discovery',
      );
      const releaseTracks = keepIfEmpty(releases.slice(0, TARGET_TRACKS), 'releases');
      const styleClusters = this.clusterArtistsByGenre(styleArtists, 4);
      const dailyStyleTracks = styleClusters.map((cluster) => {
        const clusterArtistNames = cluster.map((artist) => this.normalize(artist.name));
        const clusterCatalogs = cluster.map(
          (artist) => catalogByArtist.get(this.normalize(artist.name)) ?? [],
        );
        const familiarStyleTracks = libraryTracks.filter((track) =>
          clusterArtistNames.some((artist) => this.normalize(track.artist).includes(artist)),
        );
        return this.fillTracks(
          this.roundRobin(clusterCatalogs, TARGET_TRACKS),
          familiarStyleTracks,
          TARGET_TRACKS,
        );
      });
      const repeatTracks = this.fillTracks(repeats, libraryTracks, TARGET_TRACKS);
      const rediscoverTracks = [...libraryTracks]
        .sort((left, right) => left.addedAt.localeCompare(right.addedAt))
        .slice(0, TARGET_TRACKS);
      const dailyMix = (index: number, accent: MixAccent): QueuerMix => {
        const plan = claudeDailyPlans[index];
        const claudeConfigured = this.claude.status().configured;
        const useClaudePlan = claudeConfigured && claudePlanUsable;
        return this.createMix(
          `daily-${index + 1}`,
          useClaudePlan && plan?.name
            ? `Daily Mix ${index + 1} · ${plan.name}`
            : `Daily Mix ${index + 1}`,
          useClaudePlan
            ? (plan?.description ?? 'Curadoria diária do Claude.')
            : claudeConfigured
              ? (claudePlanError ?? 'A curadoria Claude não ficou pronta.')
              : this.styleLine(styleClusters[index] ?? []),
          accent,
          useClaudePlan
            ? (plannedDailyTracks[index] ?? [])
            : claudeConfigured
              ? []
              : (dailyStyleTracks[index] ?? []),
          'daily',
        );
      };
      const generatedDailyMixes = [
        dailyMix(0, 'ocean'),
        dailyMix(1, 'plum'),
        dailyMix(2, 'slate'),
        dailyMix(3, 'moss'),
      ];
      const previousDailyMixes = ['daily-1', 'daily-2', 'daily-3', 'daily-4']
        .map((id) => this.mixes().find((mix) => mix.id === id))
        .filter((mix): mix is QueuerMix => Boolean(mix));
      const previousDailySetValid =
        previousDailyMixes.length === 4 &&
        previousDailyMixes.every(
          (mix) =>
            mix.tracks.length >= MIN_MIX_TRACKS &&
            mix.tracks.every((track) => track.source === 'spotify'),
        );
      const dailyMixesToShow =
        this.claude.status().configured && !claudePlanUsable && previousDailySetValid
          ? previousDailyMixes
          : generatedDailyMixes;
      const daily: QueuerMix[] = [
        this.createMix(
          'discovery',
          'Descoberta',
          this.claude.status().configured
            ? 'Sugestões do Claude deste ano que ainda não aparecem no teu histórico, confirmadas no Spotify.'
            : 'Liga o Claude para receber músicas deste ano que ainda nunca ouviste.',
          'ember',
          discoveryTracks,
        ),
        this.createMix(
          'releases',
          'Lançamentos',
          'Música recente dos artistas que já fazem parte do teu gosto.',
          'moss',
          releaseTracks,
        ),
        ...dailyMixesToShow,
        this.createMix(
          'repeat',
          'On repeat',
          'As músicas a que tens voltado, sem barulho à volta.',
          'sand',
          repeatTracks,
          'repeat',
        ),
        this.createMix(
          'rediscover',
          'Redescobrir',
          'Músicas que já foram importantes e desapareceram da rotação.',
          'sand',
          rediscoverTracks,
          'rediscover',
        ),
      ];

      const custom = this.mixes().filter((mix) => mix.kind === 'custom');
      const merged = this.mergeWithPrevious(daily);
      this.setMixes([...merged, ...custom]);
      const completedDailyMixes = merged.filter((mix) => mix.kind === 'daily');
      const completedDailySet =
        completedDailyMixes.length === 4 &&
        completedDailyMixes.every(
          (mix) =>
            mix.tracks.length >= MIN_MIX_TRACKS &&
            mix.tracks.every((track) => track.source === 'spotify'),
        );
      const generationSucceeded =
        completedDailySet &&
        (!this.claude.status().configured || (claudePlanUsable && enoughNewMusic));
      try {
        if (generationSucceeded) localStorage.setItem(DAILY_DATE_KEY, today);
        else if (!previousDailySetValid) localStorage.removeItem(DAILY_DATE_KEY);
      } catch {}
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Não foi possível atualizar as mixes.';
      this.error.set(message);
      throw error;
    } finally {
      this.api.endSearchBudget();
      this.generating.set(null);
      this.generationDetail.set('');
    }
  }

  private async loadSpotifyTaste(): Promise<{
    artists: SpotifyArtistDto[];
    libraryTracks: Track[];
  }> {
    const cooldownSeconds = this.api.rateLimitRemainingSeconds();
    if (cooldownSeconds > 0) {
      throw new Error(
        `O Spotify limitou os pedidos. Tenta de novo daqui a ${formatWait(cooldownSeconds)}.`,
      );
    }
    const [artistResults, topTrackResults] = await Promise.all([
      Promise.allSettled([
        this.api.getTopArtists('short_term', 20),
        this.api.getTopArtists('medium_term', 20),
        this.api.getTopArtists('long_term', 20),
      ]),
      this.claude.status().configured
        ? Promise.resolve([])
        : Promise.allSettled([
            this.api.getTopTracks('short_term', 50),
            this.api.getTopTracks('medium_term', 50),
            this.api.getTopTracks('long_term', 50),
          ]),
    ]);
    const artistPages = artistResults.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const artists = [
      ...new Map(
        artistPages.flatMap((page) => page.items).map((artist) => [artist.id, artist]),
      ).values(),
    ]
      .filter((artist) => artist.id)
      .slice(0, 28);

    const topTracks = this.uniqueTracks(
      topTrackResults.flatMap((result) =>
        result.status === 'fulfilled' ? this.mapSearchTracks(result.value.items) : [],
      ),
    );
    const libraryTracks = this.uniqueTracks([
      ...topTracks,
      ...this.store.recentTracks(),
      ...this.store.tracks(),
    ]).filter((track) => Boolean(track.uri));

    if (!this.claude.status().configured && artists.length === 0 && libraryTracks.length === 0) {
      throw new Error('O Spotify ainda não devolveu músicas suficientes para criar as mixes.');
    }
    return { artists, libraryTracks };
  }

  private async askClaude(
    today: string,
    dailyRecipes: ReturnType<ListeningHistoryService['dailyPrototypes']>,
    tasteArtists: readonly string[],
    currentYear: number,
  ): Promise<{
    claudeDailyPlans: readonly ResolvedDailyMixPlan[];
    claudePlanError: string | null;
    discoverySuggestions: readonly RecommendationCandidate[];
    discoverySeedArtists: readonly string[];
  }> {
    let claudeDailyPlans: readonly ResolvedDailyMixPlan[] = [];
    let claudePlanError: string | null = null;
    let discoverySuggestions: readonly RecommendationCandidate[] = [];
    let discoverySeedArtists: readonly string[] = [];
    if (!this.claude.status().configured) {
      return { claudeDailyPlans, claudePlanError, discoverySuggestions, discoverySeedArtists };
    }
    const recipeArtists = this.uniqueNames([
      ...dailyRecipes.flatMap((recipe) => recipe.seedArtists),
      ...tasteArtists,
    ]).slice(0, 10);
    discoverySeedArtists = recipeArtists;
    try {
      this.generationDetail.set(
        this.i18n.t('O Claude está a procurar novidades de {year}…', { year: currentYear }),
      );
      const cachedDiscovery = this.readDiscoveryCache(today);
      if (cachedDiscovery) {
        discoverySuggestions = cachedDiscovery;
      } else {
        discoverySuggestions = await this.claude.recommend(
          `Para a mix Descoberta, sugere 60 músicas ou artistas próximos das referências indicadas e com atividade musical recente. Procura variedade, evita êxitos óbvios e não repitas artistas. Dá prioridade a possíveis lançamentos de ${currentYear}; o Queuer irá procurar o catálogo atual desses artistas no Spotify, confirmar o ano e remover localmente tudo o que eu já ouvi.`,
          recipeArtists,
          60,
        );
        this.writeDailyCache(CLAUDE_DISCOVERY_CACHE_KEY, today, discoverySuggestions);
      }
    } catch {}

    try {
      this.generationDetail.set('O Claude está a estudar o teu perfil musical completo…');
      const cachedPlans = this.readPlanCache(today);
      claudeDailyPlans =
        cachedPlans ??
        this.attachFamiliarTracks(
          await this.claude.planDailyMixes(this.history.claudeTasteProfile(dailyRecipes)),
        );
      if (!cachedPlans) this.writeDailyCache(CLAUDE_PLAN_CACHE_KEY, today, claudeDailyPlans);
    } catch (error: unknown) {
      claudePlanError =
        error instanceof Error
          ? error.message
          : 'O Claude não conseguiu separar as quatro Daily Mixes.';
      this.error.set(claudePlanError);
    }
    return { claudeDailyPlans, claudePlanError, discoverySuggestions, discoverySeedArtists };
  }

  private async findReleases(
    styleArtists: readonly SpotifyArtistDto[],
    currentYear: number,
    dailySearchCache: Map<string, Promise<SpotifySearchDto>>,
  ): Promise<{ releases: Track[]; catalogByArtist: Map<string, Track[]> }> {
    const releaseGroups: Track[][] = [];
    const catalogByArtist = new Map<string, Track[]>();
    const releaseArtists = this.claude.status().configured
      ? styleArtists.slice(0, RELEASE_ARTIST_SEARCHES)
      : styleArtists;
    const artistCache = readSavedCache<SavedSearch>(ARTIST_TRACKS_CACHE_KEY);
    const recentSpan = `${currentYear - 1}-${currentYear}`;
    for (const artist of releaseArtists) {
      if (this.api.rateLimitRemainingSeconds() > 0 || this.api.searchBudgetRemaining() === 0) {
        break;
      }
      const name = artist.name.replace(/"/g, '');
      const key = this.normalize(artist.name);
      const recent = await this.cachedTrackSearch(
        `${key}|${recentSpan}`,
        `artist:"${name}" year:${recentSpan}`,
        artistCache,
        dailySearchCache,
      );
      releaseGroups.push(recent ? [...recent] : []);
      if (!this.claude.status().configured) {
        const catalog = await this.cachedTrackSearch(
          `${key}|catalog`,
          `artist:"${name}"`,
          artistCache,
          dailySearchCache,
        );
        catalogByArtist.set(key, catalog ? [...catalog] : []);
      }
    }
    this.saveSearches(artistCache);

    const releases = this.uniqueTracks(releaseGroups.flat())
      .filter((track) => {
        const releaseYear = Number(track.releaseDate?.slice(0, 4));
        return releaseYear === currentYear || releaseYear === currentYear - 1;
      })
      .sort((left, right) => (right.releaseDate ?? '').localeCompare(left.releaseDate ?? ''));
    return { releases, catalogByArtist };
  }

  private mergeWithPrevious(daily: readonly QueuerMix[]): QueuerMix[] {
    const previousById = new Map(this.mixes().map((mix) => [mix.id, mix]));
    const merged = daily.map((mix) => {
      const previous = previousById.get(mix.id);
      const withTracks =
        ['repeat', 'rediscover'].includes(mix.id) &&
        mix.tracks.length === 0 &&
        previous?.tracks.length
          ? { ...mix, tracks: previous.tracks }
          : mix;
      return previous?.spotifyPlaylistId
        ? {
            ...withTracks,
            spotifyPlaylistId: previous.spotifyPlaylistId,
            spotifyUrl: previous.spotifyUrl,
            syncEnabled: previous.syncEnabled,
          }
        : withTracks;
    });
    return merged;
  }

  private describePlanFailure(
    plannedDailyTracks: readonly (readonly Track[])[],
    plannedDailyPools: readonly (readonly Track[])[],
  ): string {
    const counts = plannedDailyTracks.map((tracks) => tracks.length).join(', ');
    const poolCounts = plannedDailyPools.map((tracks) => tracks.length).join(', ');
    const searchFailures = this.api.searchFailureSummary();
    const waitSeconds = this.api.rateLimitRemainingSeconds();
    if (waitSeconds) {
      return this.i18n.t(
        'O Spotify limitou os pedidos. Tenta de novo daqui a {wait}; as Daily Mixes anteriores foram mantidas, se existirem.',
        { wait: formatWait(waitSeconds) },
      );
    }
    const message = this.i18n.t(
      'O Claude respondeu, mas os universos tinham {pools} candidatas e o Spotify confirmou {counts} de 50 músicas nas quatro Daily Mixes.',
      { pools: poolCounts || '0', counts: counts || '0' },
    );
    if (!searchFailures) return message;
    return (
      message +
      ' ' +
      this.i18n.t('Pesquisas Spotify falhadas: {failures}.', { failures: searchFailures })
    );
  }

  async createCustomMix(options: {
    readonly name: string;
    readonly prompt: string;
    readonly seedArtists: readonly string[];
    readonly count: number;
  }): Promise<QueuerMix> {
    this.generating.set('custom');
    this.generationDetail.set('O Claude está a preparar a seleção…');
    this.error.set(null);
    try {
      const candidates = await this.claude.recommend(
        options.prompt,
        options.seedArtists,
        Math.min(100, Math.max(options.count, Math.round(options.count * 1.35))),
      );
      this.generationDetail.set('A confirmar cada música no Spotify…');
      const resolvedTracks = await this.resolveRecommendations(candidates, options.count);
      if (resolvedTracks.length === 0) {
        throw new Error('O Spotify não encontrou nenhuma das sugestões desta mix.');
      }
      const unheard = resolvedTracks.filter((track) => !this.history.hasHeard(track));
      const mixTracks = this.fillTracks(unheard, resolvedTracks, options.count);
      const id = `custom-${Date.now()}`;
      const mix: QueuerMix = {
        id,
        name: options.name.trim() || 'Mix sem nome',
        description: options.prompt.trim(),
        kind: 'custom',
        accent: 'ember',
        tracks: mixTracks,
        targetCount: options.count,
        updatedAt: new Date().toISOString(),
        prompt: options.prompt.trim(),
      };
      this.setMixes([mix, ...this.mixes()]);
      this.openMix(id);
      return mix;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Não foi possível criar a mix.';
      this.error.set(message);
      throw error;
    } finally {
      this.generating.set(null);
      this.generationDetail.set('');
    }
  }

  async hydrateRediscover(): Promise<void> {
    const mix = this.mixes().find((item) => item.id === 'rediscover');
    if (!mix || mix.tracks.length > 0 || !this.history.summary()) return;
    const fromHistory = this.history
      .rediscoveryCandidates(TARGET_TRACKS * 2)
      .map((record) => this.history.trackFromRecord(record))
      .filter((track): track is Track => track !== null);
    this.replaceMix({
      ...mix,
      tracks: this.uniqueTracks(fromHistory).slice(0, TARGET_TRACKS),
      updatedAt: new Date().toISOString(),
    });
  }

  openMix(id: string): void {
    this.selectedMixId.set(id);
    const mix = this.mixes().find((item) => item.id === id);
    if (mix) this.store.mergeSpotifyCollection(`queuer:${id}`, mix.tracks);
    if (id === 'rediscover') void this.hydrateRediscover();
  }

  closeMix(): void {
    this.clearSelection();
    this.store.setCollection('home');
  }

  clearSelection(): void {
    this.selectedMixId.set(null);
  }

  markSynced(id: string, playlistId: string, spotifyUrl?: string): void {
    const mix = this.mixes().find((item) => item.id === id);
    if (!mix) return;
    this.replaceMix({
      ...mix,
      spotifyPlaylistId: playlistId,
      ...(spotifyUrl ? { spotifyUrl } : {}),
      syncEnabled: true,
    });
  }

  stopSync(id: string): void {
    const mix = this.mixes().find((item) => item.id === id);
    if (mix) this.replaceMix({ ...mix, syncEnabled: false });
  }

  private installDemoMixes(): void {
    const tracks = this.store.tracks();
    const now = new Date().toISOString();
    this.setMixes([
      {
        id: 'discovery',
        name: 'Descoberta',
        description: 'Músicas que ainda não ouviste, escolhidas a partir do teu histórico.',
        kind: 'discovery',
        accent: 'ember',
        tracks: tracks.slice(0, 10),
        targetCount: TARGET_TRACKS,
        updatedAt: now,
      },
      {
        id: 'releases',
        name: 'Lançamentos',
        description: 'Música nova de artistas que ouves e de outros próximos.',
        kind: 'releases',
        accent: 'moss',
        tracks: tracks.slice(2),
        targetCount: TARGET_TRACKS,
        updatedAt: now,
      },
      {
        id: 'daily-1',
        name: 'Daily Mix 1',
        description: 'Eletrónica, alternativa e artistas próximos.',
        kind: 'daily',
        accent: 'ocean',
        tracks: tracks.slice(0, 8),
        targetCount: TARGET_TRACKS,
        updatedAt: now,
      },
      {
        id: 'daily-2',
        name: 'Daily Mix 2',
        description: 'Indie, ambiente e música mais calma.',
        kind: 'daily',
        accent: 'plum',
        tracks: tracks.slice(3, 11),
        targetCount: TARGET_TRACKS,
        updatedAt: now,
      },
      {
        id: 'daily-3',
        name: 'Daily Mix 3',
        description: 'Ritmo, energia e descobertas recentes.',
        kind: 'daily',
        accent: 'slate',
        tracks: tracks.slice(1, 9),
        targetCount: TARGET_TRACKS,
        updatedAt: now,
      },
      {
        id: 'daily-4',
        name: 'Daily Mix 4',
        description: 'Uma quarta bolha do teu gosto, mantida separada das restantes.',
        kind: 'daily',
        accent: 'moss',
        tracks: tracks.slice(2, 10),
        targetCount: TARGET_TRACKS,
        updatedAt: now,
      },
      {
        id: 'rediscover',
        name: 'Redescobrir',
        description: 'Músicas que não ouves há algum tempo.',
        kind: 'rediscover',
        accent: 'sand',
        tracks: tracks.slice(4),
        targetCount: TARGET_TRACKS,
        updatedAt: now,
      },
    ]);
  }

  private createMix(
    id: string,
    name: string,
    description: string,
    accent: MixAccent,
    tracks: readonly Track[],
    kind: QueuerMix['kind'] = id.startsWith('daily-') ? 'daily' : (id as QueuerMix['kind']),
  ): QueuerMix {
    return {
      id,
      name,
      description,
      kind,
      accent,
      tracks: this.uniqueTracks(tracks).slice(0, TARGET_TRACKS),
      targetCount: TARGET_TRACKS,
      updatedAt: new Date().toISOString(),
    };
  }

  private mapSearchTracks(items: readonly SpotifyTrackDto[]): Track[] {
    return items
      .map((item) => mapSpotifyTrack(item, new Date().toISOString(), false))
      .filter((track): track is Track => track !== null);
  }

  private bestMatch(
    items: readonly SpotifyTrackDto[],
    title: string,
    artist: string,
  ): Track | null {
    const wantedTitle = this.normalize(title);
    const wantedBase = baseTrackTitle(title);
    const wantedArtist = this.normalize(artist);
    const ranked = items
      .map((item) => {
        const normalizedTitle = this.normalize(item.name);
        const titleScore =
          normalizedTitle === wantedTitle ? 5 : baseTrackTitle(item.name) === wantedBase ? 4 : 0;
        const artistScore = item.artists.some(
          (value) => this.normalize(value.name) === wantedArtist,
        )
          ? 5
          : item.artists.some((value) => {
                const candidate = this.normalize(value.name);
                return candidate.includes(wantedArtist) || wantedArtist.includes(candidate);
              })
            ? 2
            : 0;
        return { item, score: titleScore + artistScore, titleScore, artistScore };
      })
      .filter((candidate) => candidate.titleScore > 0 && candidate.artistScore > 0)
      .sort((left, right) => right.score - left.score);
    if (!ranked[0]) return null;
    return mapSpotifyTrack(ranked[0].item, new Date().toISOString(), false);
  }

  private async resolveRecommendations(
    candidates: readonly RecommendationCandidate[],
    limit: number,
    searchCache?: Map<string, Promise<SpotifySearchDto>>,
    reserve = 0,
  ): Promise<Track[]> {
    const resolved = new Map<string, Track>();
    const known = readSavedCache<SavedTrack>(RESOLVED_CACHE_KEY);
    let firstSearch = true;
    for (const candidate of candidates) {
      if (resolved.size >= limit || this.api.rateLimitRemainingSeconds() > 0) break;
      const key = this.trackIdentity(candidate);
      const cached = known[key];
      if (cached && this.savedTrackIsFresh(cached)) {
        if (cached.track) resolved.set(this.trackIdentity(cached.track), cached.track);
        continue;
      }
      if (this.api.searchBudgetRemaining() <= reserve) break;
      if (!firstSearch) await this.pause(EXACT_SEARCH_PAUSE_MS);
      firstSearch = false;
      try {
        const query = `track:"${candidate.title.replace(/"/g, '')}" artist:"${candidate.artist.replace(/"/g, '')}"`;
        const response = await this.searchTracksCached(query, 10, searchCache);
        const match = this.bestMatch(
          response.tracks?.items ?? [],
          candidate.title,
          candidate.artist,
        );
        known[key] = { track: match, at: Date.now() };
        if (match) resolved.set(this.trackIdentity(match), match);
      } catch {}
    }
    writeSavedCache(RESOLVED_CACHE_KEY, known, RESOLVED_CACHE_MAX_ENTRIES, (_, entry) =>
      this.savedTrackIsFresh(entry),
    );
    return [...resolved.values()].slice(0, limit);
  }

  private savedTrackIsFresh(entry: SavedTrack): boolean {
    const age = Date.now() - entry.at;
    const maxAge = entry.track ? RESOLVED_HIT_TTL_MS : RESOLVED_MISS_TTL_MS;
    return age >= 0 && age < maxAge;
  }

  private async resolveCurrentDiscovery(
    candidates: readonly RecommendationCandidate[],
    seedArtists: readonly string[],
    currentYear: number,
    searchCache: Map<string, Promise<SpotifySearchDto>>,
  ): Promise<Track[]> {
    const artistNames = this.uniqueNames([
      ...candidates.map((candidate) => candidate.artist),
      ...seedArtists,
    ]).slice(0, DISCOVERY_ARTIST_SEARCHES);
    const known = readSavedCache<SavedSearch>(ARTIST_TRACKS_CACHE_KEY);
    const results: Track[] = [];

    for (const artist of artistNames) {
      if (this.api.rateLimitRemainingSeconds() > 0 || this.api.searchBudgetRemaining() === 0) break;
      const found = await this.cachedTrackSearch(
        `${this.normalize(artist)}|${currentYear}`,
        `artist:"${artist.replace(/"/g, '')}" year:${currentYear}`,
        known,
        searchCache,
      );
      results.push(...(found ?? []));
    }
    this.saveSearches(known);

    const perArtist = new Map<string, number>();
    return this.uniqueTracks(results)
      .filter(
        (track) =>
          track.releaseDate?.startsWith(String(currentYear)) && !this.history.hasHeard(track),
      )
      .filter((track) => {
        const artist = this.normalize(track.artist.split(',')[0] ?? track.artist);
        const count = perArtist.get(artist) ?? 0;
        if (count >= 3) return false;
        perArtist.set(artist, count + 1);
        return true;
      })
      .slice(0, TARGET_TRACKS);
  }

  private attachFamiliarTracks(plans: readonly ClaudeDailyMixPlan[]): ResolvedDailyMixPlan[] {
    const toTracks = (ids: readonly number[]): Track[] =>
      this.uniqueTracks(
        ids
          .map((id) => this.history.familiarTrackById(id))
          .filter((track): track is Track => track !== null),
      );
    const resolved = plans.map((plan) => ({
      name: plan.name,
      description: plan.description,
      seedArtists: plan.seedArtists,
      favoriteTracks: toTracks(plan.favoriteIds ?? []),
      rareTracks: toTracks(plan.rareIds ?? []),
    }));
    if (
      resolved.some(
        (plan) =>
          plan.favoriteTracks.length < MIN_FAMILIAR_PER_LIST ||
          plan.rareTracks.length < MIN_FAMILIAR_PER_LIST,
      )
    ) {
      throw new Error('O Claude escolheu músicas que não existem no teu histórico.');
    }
    return resolved;
  }

  private async resolveDailyPlanPool(
    plan: ResolvedDailyMixPlan,
    searchCache: Map<string, Promise<SpotifySearchDto>>,
  ): Promise<Track[]> {
    const fresh = await this.resolveNewArtistTracks(plan.seedArtists, searchCache);
    return this.uniqueTracks(
      weaveByShare(
        [this.uniqueTracks(plan.favoriteTracks), this.uniqueTracks(plan.rareTracks), fresh],
        [DAILY_FAVORITES, DAILY_RARE, DAILY_NEW],
      ),
    );
  }

  private async resolveNewArtistTracks(
    artists: readonly string[],
    searchCache: Map<string, Promise<SpotifySearchDto>>,
  ): Promise<Track[]> {
    const known = readSavedCache<SavedSearch>(ARTIST_TRACKS_CACHE_KEY);
    const groups: Track[][] = [];
    for (const artist of artists.slice(0, DAILY_NEW_ARTISTS)) {
      if (this.api.rateLimitRemainingSeconds() > 0 || this.api.searchBudgetRemaining() === 0) {
        break;
      }
      const key = this.normalize(artist);
      const found = await this.cachedTrackSearch(
        key,
        `artist:"${artist.replace(/"/g, '')}"`,
        known,
        searchCache,
        (track) => {
          const credited = this.normalize(track.artist);
          return credited.includes(key) || key.includes(credited);
        },
      );
      if (found) groups.push(found.filter((track) => !this.history.hasHeard(track)));
    }
    this.saveSearches(known);
    return this.roundRobin(groups, 200);
  }

  private async cachedTrackSearch(
    key: string,
    query: string,
    known: Record<string, SavedSearch>,
    searchCache: Map<string, Promise<SpotifySearchDto>>,
    keep: (track: Track) => boolean = () => true,
  ): Promise<readonly Track[] | null> {
    const entry = known[key];
    if (entry && this.savedSearchIsFresh(key, entry)) return entry.tracks;
    if (this.api.rateLimitRemainingSeconds() > 0 || this.api.searchBudgetRemaining() === 0) {
      return null;
    }
    const wait = this.lastRealSearchAt + SEARCH_SPACING_MS - Date.now();
    if (wait > 0) await this.pause(wait);
    this.lastRealSearchAt = Date.now();
    try {
      const search = await this.searchTracksCached(query, 10, searchCache);
      const tracks = this.mapSearchTracks(search.tracks?.items ?? []).filter(keep);
      known[key] = { tracks, at: Date.now() };
      return tracks;
    } catch {
      return null;
    }
  }

  private savedSearchIsFresh(key: string, entry: SavedSearch): boolean {
    const age = Date.now() - entry.at;
    const maxAge = key.includes('|') ? RECENT_TRACKS_TTL_MS : ARTIST_TRACKS_TTL_MS;
    return age >= 0 && age < maxAge;
  }

  private saveSearches(searches: Record<string, SavedSearch>): void {
    writeSavedCache(ARTIST_TRACKS_CACHE_KEY, searches, ARTIST_TRACKS_MAX_ENTRIES, (key, entry) =>
      this.savedSearchIsFresh(key, entry),
    );
  }

  private searchTracksCached(
    query: string,
    limit: number,
    cache?: Map<string, Promise<SpotifySearchDto>>,
  ): Promise<SpotifySearchDto> {
    if (!cache) return this.api.searchTracks(query, undefined, limit);
    const key = `${limit}:${this.normalize(query)}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const request = this.api.searchTracks(query, undefined, limit);
    cache.set(key, request);
    void request.catch(() => cache.delete(key));
    return request;
  }

  private pause(milliseconds: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  private allocateDailyTracks(pools: readonly (readonly Track[])[]): Track[][] {
    if (pools.length !== 4) return pools.map((pool) => pool.slice(0, TARGET_TRACKS));

    const rankedPools = pools.map((pool) => this.uniqueTracks(pool));
    const slots = Array.from({ length: TARGET_TRACKS }, (_, position) =>
      rankedPools.map((_, mixIndex) => ({ mixIndex, position })),
    ).flat();
    const assignment = new Map<number, Track>();
    const ownerByTrack = new Map<string, number>();

    const assign = (
      slotIndex: number,
      seenTracks: Set<string>,
      seenSlots: Set<number>,
    ): boolean => {
      if (seenSlots.has(slotIndex)) return false;
      seenSlots.add(slotIndex);
      const slot = slots[slotIndex];
      if (!slot) return false;

      for (const track of rankedPools[slot.mixIndex] ?? []) {
        const key = this.trackIdentity(track);
        if (seenTracks.has(key)) continue;
        seenTracks.add(key);
        const currentOwner = ownerByTrack.get(key);
        if (currentOwner === undefined || assign(currentOwner, seenTracks, new Set(seenSlots))) {
          assignment.set(slotIndex, track);
          ownerByTrack.set(key, slotIndex);
          return true;
        }
      }
      return false;
    };

    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      assign(slotIndex, new Set<string>(), new Set<number>());
    }

    return rankedPools.map((pool, mixIndex) => {
      const rank = new Map(pool.map((track, index) => [this.trackIdentity(track), index]));
      return [...assignment.entries()]
        .filter(([slotIndex]) => slots[slotIndex]?.mixIndex === mixIndex)
        .map(([, track]) => track)
        .sort(
          (left, right) =>
            (rank.get(this.trackIdentity(left)) ?? Number.MAX_SAFE_INTEGER) -
            (rank.get(this.trackIdentity(right)) ?? Number.MAX_SAFE_INTEGER),
        );
    });
  }

  private topUpShortMixes(mixes: readonly (readonly Track[])[]): Track[][] {
    const used = new Set(mixes.flatMap((mix) => mix.map((track) => this.trackIdentity(track))));
    const reserve = this.history
      .reserveTracks()
      .filter((track) => !used.has(this.trackIdentity(track)));
    const primaryArtist = (track: Track): string =>
      this.normalize(track.artist.split(',')[0] ?? track.artist);

    return mixes.map((mix) => {
      const missing = TARGET_TRACKS - mix.length;
      if (missing <= 0 || missing > MAX_TOP_UP_PER_MIX) return [...mix];
      const inMix = new Set(mix.map(primaryArtist));
      const addedPerArtist = new Map<string, number>();
      const extra: Track[] = [];
      for (const candidate of reserve) {
        if (extra.length >= missing) break;
        const key = this.trackIdentity(candidate);
        const artist = primaryArtist(candidate);
        if (used.has(key) || !inMix.has(artist)) continue;
        if ((addedPerArtist.get(artist) ?? 0) >= 2) continue;
        addedPerArtist.set(artist, (addedPerArtist.get(artist) ?? 0) + 1);
        used.add(key);
        extra.push(candidate);
      }
      return [...mix, ...extra];
    });
  }

  private async fillShortMixesWithClaude(
    mixes: readonly (readonly Track[])[],
    plans: readonly ResolvedDailyMixPlan[],
    searchCache: Map<string, Promise<SpotifySearchDto>>,
  ): Promise<Track[][]> {
    const used = new Set(mixes.flatMap((mix) => mix.map((track) => this.trackIdentity(track))));
    const result: Track[][] = [];
    for (let index = 0; index < mixes.length; index += 1) {
      const mix = mixes[index] ?? [];
      const plan = plans[index];
      const missing = TARGET_TRACKS - mix.length;
      const blocked =
        this.api.rateLimitRemainingSeconds() > 0 ||
        this.api.searchBudgetRemaining() <= AUX_SEARCH_RESERVE;
      if (!plan || missing <= 0 || missing > MAX_CLAUDE_FILL_PER_MIX || blocked) {
        result.push([...mix]);
        continue;
      }
      this.generationDetail.set(
        this.i18n.t('O Claude está a completar a Daily Mix {index}…', { index: index + 1 }),
      );
      try {
        const candidates = await this.claude.recommend(
          `Mix "${plan.name}": ${plan.description} Sugere músicas reais que encaixem no estilo desta mix, de artistas variados e de preferência que o utilizador ainda não tenha ouvido. Não repitas artistas em excesso.`,
          plan.seedArtists.slice(0, 10),
          Math.max(10, missing * 2),
        );
        const fresh = candidates.filter((candidate) => !used.has(this.trackIdentity(candidate)));
        const resolved = await this.resolveRecommendations(
          fresh,
          missing + 2,
          searchCache,
          AUX_SEARCH_RESERVE,
        );
        const extra: Track[] = [];
        for (const track of resolved) {
          const key = this.trackIdentity(track);
          if (used.has(key)) continue;
          used.add(key);
          extra.push(track);
          if (extra.length >= missing) break;
        }
        result.push([...mix, ...extra]);
      } catch {
        result.push([...mix]);
      }
    }
    return result;
  }

  private roundRobin(groups: readonly (readonly Track[])[], limit: number): Track[] {
    const result: Track[] = [];
    const seen = new Set<string>();
    for (let index = 0; result.length < limit; index += 1) {
      let added = false;
      for (const group of groups) {
        const track = group[index];
        if (!track || seen.has(track.id)) continue;
        seen.add(track.id);
        result.push(track);
        added = true;
        if (result.length >= limit) break;
      }
      if (!added) break;
    }
    return result;
  }

  private uniqueTracks(tracks: readonly Track[]): Track[] {
    return [...new Map(tracks.map((track) => [this.trackIdentity(track), track])).values()];
  }

  private trackIdentity(track: Pick<Track, 'title' | 'artist'>): string {
    return recordingIdentity(track.title, track.artist);
  }

  private fillTracks(
    preferred: readonly Track[],
    fallback: readonly Track[],
    limit: number,
  ): Track[] {
    return this.uniqueTracks([...preferred, ...fallback]).slice(0, limit);
  }

  private rotate<T>(values: readonly T[], offset: number): T[] {
    if (values.length === 0) return [];
    const start = offset % values.length;
    return [...values.slice(start), ...values.slice(0, start)];
  }

  private uniqueNames(names: readonly string[]): string[] {
    return [...new Set(names.filter(Boolean))];
  }

  private normalize(value: string): string {
    return normalizeText(value);
  }

  private artistLine(names: readonly string[]): string {
    const visible = names.slice(0, 3);
    return visible.length
      ? this.i18n.t('{artists} e artistas próximos.', { artists: visible.join(', ') })
      : this.i18n.t('Uma seleção feita para hoje.');
  }

  private clusterArtistsByGenre(
    artists: readonly SpotifyArtistDto[],
    count: number,
  ): readonly (readonly SpotifyArtistDto[])[] {
    const groups = Array.from({ length: count }, () => [] as SpotifyArtistDto[]);
    if (artists.length === 0) return groups;

    const seeds: SpotifyArtistDto[] = [artists[0]];
    while (seeds.length < Math.min(count, artists.length)) {
      const candidates = artists.filter((artist) => !seeds.includes(artist));
      const next = candidates.sort((left, right) => {
        const leftDistance = Math.min(...seeds.map((seed) => 1 - this.genreSimilarity(left, seed)));
        const rightDistance = Math.min(
          ...seeds.map((seed) => 1 - this.genreSimilarity(right, seed)),
        );
        return rightDistance - leftDistance;
      })[0];
      if (!next) break;
      seeds.push(next);
    }
    seeds.forEach((seed, index) => groups[index]?.push(seed));

    for (const artist of artists) {
      if (seeds.includes(artist)) continue;
      let bestGroup = 0;
      let bestScore = -1;
      for (let index = 0; index < seeds.length; index += 1) {
        const score = this.genreSimilarity(artist, seeds[index]);
        if (
          score > bestScore ||
          (score === bestScore && groups[index].length < groups[bestGroup].length)
        ) {
          bestScore = score;
          bestGroup = index;
        }
      }
      groups[bestGroup].push(artist);
    }
    return groups;
  }

  private genreSimilarity(left: SpotifyArtistDto, right: SpotifyArtistDto): number {
    const leftTokens = this.genreTokens(left.genres ?? []);
    const rightTokens = this.genreTokens(right.genres ?? []);
    if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
    const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    const union = new Set([...leftTokens, ...rightTokens]).size;
    return union ? intersection / union : 0;
  }

  private genreTokens(genres: readonly string[]): Set<string> {
    const tokens = new Set<string>();
    const families: ReadonlyArray<readonly [string, RegExp]> = [
      ['rap', /hip hop|rap|trap|drill/],
      ['rock', /rock|grunge|shoegaze/],
      ['metal', /metal|deathcore|metalcore/],
      ['electronic', /electro|house|techno|ambient|edm|dance/],
      ['pop', /pop|hyperpop/],
      ['rnb', /r&b|rnb|soul|funk/],
      ['indie', /indie|alternative/],
      ['acoustic', /folk|acoustic|singer-songwriter|country/],
      ['jazz', /jazz|blues/],
      ['latin', /latin|reggaeton|urbano/],
    ];
    for (const genre of genres) {
      const normalized = this.normalize(genre);
      tokens.add(normalized);
      normalized
        .split(' ')
        .filter(Boolean)
        .forEach((token) => tokens.add(token));
      for (const [family, pattern] of families) if (pattern.test(normalized)) tokens.add(family);
    }
    return tokens;
  }

  private styleLine(artists: readonly SpotifyArtistDto[]): string {
    const genreCounts = new Map<string, number>();
    for (const genre of artists.flatMap((artist) => artist.genres ?? [])) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
    }
    const genres = [...genreCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 2)
      .map(([genre]) => genre);
    const artistNames = artists.slice(0, 3).map((artist) => artist.name);
    const prefix = genres.length ? `${genres.join(' · ')} — ` : '';
    return artistNames.length
      ? prefix + this.i18n.t('{artists} e artistas próximos.', { artists: artistNames.join(', ') })
      : this.i18n.t('Uma bolha distinta do teu gosto musical.');
  }

  private chunk<T>(values: readonly T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size)
      chunks.push(values.slice(index, index + size));
    return chunks;
  }

  private replaceMix(next: QueuerMix): void {
    this.setMixes(this.mixes().map((mix) => (mix.id === next.id ? next : mix)));
  }

  private setMixes(mixes: readonly QueuerMix[]): void {
    this.mixesState.set(mixes);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mixes));
    } catch {}
  }

  private readStoredMixes(): readonly QueuerMix[] {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value ? (JSON.parse(value) as QueuerMix[]) : [];
    } catch {
      return [];
    }
  }

  private hasRealDailyMixes(): boolean {
    const requiredIds = ['daily-1', 'daily-2', 'daily-3', 'daily-4'];
    return requiredIds.every((id) => {
      const mix = this.mixes().find((item) => item.id === id);
      return Boolean(
        mix &&
        mix.tracks.length >= MIN_MIX_TRACKS &&
        mix.tracks.every((track) => track.source === 'spotify'),
      );
    });
  }

  private readPlanCache(today: string): readonly ResolvedDailyMixPlan[] | null {
    const cached = this.readDailyCache<readonly ResolvedDailyMixPlan[]>(
      CLAUDE_PLAN_CACHE_KEY,
      today,
    );
    if (
      !cached ||
      cached.length !== 4 ||
      cached.some(
        (plan) =>
          !plan?.name?.trim() ||
          !Array.isArray(plan.seedArtists) ||
          !Array.isArray(plan.favoriteTracks) ||
          !Array.isArray(plan.rareTracks) ||
          plan.favoriteTracks.length < MIN_FAMILIAR_PER_LIST ||
          plan.rareTracks.length < MIN_FAMILIAR_PER_LIST,
      )
    )
      return null;
    return cached;
  }

  private readDiscoveryCache(today: string): readonly RecommendationCandidate[] | null {
    const cached = this.readDailyCache<readonly RecommendationCandidate[]>(
      CLAUDE_DISCOVERY_CACHE_KEY,
      today,
    );
    return cached && cached.length >= 10 ? cached : null;
  }

  private readDailyCache<T>(key: string, today: string): T | null {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? 'null') as {
        readonly date?: string;
        readonly value?: T;
      } | null;
      return value?.date === today && value.value !== undefined ? value.value : null;
    } catch {
      return null;
    }
  }

  private writeDailyCache(key: string, today: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify({ date: today, value }));
    } catch {}
  }

  private todayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  }
}
