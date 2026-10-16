import { Injectable, signal } from '@angular/core';
import { ListeningHistorySummary, PlaylistPrototype, Track } from '../models/music.models';
import { buildPlaylistPrototypes, selectDailyPrototypes } from './playlist-prototypes';

const DB_NAME = 'queuer-listening-history';
const DB_VERSION = 1;
const STORE_NAME = 'tracks';
const SUMMARY_KEY = 'queuer.history-summary.v1';
const PROTOTYPES_KEY = 'queuer.playlist-prototypes.v1';
const SPOTIFY_TRACK_URI = /^spotify:track:([A-Za-z0-9]{22})$/;
const FAVORITE_CANDIDATES = 200;
const RARE_CANDIDATES = 300;
const RARE_MAX_PLAYS = 4;
const SIMILAR_CANDIDATES = 300;

export interface HistoryTrackRecord {
  readonly key: string;
  readonly uri?: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly plays: number;
  readonly playsLastYear?: number;
  readonly playsLast3Years?: number;
  readonly msPlayed: number;
  readonly firstPlayedAt: string;
  readonly lastPlayedAt: string;
}

interface RawStreamingEntry {
  readonly ts?: unknown;
  readonly endTime?: unknown;
  readonly master_metadata_track_name?: unknown;
  readonly master_metadata_album_artist_name?: unknown;
  readonly master_metadata_album_album_name?: unknown;
  readonly spotify_track_uri?: unknown;
  readonly trackName?: unknown;
  readonly artistName?: unknown;
  readonly albumName?: unknown;
  readonly ms_played?: unknown;
  readonly msPlayed?: unknown;
}

interface NormalizedPlay {
  readonly eventKey: string;
  readonly key: string;
  readonly uri?: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly playedAt: string;
  readonly msPlayed: number;
}

@Injectable({ providedIn: 'root' })
export class ListeningHistoryService {
  readonly summary = signal<ListeningHistorySummary | null>(this.readStoredSummary());
  readonly prototypes = signal<readonly PlaylistPrototype[]>(this.readStoredPrototypes());
  readonly importing = signal(false);
  readonly ready = signal(false);
  readonly error = signal<string | null>(null);

  private readonly heardKeys = new Set<string>();
  private readonly heardUris = new Set<string>();
  private records: readonly HistoryTrackRecord[] = [];
  private initialization: Promise<void> | null = null;

  initialize(): Promise<void> {
    this.initialization ??= this.loadIndex();
    return this.initialization;
  }

  async clear(): Promise<void> {
    await this.replaceDatabase([]);
    this.setIndex([]);
    this.prototypes.set([]);
    this.summary.set(null);
    this.error.set(null);
    try {
      localStorage.removeItem(SUMMARY_KEY);
      localStorage.removeItem(PROTOTYPES_KEY);
    } catch {}
  }

  async importFiles(files: readonly File[]): Promise<ListeningHistorySummary> {
    this.importing.set(true);
    this.error.set(null);

    try {
      const payloads = await this.readPayloads(files);
      const seenEvents = new Set<string>();
      const plays: NormalizedPlay[] = [];

      for (const payload of payloads) {
        for (const item of payload) {
          const play = this.normalizePlay(item);
          if (!play || seenEvents.has(play.eventKey)) continue;
          seenEvents.add(play.eventKey);
          plays.push(play);
        }
      }

      if (plays.length === 0) {
        throw new Error('Não encontrei reproduções de música válidas nestes ficheiros.');
      }

      const aggregate = new Map<string, HistoryTrackRecord>();
      const now = new Date();
      const oneYearAgo = new Date(now);
      oneYearAgo.setFullYear(now.getFullYear() - 1);
      const threeYearsAgo = new Date(now);
      threeYearsAgo.setFullYear(now.getFullYear() - 3);
      for (const play of plays) {
        const previous = aggregate.get(play.key);
        const playedAt = new Date(play.playedAt).getTime();
        aggregate.set(play.key, {
          key: play.key,
          ...(play.uri ? { uri: play.uri } : previous?.uri ? { uri: previous.uri } : {}),
          title: play.title,
          artist: play.artist,
          album: play.album || previous?.album || '',
          plays: (previous?.plays ?? 0) + 1,
          playsLastYear:
            (previous?.playsLastYear ?? 0) + (playedAt >= oneYearAgo.getTime() ? 1 : 0),
          playsLast3Years:
            (previous?.playsLast3Years ?? 0) + (playedAt >= threeYearsAgo.getTime() ? 1 : 0),
          msPlayed: (previous?.msPlayed ?? 0) + play.msPlayed,
          firstPlayedAt:
            !previous || play.playedAt < previous.firstPlayedAt
              ? play.playedAt
              : previous.firstPlayedAt,
          lastPlayedAt:
            !previous || play.playedAt > previous.lastPlayedAt
              ? play.playedAt
              : previous.lastPlayedAt,
        });
      }

      const records = [...aggregate.values()];
      await this.replaceDatabase(records);
      this.setIndex(records);
      this.rebuildPrototypes(records);

      const summary = this.buildSummary(plays, records, payloads.length);
      localStorage.setItem(SUMMARY_KEY, JSON.stringify(summary));
      this.summary.set(summary);
      this.ready.set(true);
      return summary;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Não foi possível importar o histórico.';
      this.error.set(message);
      throw error;
    } finally {
      this.importing.set(false);
    }
  }

  hasHeard(track: Pick<Track, 'id' | 'uri' | 'title' | 'artist'>): boolean {
    if (track.uri && this.heardUris.has(track.uri)) return true;
    return this.heardKeys.has(this.trackKey(track.artist, track.title));
  }

  hasHeardByName(artist: string, title: string): boolean {
    return this.heardKeys.has(this.trackKey(artist, title));
  }

  topHistoricalTracks(limit = 100): readonly HistoryTrackRecord[] {
    return [...this.records]
      .sort((left, right) => right.plays - left.plays || right.msPlayed - left.msPlayed)
      .slice(0, limit);
  }

  rediscoveryCandidates(limit = 100): readonly HistoryTrackRecord[] {
    const recentBoundary = Date.now() - 1000 * 60 * 60 * 24 * 120;
    return [...this.records]
      .filter((track) => new Date(track.lastPlayedAt).getTime() < recentBoundary)
      .sort(
        (left, right) =>
          right.plays - left.plays || left.lastPlayedAt.localeCompare(right.lastPlayedAt),
      )
      .slice(0, limit);
  }

  dailyPrototypes(dayKey: string, count = 6): readonly PlaylistPrototype[] {
    return selectDailyPrototypes(this.prototypes(), dayKey, count);
  }

  private familiarIndex: readonly HistoryTrackRecord[] = [];

  familiarTrackById(id: number): Track | null {
    return this.trackFromRecord(this.familiarIndex[id - 1]);
  }

  reserveTracks(limit = 300): readonly Track[] {
    return this.topHistoricalTracks(limit * 2)
      .map((record) => this.trackFromRecord(record))
      .filter((track): track is Track => track !== null)
      .slice(0, limit);
  }

  private similarIndex: readonly HistoryTrackRecord[] = [];

  similarCandidates(seed: { readonly title: string; readonly artist: string }): readonly {
    id: number;
    title: string;
    artist: string;
  }[] {
    const seedKey = this.trackKey(seed.artist, seed.title);
    this.similarIndex = this.topHistoricalTracks(SIMILAR_CANDIDATES + 20)
      .filter(
        (record) =>
          SPOTIFY_TRACK_URI.test(record.uri ?? '') &&
          this.trackKey(record.artist, record.title) !== seedKey,
      )
      .slice(0, SIMILAR_CANDIDATES);
    return this.similarIndex.map((record, index) => ({
      id: index + 1,
      title: record.title,
      artist: record.artist,
    }));
  }

  similarTrackById(id: number): Track | null {
    return this.trackFromRecord(this.similarIndex[id - 1]);
  }

  trackFromRecord(record: HistoryTrackRecord | undefined): Track | null {
    const spotifyId = record?.uri?.match(SPOTIFY_TRACK_URI)?.[1];
    if (!record || !spotifyId) return null;
    return {
      id: spotifyId,
      title: record.title,
      artist: record.artist,
      album: record.album,
      durationSeconds: 0,
      addedAt: record.lastPlayedAt,
      artwork: { source: 'placeholder', label: `Capa de ${record.album || record.title}` },
      tags: [],
      playlistIds: [],
      explicit: false,
      liked: false,
      uri: record.uri,
      source: 'spotify',
    };
  }

  private familiarCandidates(weightOf: (record: HistoryTrackRecord) => number): {
    readonly favorites: readonly { id: number; title: string; artist: string; score: number }[];
    readonly rare: readonly { id: number; title: string; artist: string }[];
  } {
    const playable = this.records.filter((record) => SPOTIFY_TRACK_URI.test(record.uri ?? ''));
    const scored = playable
      .map((record) => ({ record, score: weightOf(record) }))
      .sort((left, right) => right.score - left.score);
    const favorites = scored.slice(0, FAVORITE_CANDIDATES);
    const favoriteKeys = new Set(favorites.map((entry) => entry.record.key));
    const rare = scored
      .filter(
        (entry) => !favoriteKeys.has(entry.record.key) && entry.record.plays <= RARE_MAX_PLAYS,
      )
      .slice(0, RARE_CANDIDATES);

    this.familiarIndex = [...favorites, ...rare].map((entry) => entry.record);
    const compact = (value: string) => value.trim().slice(0, 100);
    return {
      favorites: favorites.map((entry, index) => ({
        id: index + 1,
        title: compact(entry.record.title),
        artist: compact(entry.record.artist),
        score: entry.score,
      })),
      rare: rare.map((entry, index) => ({
        id: favorites.length + index + 1,
        title: compact(entry.record.title),
        artist: compact(entry.record.artist),
      })),
    };
  }

  claudeTasteProfile(dailyRecipes: readonly PlaylistPrototype[] = []): string {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 3);
    const cutoffTime = cutoff.getTime();
    const now = Date.now();
    const artistStats = new Map<
      string,
      {
        plays: number;
        weightedScore: number;
        lastPlayedAt: string;
        tracks: HistoryTrackRecord[];
      }
    >();

    const recencyOf = (track: HistoryTrackRecord) => {
      const lastPlayedTime = new Date(track.lastPlayedAt).getTime();
      const inferredRecentPlays = lastPlayedTime >= cutoffTime ? track.plays : 0;
      const recentPlays = track.playsLast3Years ?? inferredRecentPlays;
      const lastYearPlays =
        track.playsLastYear ?? (lastPlayedTime >= now - 31_536_000_000 ? track.plays : 0);
      const yearsTwoAndThreePlays = Math.max(0, recentPlays - lastYearPlays);
      const olderPlays = Math.max(0, track.plays - recentPlays);
      const weightedScore =
        Math.round((lastYearPlays * 4 + yearsTwoAndThreePlays * 2.5 + olderPlays) * 10) / 10;
      return { lastPlayedTime, recentPlays, lastYearPlays, weightedScore };
    };

    const weightedTracks = this.records.map((track) => {
      const { lastPlayedTime, recentPlays, lastYearPlays, weightedScore } = recencyOf(track);
      const stats = artistStats.get(track.artist) ?? {
        plays: 0,
        weightedScore: 0,
        lastPlayedAt: track.lastPlayedAt,
        tracks: [],
      };
      stats.plays += track.plays;
      stats.weightedScore += weightedScore;
      if (track.lastPlayedAt > stats.lastPlayedAt) stats.lastPlayedAt = track.lastPlayedAt;
      stats.tracks.push(track);
      artistStats.set(track.artist, stats);
      return {
        title: track.title,
        artist: track.artist,
        album: track.album,
        plays: track.plays,
        playsLastYear: lastYearPlays,
        playsLast3Years: recentPlays,
        lastPlayedAt: track.lastPlayedAt,
        heardInLast3Years: lastPlayedTime >= cutoffTime,
        weightedScore,
      };
    });

    const artists = [...artistStats.entries()]
      .map(([name, stats]) => ({
        name,
        plays: stats.plays,
        weightedScore: Math.round(stats.weightedScore * 10) / 10,
        lastPlayedAt: stats.lastPlayedAt,
        topTracks: stats.tracks
          .sort((left, right) => right.plays - left.plays)
          .slice(0, 4)
          .map((track) => ({ title: track.title, plays: track.plays })),
      }))
      .sort((left, right) => right.weightedScore - left.weightedScore);
    const tracks = weightedTracks.sort((left, right) => right.weightedScore - left.weightedScore);
    const compactText = (value: string, limit = 160) => value.trim().slice(0, limit);
    const summary = this.summary();
    let artistProfiles = artists.slice(0, 80).map((artist) => ({
      ...artist,
      name: compactText(artist.name),
      topTracks: artist.topTracks.map((track) => ({
        ...track,
        title: compactText(track.title),
      })),
    }));
    let longTailArtistNames = artists
      .slice(80, 240)
      .map((artist) => compactText(artist.name))
      .filter(Boolean);
    let familiar = this.familiarCandidates((record) => recencyOf(record).weightedScore);
    let weightedTrackProfiles = tracks.slice(0, 60).map((track) => ({
      ...track,
      title: compactText(track.title),
      artist: compactText(track.artist),
      album: compactText(track.album),
    }));
    let playlistRecipes = dailyRecipes.slice(0, 6).map((recipe) => ({
      mode: recipe.mode,
      seedArtists: recipe.seedArtists.map((artist) => compactText(artist)).slice(0, 6),
      seedTracks: recipe.seedTracks.slice(0, 5).map((track) => ({
        title: compactText(track.title),
        artist: compactText(track.artist),
      })),
      era: compactText(recipe.era, 24),
      discoveryPercent: recipe.discoveryPercent,
      brief: compactText(recipe.brief, 220),
    }));
    const buildProfile = () => ({
      generatedAt: new Date().toISOString(),
      policy: {
        recentWindowYears: 3,
        requestedRecentWeightPercent: 70,
        requestedOlderWeightPercent: 30,
        note: 'weightedScore uses 4x for the last year, 2.5x for years 2–3, and 1x before that',
      },
      completeHistorySummary: summary
        ? {
            ...summary,
            topArtists: summary.topArtists.slice(0, 50).map((artist) => ({
              ...artist,
              name: compactText(artist.name),
            })),
            topTracks: summary.topTracks.slice(0, 80).map((track) => ({
              ...track,
              title: compactText(track.title),
              artist: compactText(track.artist),
            })),
          }
        : null,
      artistProfiles,
      longTailArtistNames,
      weightedTrackProfiles,
      familiarCandidates: familiar,
      playlistRecipes,
    });

    let serialized = JSON.stringify(buildProfile());
    const encoder = new TextEncoder();
    while (encoder.encode(serialized).byteLength > 120_000) {
      if (familiar.rare.length > 120)
        familiar = { favorites: familiar.favorites, rare: familiar.rare.slice(0, -40) };
      else if (weightedTrackProfiles.length > 30)
        weightedTrackProfiles = weightedTrackProfiles.slice(0, -10);
      else if (longTailArtistNames.length > 40)
        longTailArtistNames = longTailArtistNames.slice(0, -20);
      else if (artistProfiles.length > 40) artistProfiles = artistProfiles.slice(0, -10);
      else if (playlistRecipes.length > 2) playlistRecipes = playlistRecipes.slice(0, -1);
      else break;
      serialized = JSON.stringify(buildProfile());
    }
    return serialized;
  }

  private async loadIndex(): Promise<void> {
    try {
      const records = await this.readAllRecords();
      this.setIndex(records);
      if (records.length > 0 && this.prototypes().length !== 200) this.rebuildPrototypes(records);
      this.ready.set(true);
    } catch {
      this.error.set('O índice local do histórico não pôde ser aberto.');
    }
  }

  private setIndex(records: readonly HistoryTrackRecord[]): void {
    this.records = records;
    this.heardKeys.clear();
    this.heardUris.clear();
    for (const record of records) {
      this.heardKeys.add(record.key);
      if (record.uri) this.heardUris.add(record.uri);
    }
  }

  private async readPayloads(files: readonly File[]): Promise<readonly RawStreamingEntry[][]> {
    const payloads: RawStreamingEntry[][] = [];
    for (const file of files) {
      if (file.name.toLocaleLowerCase().endsWith('.zip')) {
        const { default: JSZip } = await import('jszip');
        const zip = await JSZip.loadAsync(file);
        const jsonFiles = Object.values(zip.files).filter(
          (entry) =>
            !entry.dir &&
            entry.name.toLocaleLowerCase().endsWith('.json') &&
            !entry.name.toLocaleLowerCase().includes('streaming_history_video_'),
        );
        for (const entry of jsonFiles) {
          const text = await entry.async('text');
          const parsed = this.parsePayload(text);
          if (this.containsMusicEntries(parsed)) payloads.push(parsed);
        }
      } else if (file.name.toLocaleLowerCase().endsWith('.json')) {
        const parsed = this.parsePayload(await file.text());
        if (this.containsMusicEntries(parsed)) payloads.push(parsed);
      }
    }
    return payloads;
  }

  private parsePayload(text: string): RawStreamingEntry[] {
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? (parsed as RawStreamingEntry[]) : [];
    } catch {
      return [];
    }
  }

  private containsMusicEntries(payload: readonly RawStreamingEntry[]): boolean {
    return payload.some(
      (entry) =>
        Boolean(this.stringValue(entry.master_metadata_track_name ?? entry.trackName)) &&
        Boolean(this.stringValue(entry.master_metadata_album_artist_name ?? entry.artistName)),
    );
  }

  private normalizePlay(raw: RawStreamingEntry): NormalizedPlay | null {
    const title = this.stringValue(raw.master_metadata_track_name ?? raw.trackName);
    const artist = this.stringValue(raw.master_metadata_album_artist_name ?? raw.artistName);
    const album = this.stringValue(raw.master_metadata_album_album_name ?? raw.albumName);
    const timestamp = this.stringValue(raw.ts ?? raw.endTime);
    const playedAt = this.normalizeDate(timestamp);
    const rawMs = raw.ms_played ?? raw.msPlayed;
    const msPlayed = typeof rawMs === 'number' && Number.isFinite(rawMs) ? Math.max(0, rawMs) : 0;
    const uri = this.stringValue(raw.spotify_track_uri);

    if (!title || !artist || !playedAt || msPlayed < 1_000) return null;
    const key = this.trackKey(artist, title);
    return {
      eventKey: `${playedAt}|${key}|${msPlayed}`,
      key,
      ...(uri.startsWith('spotify:track:') ? { uri } : {}),
      title,
      artist,
      album,
      playedAt,
      msPlayed,
    };
  }

  private normalizeDate(value: string): string | null {
    if (!value) return null;
    const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private trackKey(artist: string, title: string): string {
    return `${this.normalizeText(artist)}|${this.normalizeText(title)}`;
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s*\([^)]*(remaster|live|edit|version)[^)]*\)\s*/gi, ' ')
      .replace(/[^a-z0-9]+/gi, ' ')
      .trim()
      .toLocaleLowerCase();
  }

  private buildSummary(
    plays: readonly NormalizedPlay[],
    records: readonly HistoryTrackRecord[],
    sourceFileCount: number,
  ): ListeningHistorySummary {
    const artistCounts = new Map<string, number>();
    for (const record of records) {
      artistCounts.set(record.artist, (artistCounts.get(record.artist) ?? 0) + record.plays);
    }
    const sortedDates = plays.map((play) => play.playedAt).sort();
    return {
      importedAt: new Date().toISOString(),
      firstPlayedAt: sortedDates[0] ?? null,
      lastPlayedAt: sortedDates.at(-1) ?? null,
      playCount: plays.length,
      distinctTrackCount: records.length,
      totalHours:
        Math.round((plays.reduce((total, play) => total + play.msPlayed, 0) / 3_600_000) * 10) / 10,
      sourceFileCount,
      topArtists: [...artistCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 20)
        .map(([name, count]) => ({ name, plays: count })),
      topTracks: [...records]
        .sort((left, right) => right.plays - left.plays || right.msPlayed - left.msPlayed)
        .slice(0, 20)
        .map((track) => ({ title: track.title, artist: track.artist, plays: track.plays })),
    };
  }

  private readStoredSummary(): ListeningHistorySummary | null {
    try {
      const value = localStorage.getItem(SUMMARY_KEY);
      return value ? (JSON.parse(value) as ListeningHistorySummary) : null;
    } catch {
      return null;
    }
  }

  private rebuildPrototypes(records: readonly HistoryTrackRecord[]): void {
    const prototypes = buildPlaylistPrototypes(records, 200);
    this.prototypes.set(prototypes);
    localStorage.setItem(PROTOTYPES_KEY, JSON.stringify(prototypes));
  }

  private readStoredPrototypes(): readonly PlaylistPrototype[] {
    try {
      const value = localStorage.getItem(PROTOTYPES_KEY);
      return value ? (JSON.parse(value) as PlaylistPrototype[]) : [];
    } catch {
      return [];
    }
  }

  private async openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async readAllRecords(): Promise<readonly HistoryTrackRecord[]> {
    const database = await this.openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const request = database
          .transaction(STORE_NAME, 'readonly')
          .objectStore(STORE_NAME)
          .getAll();
        request.onsuccess = () => resolve(request.result as HistoryTrackRecord[]);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }

  private async replaceDatabase(records: readonly HistoryTrackRecord[]): Promise<void> {
    const database = await this.openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.clear();
        for (const record of records) store.put(record);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }
}
