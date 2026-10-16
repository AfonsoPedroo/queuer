import { Injectable, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';

export interface AccentPreset {
  readonly id: string;
  readonly label: string;
  readonly accent: string;
  readonly hover: string;
  readonly muted: string;
}

export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { id: 'orange', label: 'Laranja', accent: '#e56b49', hover: '#ef7b59', muted: '#b75c43' },
  { id: 'amber', label: 'Âmbar', accent: '#d9a441', hover: '#e5b457', muted: '#a98233' },
  { id: 'green', label: 'Verde', accent: '#4fae7b', hover: '#63c08d', muted: '#3f8b62' },
  { id: 'blue', label: 'Azul', accent: '#5b8def', hover: '#729fff', muted: '#4a73c2' },
  { id: 'violet', label: 'Violeta', accent: '#9b7be6', hover: '#ae92f0', muted: '#7c62b8' },
  { id: 'rose', label: 'Rosa', accent: '#d9648f', hover: '#e57aa2', muted: '#ae5073' },
];

const ACCENT_KEY = 'queuer.accent.v1';
const DEFAULT_ACCENT = 'orange';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly accentId = signal(this.loadAccent());
  readonly startupEnabled = signal<boolean | null>(null);
  readonly startupError = signal<string | null>(null);
  readonly isDesktop =
    typeof window !== 'undefined' &&
    Object.prototype.hasOwnProperty.call(window, '__TAURI_INTERNALS__');

  constructor() {
    this.applyAccent(this.accentId());
  }

  setAccent(id: string): void {
    if (!ACCENT_PRESETS.some((preset) => preset.id === id)) return;
    this.accentId.set(id);
    this.applyAccent(id);
    try {
      localStorage.setItem(ACCENT_KEY, id);
    } catch {}
  }

  async loadStartup(): Promise<void> {
    if (!this.isDesktop) return;
    try {
      this.startupEnabled.set(await invoke<boolean>('startup_is_enabled'));
      this.startupError.set(null);
    } catch (error: unknown) {
      this.startupError.set(typeof error === 'string' ? error : 'Não foi possível ler o arranque.');
    }
  }

  async setStartup(enabled: boolean): Promise<void> {
    if (!this.isDesktop) return;
    try {
      this.startupEnabled.set(await invoke<boolean>('startup_set_enabled', { enabled }));
      this.startupError.set(null);
    } catch (error: unknown) {
      this.startupError.set(
        typeof error === 'string' ? error : 'Não foi possível alterar o arranque.',
      );
    }
  }

  private loadAccent(): string {
    try {
      const saved = localStorage.getItem(ACCENT_KEY);
      if (ACCENT_PRESETS.some((preset) => preset.id === saved)) return saved as string;
    } catch {}
    return DEFAULT_ACCENT;
  }

  private applyAccent(id: string): void {
    const preset = ACCENT_PRESETS.find((item) => item.id === id) ?? ACCENT_PRESETS[0];
    if (!preset || typeof document === 'undefined') return;
    const style = document.documentElement.style;
    style.setProperty('--accent', preset.accent);
    style.setProperty('--accent-hover', preset.hover);
    style.setProperty('--accent-muted', preset.muted);
    style.setProperty('--focus-ring', `0 0 0 1px #0d0d0b, 0 0 0 3px ${preset.accent}`);
  }
}
