import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ClaudeCuratorService } from '../../core/claude/claude-curator.service';
import { ListeningHistoryService } from '../../core/history/listening-history.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { MixEngineService } from '../../core/mixes/mix-engine.service';
import { WorkspaceNavigationService } from '../../core/navigation/workspace-navigation.service';
import { QueuerMix, Track } from '../../core/models/music.models';
import { SpotifyIntegrationService } from '../../core/spotify/spotify-integration.service';
import { MusicShellStore } from '../../core/state/music-shell.store';
import { ArtworkComponent } from '../../shared/artwork/artwork';
import { UiIcon } from '../../shared/ui-icon/ui-icon';
import { mixArtistLine } from './mix-cover';
import { MixMosaic } from './mix-mosaic';

@Component({
  selector: 'app-home-view',
  imports: [ArtworkComponent, MixMosaic, NgTemplateOutlet, TranslatePipe, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home-view.html',
  styleUrls: [
    './home-view.scss',
    './home-library.scss',
    './home-collection.scss',
    './home-dialogs.scss',
  ],
})
export class HomeView {
  protected readonly store = inject(MusicShellStore);
  protected readonly integration = inject(SpotifyIntegrationService);
  protected readonly mixes = inject(MixEngineService);
  protected readonly history = inject(ListeningHistoryService);
  protected readonly claude = inject(ClaudeCuratorService);
  protected readonly navigation = inject(WorkspaceNavigationService);
  protected readonly i18n = inject(I18nService);

  private readonly scrollToCurrentOnOpen = effect(() => {
    this.navigation.view();
    this.store.activeCollection();
    this.mixes.selectedMix();
    window.setTimeout(() => this.jumpToCurrent('auto'), 80);
  });

  protected readonly createOpen = signal(false);
  protected readonly dataOpen = signal(false);
  protected readonly apiKeyInput = signal('');
  protected readonly mixName = signal('');
  protected readonly mixPrompt = signal('');
  protected readonly mixSeeds = signal('');
  protected readonly mixCount = signal<50 | 100>(50);

  @ViewChild('historyInput') private historyInput?: ElementRef<HTMLInputElement>;

  protected readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const period = this.i18n.t(hour < 12 ? 'Bom dia' : hour < 20 ? 'Boa tarde' : 'Boa noite');
    const name = this.store.profile()?.displayName?.split(/\s+/)[0];
    return name ? `${period}, ${name}` : period;
  });
  protected readonly today = computed(() =>
    new Intl.DateTimeFormat(this.i18n.locale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date()),
  );
  protected readonly recentTracks = computed(() => this.store.recentTracks().slice(0, 5));
  protected readonly likedCount = computed(
    () => this.store.tracks().filter((track) => track.liked).length,
  );
  protected readonly hasPlayableDailyMixes = computed(() =>
    this.mixes
      .dailyMixes()
      .every(
        (mix) =>
          mix.tracks.length === 50 && mix.tracks.every((track) => track.source === 'spotify'),
      ),
  );
  protected readonly dailyUpdatedLabel = computed(() => {
    const dates = this.mixes
      .dailyMixes()
      .filter((mix) => mix.tracks.length > 0)
      .map((mix) => new Date(mix.updatedAt))
      .filter((date) => !Number.isNaN(date.getTime()));
    if (dates.length !== 4) return this.i18n.t('Ainda não atualizadas');
    const oldest = new Date(Math.min(...dates.map((date) => date.getTime())));
    if (oldest.toDateString() === new Date().toDateString()) return this.i18n.t('Atualizadas hoje');
    const date = new Intl.DateTimeFormat(this.i18n.locale(), {
      day: 'numeric',
      month: 'short',
    }).format(oldest);
    return this.i18n.t('Seleção de {date}', { date });
  });

  protected openMix(mix: QueuerMix): void {
    this.navigation.openMix(mix);
  }

  protected playMix(mix: QueuerMix): void {
    void this.integration.playTracks(mix.tracks, mix.id);
  }

  protected play(track: Track): void {
    const selected = this.mixes.selectedMix();
    const list: readonly Track[] =
      this.navigation.view() === 'mix' && selected
        ? selected.tracks
        : this.navigation.view() === 'collection'
          ? this.store.filteredTracks()
          : this.recentTracks();
    const index = list.findIndex((item) => item.id === track.id);
    const contextId = selected?.id ?? null;
    if (index < 0) {
      void this.integration.playTrack(track, contextId);
      return;
    }
    void this.integration.playTracks([...list.slice(index), ...list.slice(0, index)], contextId);
  }

  protected openArtist(artist: string): void {
    this.navigation.openCollection(
      `artist:${encodeURIComponent(artist.split(',')[0]?.trim() ?? artist)}`,
    );
  }

  protected openAlbum(album: string): void {
    this.navigation.openCollection(`album:${encodeURIComponent(album)}`);
  }

  protected toggleSaved(track: Track): void {
    void this.integration.toggleSaved(track);
  }

  protected async syncMix(mix: QueuerMix): Promise<void> {
    try {
      const result = await this.integration.syncMixToSpotify(mix);
      this.mixes.markSynced(mix.id, result.playlistId, result.spotifyUrl);
    } catch (error: unknown) {
      this.store.showToast(
        'Não foi possível sincronizar',
        error instanceof Error ? error.message : undefined,
        'error',
      );
    }
  }

  protected chooseHistoryFiles(): void {
    this.historyInput?.nativeElement.click();
  }

  protected async importHistory(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    try {
      const summary = await this.history.importFiles(files);
      this.store.showToast(
        'Histórico importado',
        this.i18n.t('{plays} reproduções · {tracks} músicas', {
          plays: summary.playCount.toLocaleString(this.i18n.locale()),
          tracks: summary.distinctTrackCount.toLocaleString(this.i18n.locale()),
        }),
      );
      this.dataOpen.set(true);
      if (this.integration.mode() === 'spotify') await this.mixes.refreshDaily(true);
    } catch (error: unknown) {
      this.store.showToast(
        'Importação falhou',
        error instanceof Error ? error.message : undefined,
        'error',
      );
    }
  }

  protected async configureClaude(): Promise<void> {
    try {
      await this.claude.configure(this.apiKeyInput());
      this.apiKeyInput.set('');
      this.store.showToast('Claude configurado', 'A chave ficou guardada no cofre do Windows.');
      if (this.integration.mode() === 'spotify') await this.mixes.refreshDaily(true);
    } catch {}
  }

  protected async createCustomMix(): Promise<void> {
    if (!this.mixPrompt().trim()) return;
    try {
      await this.mixes.createCustomMix({
        name: this.mixName(),
        prompt: this.mixPrompt(),
        seedArtists: this.mixSeeds()
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        count: this.mixCount(),
      });
      this.createOpen.set(false);
      this.mixName.set('');
      this.mixPrompt.set('');
      this.mixSeeds.set('');
    } catch (error: unknown) {
      this.store.showToast(
        'Não foi possível criar a mix',
        error instanceof Error ? error.message : undefined,
        'error',
      );
    }
  }

  protected refreshDaily(): void {
    void this.mixes.refreshDaily(true).catch((error: unknown) => {
      this.store.showToast(
        'Não foi possível atualizar',
        error instanceof Error ? error.message : undefined,
        'error',
      );
    });
  }

  protected updateSignal(target: 'name' | 'prompt' | 'seeds' | 'key', event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    if (target === 'name') this.mixName.set(value);
    if (target === 'prompt') this.mixPrompt.set(value);
    if (target === 'seeds') this.mixSeeds.set(value);
    if (target === 'key') this.apiKeyInput.set(value);
  }

  protected formatDuration(seconds: number): string {
    if (seconds <= 0) return '—';
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }

  protected emptyHint(mix: QueuerMix): string {
    if (mix.kind === 'discovery') {
      return this.i18n.t('Ainda sem músicas de {year} que passem os filtros.', {
        year: new Date().getFullYear(),
      });
    }
    if (mix.kind === 'releases') {
      return this.i18n.t('Ainda sem lançamentos recentes dos teus artistas.');
    }
    if (mix.kind === 'rediscover' && !this.history.summary()) {
      return this.i18n.t('Importa o histórico para preencher esta mix.');
    }
    return this.i18n.t('Ainda sem músicas.');
  }

  protected jumpToCurrent(behavior: ScrollBehavior = 'smooth'): boolean {
    const row = document.querySelector('.mix-track-row--current');
    if (!row) return false;
    row.scrollIntoView({ block: 'center', behavior });
    return true;
  }

  @HostListener('document:keydown', ['$event'])
  protected handleJumpShortcut(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') {
      event.preventDefault();
      this.jumpToCurrent();
    }
  }

  protected artistLine(mix: QueuerMix, visible = 3): string {
    return mixArtistLine(mix.tracks, visible, (count) => this.i18n.t('e mais {count}', { count }));
  }

  protected isMixCurrent(mix: QueuerMix): boolean {
    const current = this.store.currentTrackId();
    return (
      this.store.playbackContextId() === mix.id && mix.tracks.some((track) => track.id === current)
    );
  }

  protected mixDuration(mix: QueuerMix): string {
    if (mix.tracks.some((track) => track.durationSeconds <= 0)) return '';
    const seconds = mix.tracks.reduce((total, track) => total + track.durationSeconds, 0);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
  }

  @HostListener('document:keydown.escape')
  protected closeDialogs(): void {
    this.createOpen.set(false);
    this.dataOpen.set(false);
  }
}
