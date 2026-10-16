import { Injectable } from '@angular/core';
import { ClaudeCuratorService } from '../claude/claude-curator.service';
import { ListeningHistoryService } from '../history/listening-history.service';
import { Track } from '../models/music.models';

const MEMO_LIMIT = 30;
const MIN_CANDIDATES = 10;

@Injectable({ providedIn: 'root' })
export class SimilarTracksService {
  private readonly memo = new Map<string, Promise<readonly Track[]>>();

  constructor(
    private readonly claude: ClaudeCuratorService,
    private readonly history: ListeningHistoryService,
  ) {}

  forTrack(seed: Pick<Track, 'title' | 'artist'>): Promise<readonly Track[]> {
    if (!this.claude.status().configured || !this.history.summary()) return Promise.resolve([]);
    const key = `${seed.artist}::${seed.title}`.toLocaleLowerCase();
    const existing = this.memo.get(key);
    if (existing) return existing;

    const request = this.fetch(seed).catch(() => {
      this.memo.delete(key);
      return [] as readonly Track[];
    });
    if (this.memo.size >= MEMO_LIMIT) {
      const oldest = this.memo.keys().next().value;
      if (oldest !== undefined) this.memo.delete(oldest);
    }
    this.memo.set(key, request);
    return request;
  }

  private async fetch(seed: Pick<Track, 'title' | 'artist'>): Promise<readonly Track[]> {
    const candidates = this.history.similarCandidates(seed);
    if (candidates.length < MIN_CANDIDATES) return [];
    const ids = await this.claude.similarTrackIds(seed, candidates);
    return ids
      .map((id) => this.history.similarTrackById(id))
      .filter((track): track is Track => track !== null);
  }
}
