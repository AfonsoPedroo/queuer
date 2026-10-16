import { computed, Injectable, signal } from '@angular/core';
import { MixEngineService } from '../mixes/mix-engine.service';
import { QueuerMix } from '../models/music.models';
import { SpotifyIntegrationService } from '../spotify/spotify-integration.service';
import { MusicShellStore } from '../state/music-shell.store';

export type WorkspaceView = 'home' | 'collection' | 'mix';

interface NavigationEntry {
  readonly collectionId: string;
  readonly mixId: string | null;
}

const MAX_HISTORY_ENTRIES = 50;

@Injectable({ providedIn: 'root' })
export class WorkspaceNavigationService {
  readonly view = computed<WorkspaceView>(() => {
    if (this.mixes.selectedMix()) return 'mix';
    return this.store.activeCollection() === 'home' ? 'home' : 'collection';
  });

  private readonly entries = signal<readonly NavigationEntry[]>([
    { collectionId: 'home', mixId: null },
  ]);
  private readonly position = signal(0);

  readonly canGoBack = computed(() => this.position() > 0);
  readonly canGoForward = computed(() => this.position() < this.entries().length - 1);

  constructor(
    private readonly store: MusicShellStore,
    private readonly mixes: MixEngineService,
    private readonly integration: SpotifyIntegrationService,
  ) {}

  goHome(): void {
    this.visit({ collectionId: 'home', mixId: null });
  }

  openCollection(collectionId: string): void {
    this.visit({ collectionId, mixId: null });
  }

  openMix(mix: QueuerMix): void {
    this.record({ collectionId: this.store.activeCollection(), mixId: mix.id });
    this.mixes.openMix(mix.id);
  }

  back(): void {
    this.move(-1);
  }

  forward(): void {
    this.move(1);
  }

  private visit(entry: NavigationEntry): void {
    this.record(entry);
    this.apply(entry);
  }

  private move(step: -1 | 1): void {
    const target = this.position() + step;
    const entry = this.entries()[target];
    if (!entry) return;
    this.position.set(target);
    this.apply(entry);
  }

  private apply(entry: NavigationEntry): void {
    if (entry.mixId) {
      this.mixes.openMix(entry.mixId);
      return;
    }
    this.mixes.clearSelection();
    void this.integration.openCollection(entry.collectionId, { reuse: true });
  }

  private record(entry: NavigationEntry): void {
    const current = this.entries()[this.position()];
    if (current?.collectionId === entry.collectionId && current.mixId === entry.mixId) return;
    const kept = [...this.entries().slice(0, this.position() + 1), entry].slice(
      -MAX_HISTORY_ENTRIES,
    );
    this.entries.set(kept);
    this.position.set(kept.length - 1);
  }
}
