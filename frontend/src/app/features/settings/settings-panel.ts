import { ChangeDetectionStrategy, Component, OnInit, inject, output, signal } from '@angular/core';
import { ClaudeCuratorService } from '../../core/claude/claude-curator.service';
import { ListeningHistoryService } from '../../core/history/listening-history.service';
import { I18nService, Language } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { MixEngineService } from '../../core/mixes/mix-engine.service';
import { ACCENT_PRESETS, SettingsService } from '../../core/settings/settings.service';
import { MusicShellStore } from '../../core/state/music-shell.store';
import { UiIcon } from '../../shared/ui-icon/ui-icon';

type DangerousAction = 'history' | 'claude-key';

@Component({
  selector: 'app-settings-panel',
  imports: [TranslatePipe, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-panel.html',
  styleUrl: './settings-panel.scss',
})
export class SettingsPanel implements OnInit {
  readonly closed = output<void>();

  protected readonly i18n = inject(I18nService);
  protected readonly settings = inject(SettingsService);
  protected readonly history = inject(ListeningHistoryService);
  protected readonly claude = inject(ClaudeCuratorService);
  private readonly mixes = inject(MixEngineService);
  private readonly store = inject(MusicShellStore);

  protected readonly accents = ACCENT_PRESETS;
  protected readonly confirming = signal<DangerousAction | null>(null);

  ngOnInit(): void {
    void this.settings.loadStartup();
  }

  protected changeLanguage(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const language: Language = value === 'en' ? 'en' : 'pt';
    this.i18n.setLanguage(language);
  }

  protected toggleStartup(): void {
    const enabled = this.settings.startupEnabled();
    if (enabled === null) return;
    void this.settings.setStartup(!enabled);
  }

  protected clearCaches(): void {
    this.mixes.clearCaches();
    this.store.showToast('Caches limpas', 'As próximas mixes vão voltar a confirmar músicas.');
  }

  protected askOrRun(action: DangerousAction): void {
    if (this.confirming() !== action) {
      this.confirming.set(action);
      return;
    }
    this.confirming.set(null);
    if (action === 'history') void this.deleteHistory();
    else void this.removeClaudeKey();
  }

  private async deleteHistory(): Promise<void> {
    await this.history.clear();
    this.mixes.clearCaches();
    this.store.showToast('Histórico apagado', 'O ZIP original não foi tocado.');
  }

  private async removeClaudeKey(): Promise<void> {
    await this.claude.removeKey();
    this.store.showToast('Chave removida', 'A Queuer deixa de poder usar o Claude.');
  }
}
