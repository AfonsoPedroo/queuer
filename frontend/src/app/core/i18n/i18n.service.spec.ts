import { I18nService } from './i18n.service';
import { ENGLISH } from './english';

describe('I18nService', () => {
  beforeEach(() => localStorage.clear());

  it('starts in English', () => {
    const i18n = new I18nService();

    expect(i18n.language()).toBe('en');
    expect(i18n.t('Voltar')).toBe('Back');
  });

  it('switches to Portuguese and remembers the choice', () => {
    const i18n = new I18nService();

    i18n.setLanguage('pt');

    expect(i18n.t('Voltar')).toBe('Voltar');
    expect(i18n.locale()).toBe('pt-PT');
    expect(new I18nService().language()).toBe('pt');
  });

  it('fills placeholders and leaves unknown text alone', () => {
    const i18n = new I18nService();

    expect(i18n.t('e mais {count}', { count: 4 })).toBe('and 4 more');
    expect(i18n.t('Texto sem tradução')).toBe('Texto sem tradução');
  });

  it('has an English text for every Portuguese key', () => {
    for (const [portuguese, english] of Object.entries(ENGLISH)) {
      expect(english.trim().length, portuguese).toBeGreaterThan(0);
    }
  });
});
