import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

export interface ClaudeStatus {
  readonly configured: boolean;
  readonly model: string;
}

export interface RecommendationCandidate {
  readonly title: string;
  readonly artist: string;
  readonly reason?: string | null;
}

export interface ClaudeDailyMixPlan {
  readonly name: string;
  readonly description: string;
  readonly seedArtists: readonly string[];
  readonly favoriteIds: readonly number[];
  readonly rareIds: readonly number[];
}

@Injectable({ providedIn: 'root' })
export class ClaudeCuratorService {
  readonly status = signal<ClaudeStatus>({ configured: false, model: 'claude-haiku-4-5' });
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  private readonly desktop =
    typeof window !== 'undefined' &&
    Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__');

  async initialize(): Promise<void> {
    if (!this.desktop) return;
    try {
      this.status.set(await invoke<ClaudeStatus>('claude_status'));
    } catch {
      this.error.set('Não foi possível consultar a configuração da Anthropic.');
    }
  }

  async configure(apiKey: string): Promise<void> {
    if (!this.desktop) throw new Error('A chave só pode ser guardada na aplicação desktop.');
    this.busy.set(true);
    this.error.set(null);
    try {
      this.status.set(await invoke<ClaudeStatus>('claude_configure', { apiKey }));
    } catch (error: unknown) {
      const message = typeof error === 'string' ? error : 'Não foi possível guardar a chave.';
      this.error.set(message);
      throw new Error(message);
    } finally {
      this.busy.set(false);
    }
  }

  async removeKey(): Promise<void> {
    if (!this.desktop) return;
    this.busy.set(true);
    try {
      this.status.set(await invoke<ClaudeStatus>('claude_remove_key'));
    } finally {
      this.busy.set(false);
    }
  }

  async recommend(
    prompt: string,
    seedArtists: readonly string[],
    count: number,
  ): Promise<readonly RecommendationCandidate[]> {
    if (!this.desktop) throw new Error('A curadoria Claude só está disponível na app desktop.');
    this.busy.set(true);
    this.error.set(null);
    try {
      return await invoke<RecommendationCandidate[]>('claude_recommend', {
        request: { prompt, seedArtists, count },
      });
    } catch (error: unknown) {
      const message = typeof error === 'string' ? error : 'Não foi possível criar a curadoria.';
      this.error.set(message);
      throw new Error(message);
    } finally {
      this.busy.set(false);
    }
  }

  async similarTrackIds(
    seed: { readonly title: string; readonly artist: string },
    candidates: readonly { readonly id: number; readonly title: string; readonly artist: string }[],
    count = 20,
  ): Promise<readonly number[]> {
    if (!this.desktop) return [];
    return invoke<number[]>('claude_similar_tracks', {
      request: { seedTitle: seed.title, seedArtist: seed.artist, candidates, count },
    });
  }

  async planDailyMixes(tasteProfile: string): Promise<readonly ClaudeDailyMixPlan[]> {
    if (!this.desktop) throw new Error('A curadoria Claude só está disponível na app desktop.');
    this.busy.set(true);
    this.error.set(null);
    try {
      return await invoke<ClaudeDailyMixPlan[]>('claude_plan_daily_mixes', {
        request: { tasteProfile },
      });
    } catch (error: unknown) {
      const message =
        typeof error === 'string' ? error : 'Não foi possível separar as Daily Mixes.';
      this.error.set(message);
      throw new Error(message);
    } finally {
      this.busy.set(false);
    }
  }
}
