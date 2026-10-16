import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { QueuerMix } from '../../core/models/music.models';
import { MusicShellStore } from '../../core/state/music-shell.store';
import { mixMosaic } from './mix-cover';

@Component({
  selector: 'app-mix-mosaic',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.width.px]': 'size()', '[class.mix-mosaic--now]': 'playing()' },
  template: `
    <span class="mix-mosaic__grid" aria-hidden="true">
      @for (tile of tiles(); track $index) {
        <i
          [style.background-color]="tile.tone"
          [style.background-image]="tile.url ? 'url(&quot;' + tile.url + '&quot;)' : null"
        ></i>
      }
    </span>
    @if (playing()) {
      <span class="now-bars now-bars--cover" [class.now-bars--paused]="!store.isPlaying()"
        ><b></b><b></b><b></b
      ></span>
    }
  `,
  styles: `
    :host {
      aspect-ratio: 1;
      border-radius: 6px;
      display: block;
      max-width: 100%;
      overflow: hidden;
      position: relative;
      width: 100%;
    }
    .mix-mosaic__grid {
      display: grid;
      grid-template: 1fr 1fr / 1fr 1fr;
      height: 100%;
      width: 100%;
    }
    .mix-mosaic__grid i {
      background-position: center;
      background-size: cover;
      display: block;
    }
    :host(.mix-mosaic--now)::after {
      background: rgb(18 18 16 / 48%);
      content: '';
      inset: 0;
      position: absolute;
    }
    .now-bars--cover {
      align-items: flex-end;
      display: flex;
      gap: 3px;
      height: 18px;
      left: 50%;
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      z-index: 2;
    }
    .now-bars--cover b {
      animation: cover-bars 0.9s ease-in-out infinite;
      background: var(--accent);
      border-radius: 1px;
      display: block;
      height: 100%;
      transform-origin: bottom;
      width: 4px;
    }
    .now-bars--cover b:nth-child(2) {
      animation-delay: -0.3s;
    }
    .now-bars--cover b:nth-child(3) {
      animation-delay: -0.6s;
    }
    .now-bars--paused b {
      animation-play-state: paused;
      transform: scaleY(0.35);
    }
    @keyframes cover-bars {
      0%,
      100% {
        transform: scaleY(0.25);
      }
      50% {
        transform: scaleY(1);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .now-bars--cover b {
        animation: none;
        transform: scaleY(0.6);
      }
    }
  `,
})
export class MixMosaic {
  readonly mix = input.required<QueuerMix>();
  readonly size = input<number | null>(null);

  protected readonly store = inject(MusicShellStore);
  protected readonly tiles = computed(() => mixMosaic(this.mix().id, this.mix().tracks));
  protected readonly playing = computed(() => {
    const current = this.store.currentTrackId();
    const mix = this.mix();
    return (
      this.store.playbackContextId() === mix.id && mix.tracks.some((track) => track.id === current)
    );
  });
}
