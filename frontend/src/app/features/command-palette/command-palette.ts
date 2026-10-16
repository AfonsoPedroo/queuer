import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  computed,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Track } from '../../core/models/music.models';
import { WorkspaceNavigationService } from '../../core/navigation/workspace-navigation.service';
import { SimilarTracksService } from '../../core/similar/similar-tracks.service';
import { SpotifyIntegrationService } from '../../core/spotify/spotify-integration.service';
import { MusicShellStore } from '../../core/state/music-shell.store';
import { ArtworkComponent } from '../../shared/artwork/artwork';
import { IconName, UiIcon } from '../../shared/ui-icon/ui-icon';

interface LocalCommand {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly keywords: string;
  readonly icon: IconName;
  readonly shortcut?: string;
  readonly run: () => void;
}

@Component({
  selector: 'app-command-palette',
  imports: [ArtworkComponent, TranslatePipe, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.scss',
})
export class CommandPalette {
  readonly openAccount = output<void>();

  protected readonly store = inject(MusicShellStore);
  protected readonly integration = inject(SpotifyIntegrationService);
  private readonly navigation = inject(WorkspaceNavigationService);
  private readonly similar = inject(SimilarTracksService);
  private readonly i18n = inject(I18nService);
  protected readonly selectedIndex = signal(0);

  @ViewChild('paletteInput') private paletteInput?: ElementRef<HTMLInputElement>;

  private readonly commands: readonly LocalCommand[] = [
    {
      id: 'home',
      label: 'Abrir início',
      hint: 'Navegação',
      keywords: 'home início playlists música recente',
      icon: 'home',
      run: () => this.navigation.goHome(),
    },
    {
      id: 'liked',
      label: 'Abrir favoritas',
      hint: 'Navegação',
      keywords: 'liked favoritas guardadas',
      icon: 'plus',
      run: () => this.navigation.openCollection('liked'),
    },
    {
      id: 'playback',
      label: 'Reproduzir ou pausar',
      hint: 'Leitor',
      keywords: 'música retomar parar',
      icon: 'play',
      shortcut: 'Space',
      run: () => void this.integration.togglePlayback(),
    },
    {
      id: 'account',
      label: 'Ligação ao Spotify',
      hint: 'Definições',
      keywords: 'conta login oauth segurança client id',
      icon: 'lock',
      run: () => this.openAccount.emit(),
    },
  ];

  protected readonly visibleCommands = computed(() => {
    const query = this.store.commandQuery().trim().toLocaleLowerCase();
    if (!query) return this.commands;
    return this.commands.filter((command) =>
      `${command.label} ${this.i18n.t(command.label)} ${command.hint} ${command.keywords}`
        .toLocaleLowerCase()
        .includes(query),
    );
  });

  protected readonly visibleTracks = computed(() => {
    const query = this.store.commandQuery().trim().toLocaleLowerCase();
    if (!query) return [];
    const local = this.store
      .tracks()
      .filter((track) =>
        `${track.title} ${track.artist} ${track.album}`.toLocaleLowerCase().includes(query),
      );
    const merged = new Map(local.map((track) => [track.id, track]));
    this.integration.searchResults().forEach((track) => merged.set(track.id, track));
    return [...merged.values()].slice(0, 10);
  });

  protected readonly optionCount = computed(
    () => this.visibleCommands().length + this.visibleTracks().length,
  );

  constructor() {
    effect(() => {
      const open = this.store.commandOpen();
      if (open) queueMicrotask(() => this.paletteInput?.nativeElement.focus());
    });
    effect(() => {
      const query = this.store.commandQuery();
      this.selectedIndex.set(0);
      this.integration.searchSpotify(query);
    });
  }

  protected updateQuery(event: Event): void {
    this.store.commandQuery.set((event.target as HTMLInputElement).value);
  }

  protected handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedIndex.update((index) => Math.min(this.optionCount() - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex.update((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.executeIndex(this.selectedIndex());
    } else if (event.key === 'Escape') {
      this.store.closeCommandPalette();
    }
  }

  protected runCommand(command: LocalCommand): void {
    command.run();
    this.store.closeCommandPalette();
  }

  protected playTrack(track: Track): void {
    const results = this.visibleTracks();
    const index = results.findIndex((item) => item.id === track.id);
    if (index < 0 || results.length < 2) {
      void this.integration.playTrack(track);
    } else {
      void this.integration.playTracks([...results.slice(index), ...results.slice(0, index)]);
    }
    void this.similar
      .forTrack(track)
      .then((tracks) => this.integration.extendQueue(tracks, track.id))
      .catch(() => undefined);
    this.store.closeCommandPalette();
  }

  private executeIndex(index: number): void {
    const commands = this.visibleCommands();
    if (index < commands.length) {
      const command = commands[index];
      if (command) this.runCommand(command);
      return;
    }
    const track = this.visibleTracks()[index - commands.length];
    if (track) this.playTrack(track);
  }
}
