import { computed, Injectable, signal } from '@angular/core';
import {
  DEMO_PLAYLISTS,
  DEMO_QUEUE_IDS,
  DEMO_RECENT_TRACK_IDS,
  DEMO_TRACKS,
} from '../data/demo-library';
import {
  PlaybackDevice,
  Playlist,
  RepeatMode,
  SpotifyWorkspaceSnapshot,
  ToastMessage,
  Track,
  UserProfile,
} from '../models/music.models';

@Injectable({ providedIn: 'root' })
export class MusicShellStore {
  private readonly tracksState = signal<readonly Track[]>(DEMO_TRACKS);
  private readonly playlistsState = signal<readonly Playlist[]>(DEMO_PLAYLISTS);
  private readonly queueIdsState = signal<readonly string[]>(DEMO_QUEUE_IDS);
  private readonly recentTrackIdsState = signal<readonly string[]>(DEMO_RECENT_TRACK_IDS);
  private readonly historyIdsState = signal<readonly string[]>([]);
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private previousVolume = 72;

  readonly query = signal('');
  readonly activeCollection = signal('home');
  readonly currentTrackId = signal(DEMO_TRACKS[0].id);
  readonly sourceMode = signal<'demo' | 'spotify'>('demo');
  readonly profile = signal<UserProfile | null>(null);
  readonly devices = signal<readonly PlaybackDevice[]>([]);
  readonly isPlaying = signal(false);
  readonly progressSeconds = signal(74);
  readonly volume = signal(72);
  readonly shuffleEnabled = signal(false);
  readonly repeatMode = signal<RepeatMode>('off');
  readonly commandOpen = signal(false);
  readonly commandQuery = signal('');
  readonly focusSearchRequest = signal(0);
  readonly toast = signal<ToastMessage | null>(null);

  readonly tracks = this.tracksState.asReadonly();
  readonly playlists = this.playlistsState.asReadonly();
  readonly queueIds = this.queueIdsState.asReadonly();

  readonly trackMap = computed(() => new Map(this.tracks().map((track) => [track.id, track])));
  readonly currentTrack = computed<Track | null>(
    () => this.trackMap().get(this.currentTrackId()) ?? null,
  );
  readonly queueTracks = computed(() =>
    this.queueIds()
      .map((id) => this.trackMap().get(id))
      .filter((track): track is Track => track !== undefined),
  );

  readonly collectionTitle = computed(() => {
    const collection = this.activeCollection();
    if (collection === 'home') return 'Home';
    if (collection === 'liked') return 'Liked Songs';
    if (collection === 'recent') return 'Recently Played';
    return this.playlists().find((playlist) => playlist.id === collection)?.name ?? 'Playlist';
  });

  readonly collectionDescription = computed(() => {
    const collection = this.activeCollection();
    if (collection === 'liked') return 'The tracks you marked with Spotify’s save action.';
    if (collection === 'recent') {
      return this.sourceMode() === 'demo'
        ? 'Demo listening history.'
        : 'Recently loaded listening activity from your Spotify account.';
    }
    return (
      this.playlists().find((playlist) => playlist.id === collection)?.description ??
      'Tracks from this playlist.'
    );
  });

  readonly filteredTracks = computed(() => {
    const searchTerm = this.query().trim().toLocaleLowerCase();
    const activeCollection = this.activeCollection();
    const recentTrackOrder = new Map(
      this.recentTrackIdsState().map((trackId, index) => [trackId, index]),
    );

    const visibleTracks = this.tracks().filter((track) => {
      const matchesCollection =
        activeCollection === 'home' ||
        (activeCollection === 'recent' && recentTrackOrder.has(track.id)) ||
        (activeCollection === 'liked' && track.liked) ||
        track.playlistIds.includes(activeCollection);
      const searchable =
        `${track.title} ${track.artist} ${track.album} ${track.tags.join(' ')}`.toLocaleLowerCase();
      return matchesCollection && (!searchTerm || searchable.includes(searchTerm));
    });

    return [...visibleTracks].sort((left, right) => {
      if (activeCollection === 'recent') {
        return (recentTrackOrder.get(left.id) ?? 0) - (recentTrackOrder.get(right.id) ?? 0);
      }
      return new Date(right.addedAt).getTime() - new Date(left.addedAt).getTime();
    });
  });
  readonly currentProgressPercent = computed(() => {
    const duration = this.currentTrack()?.durationSeconds ?? 0;
    return duration === 0 ? 0 : Math.min(100, (this.progressSeconds() / duration) * 100);
  });

  readonly activeDevice = computed(() => this.devices().find((device) => device.isActive) ?? null);

  replaceWithSpotify(snapshot: SpotifyWorkspaceSnapshot): void {
    const mergedTracks = new Map<string, Track>();
    for (const track of snapshot.tracks) mergedTracks.set(track.id, track);
    for (const track of snapshot.queue) mergedTracks.set(track.id, track);
    if (snapshot.currentTrack) mergedTracks.set(snapshot.currentTrack.id, snapshot.currentTrack);

    this.sourceMode.set('spotify');
    this.profile.set(snapshot.profile);
    this.tracksState.set([...mergedTracks.values()]);
    this.recentTrackIdsState.set(snapshot.recentTrackIds);
    this.playlistsState.set(snapshot.playlists);
    this.queueIdsState.set(snapshot.queue.map((track) => track.id));
    this.devices.set(snapshot.devices);
    this.currentTrackId.set(snapshot.currentTrack?.id ?? '');
    this.isPlaying.set(snapshot.isPlaying);
    this.progressSeconds.set(snapshot.progressSeconds);
    this.volume.set(snapshot.volume ?? 72);
    this.shuffleEnabled.set(snapshot.shuffleEnabled);
    this.repeatMode.set(snapshot.repeatMode);
    this.activeCollection.set('home');
  }

  restoreDemo(): void {
    this.sourceMode.set('demo');
    this.profile.set(null);
    this.devices.set([]);
    this.tracksState.set(DEMO_TRACKS);
    this.playlistsState.set(DEMO_PLAYLISTS);
    this.queueIdsState.set(DEMO_QUEUE_IDS);
    this.recentTrackIdsState.set(DEMO_RECENT_TRACK_IDS);
    this.currentTrackId.set(DEMO_TRACKS[0].id);
    this.isPlaying.set(false);
    this.progressSeconds.set(74);
    this.volume.set(72);
    this.shuffleEnabled.set(false);
    this.repeatMode.set('off');
    this.activeCollection.set('home');
  }

  updateRemotePlayback(update: {
    readonly currentTrack?: Track | null;
    readonly isPlaying?: boolean;
    readonly progressSeconds?: number;
    readonly volume?: number | null;
    readonly shuffleEnabled?: boolean;
    readonly repeatMode?: RepeatMode;
    readonly devices?: readonly PlaybackDevice[];
    readonly queue?: readonly Track[];
  }): void {
    if (update.currentTrack !== undefined) {
      const currentTrack = update.currentTrack;
      if (currentTrack) {
        this.tracksState.update((tracks) =>
          tracks.some((track) => track.id === currentTrack.id)
            ? tracks.map((track) => (track.id === currentTrack.id ? currentTrack : track))
            : [currentTrack, ...tracks],
        );
        this.currentTrackId.set(currentTrack.id);
      } else {
        this.currentTrackId.set('');
      }
    }
    if (update.isPlaying !== undefined) this.isPlaying.set(update.isPlaying);
    if (update.progressSeconds !== undefined) this.progressSeconds.set(update.progressSeconds);
    if (update.volume !== undefined && update.volume !== null) this.volume.set(update.volume);
    if (update.shuffleEnabled !== undefined) this.shuffleEnabled.set(update.shuffleEnabled);
    if (update.repeatMode !== undefined) this.repeatMode.set(update.repeatMode);
    if (update.devices !== undefined) this.devices.set(update.devices);
    if (update.queue !== undefined) {
      this.tracksState.update((tracks) => {
        const merged = new Map(tracks.map((track) => [track.id, track]));
        update.queue?.forEach((track) => merged.set(track.id, track));
        return [...merged.values()];
      });
      this.queueIdsState.set(update.queue.map((track) => track.id));
    }
  }

  advanceProgress(): void {
    const current = this.currentTrack();
    if (!current || !this.isPlaying()) return;
    if (this.progressSeconds() + 1 >= current.durationSeconds) {
      if (this.sourceMode() === 'demo') this.playNext();
      return;
    }
    this.progressSeconds.update((value) => value + 1);
  }

  setCollection(collectionId: string): void {
    this.activeCollection.set(collectionId);
    this.query.set('');
  }

  playTrack(trackId: string): void {
    const currentId = this.currentTrackId();
    if (currentId !== trackId) {
      this.historyIdsState.update((history) => [currentId, ...history].slice(0, 20));
      this.currentTrackId.set(trackId);
      this.progressSeconds.set(0);
    }
    this.isPlaying.set(true);
  }

  togglePlayback(): void {
    this.isPlaying.update((playing) => !playing);
  }

  playNext(): void {
    const [nextId, ...remainingIds] = this.queueIds();
    if (!nextId) {
      this.showToast('Queue finished', 'Add another track to keep listening.');
      return;
    }
    this.queueIdsState.set(remainingIds);
    this.playTrack(nextId);
  }

  playPrevious(): void {
    if (this.progressSeconds() > 4) {
      this.progressSeconds.set(0);
      return;
    }
    const [previousId, ...remainingHistory] = this.historyIdsState();
    if (!previousId) {
      this.progressSeconds.set(0);
      return;
    }
    this.queueIdsState.update((queue) => [this.currentTrackId(), ...queue]);
    this.historyIdsState.set(remainingHistory);
    this.currentTrackId.set(previousId);
    this.progressSeconds.set(0);
    this.isPlaying.set(true);
  }

  setProgressPercent(percent: number): void {
    const safePercent = Math.min(100, Math.max(0, percent));
    const duration = this.currentTrack()?.durationSeconds ?? 0;
    this.progressSeconds.set(Math.round((safePercent / 100) * duration));
  }

  setVolume(value: number): void {
    const safeVolume = Math.min(100, Math.max(0, Math.round(value)));
    if (safeVolume > 0) this.previousVolume = safeVolume;
    this.volume.set(safeVolume);
  }

  toggleMute(): void {
    if (this.volume() === 0) this.volume.set(this.previousVolume || 60);
    else {
      this.previousVolume = this.volume();
      this.volume.set(0);
    }
  }

  toggleShuffle(): void {
    this.shuffleEnabled.update((enabled) => !enabled);
  }

  cycleRepeat(): void {
    const nextMode: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };
    this.repeatMode.update((mode) => nextMode[mode]);
  }

  toggleLiked(trackId: string): void {
    let nowLiked = false;
    this.tracksState.update((tracks) =>
      tracks.map((track) => {
        if (track.id !== trackId) return track;
        nowLiked = !track.liked;
        return { ...track, liked: nowLiked };
      }),
    );
    this.showToast(nowLiked ? 'Added to Liked Songs' : 'Removed from Liked Songs');
  }

  setTrackLiked(trackId: string, liked: boolean): void {
    this.tracksState.update((tracks) =>
      tracks.map((track) => (track.id === trackId ? { ...track, liked } : track)),
    );
  }

  mergeSpotifyCollection(collectionId: string, collectionTracks: readonly Track[]): void {
    this.tracksState.update((tracks) => {
      const merged = new Map(tracks.map((track) => [track.id, track]));
      for (const track of collectionTracks) {
        const existing = merged.get(track.id);
        merged.set(track.id, {
          ...existing,
          ...track,
          liked: existing?.liked ?? track.liked,
          playlistIds: [...new Set([...(existing?.playlistIds ?? []), collectionId])],
        });
      }
      return [...merged.values()];
    });
    this.setCollection(collectionId);
  }

  addTrackNext(trackId: string): void {
    this.queueIdsState.update((queue) => [trackId, ...queue.filter((id) => id !== trackId)]);
    this.showToast('Playing next', this.trackMap().get(trackId)?.title);
  }

  showSpotifyUnavailable(): void {
    this.showToast('Spotify is not connected', 'This demo never opens fictional Spotify links.');
  }

  openCommandPalette(): void {
    this.commandQuery.set('');
    this.commandOpen.set(true);
  }

  closeCommandPalette(): void {
    this.commandOpen.set(false);
    this.commandQuery.set('');
  }

  requestSearchFocus(): void {
    this.closeCommandPalette();
    this.focusSearchRequest.update((request) => request + 1);
  }

  closeOverlays(): void {
    this.closeCommandPalette();
  }

  showToast(title: string, detail?: string, tone: 'neutral' | 'error' = 'neutral'): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    const message: ToastMessage = { id: Date.now(), title, tone, ...(detail ? { detail } : {}) };
    this.toast.set(message);
    this.toastTimer = setTimeout(() => this.toast.set(null), tone === 'error' ? 8_000 : 3_200);
  }

  dismissToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast.set(null);
  }
}
