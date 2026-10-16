import { Injectable, signal } from '@angular/core';
import { ENGLISH } from './english';

export type Language = 'pt' | 'en';

const STORAGE_KEY = 'queuer.language.v1';

type Values = Record<string, string | number>;

@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly language = signal<Language>(this.loadLanguage());

  setLanguage(language: Language): void {
    this.language.set(language);
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {}
  }

  locale(): string {
    return this.language() === 'en' ? 'en-GB' : 'pt-PT';
  }

  t(text: string, values: Values = {}): string {
    let result = text;
    if (this.language() === 'en') {
      result = ENGLISH[text] ?? text;
    }
    for (const [name, value] of Object.entries(values)) {
      result = result.replaceAll('{' + name + '}', String(value));
    }
    return result;
  }

  private loadLanguage(): Language {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'pt' ? 'pt' : 'en';
    } catch {
      return 'en';
    }
  }
}
