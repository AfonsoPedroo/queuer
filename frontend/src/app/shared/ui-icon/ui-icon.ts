import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'check'
  | 'chevron-down'
  | 'close'
  | 'command'
  | 'copy'
  | 'device'
  | 'external'
  | 'heart'
  | 'history'
  | 'home'
  | 'lock'
  | 'music'
  | 'next'
  | 'pause'
  | 'play'
  | 'plus'
  | 'previous'
  | 'repeat'
  | 'repeat-one'
  | 'search'
  | 'shuffle'
  | 'volume'
  | 'volume-off'
  | 'warning';

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-icon.html',
  styleUrl: './ui-icon.scss',
})
export class UiIcon {
  readonly name = input.required<IconName>();
  readonly size = input(18);
  readonly strokeWidth = input(1.8);
}
