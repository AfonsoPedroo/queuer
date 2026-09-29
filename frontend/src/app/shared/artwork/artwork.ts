import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Artwork } from '../../core/models/music.models';

@Component({
  selector: 'app-artwork',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './artwork.html',
  styleUrl: './artwork.scss',
  host: {
    '[style.--artwork-size.px]': 'size()',
  },
})
export class ArtworkComponent {
  readonly artwork = input.required<Artwork>();
  readonly size = input(44);
  readonly rounded = input(true);

  protected readonly demoClass = computed(() => {
    const artwork = this.artwork();
    return artwork.source === 'demo' ? `artwork--${artwork.variant}` : '';
  });

  protected readonly spotifyArtwork = computed(() => {
    const artwork = this.artwork();
    return artwork.source === 'spotify' ? artwork : null;
  });

  protected readonly demoArtwork = computed(() => {
    const artwork = this.artwork();
    return artwork.source === 'demo' ? artwork : null;
  });

  protected readonly placeholderArtwork = computed(() => {
    const artwork = this.artwork();
    return artwork.source === 'placeholder' ? artwork : null;
  });
}
