import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
  });

  it('uses orange by default and writes the accent to the page', () => {
    const settings = new SettingsService();

    expect(settings.accentId()).toBe('orange');
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#e56b49');
  });

  it('changes and remembers the accent colour', () => {
    const settings = new SettingsService();

    settings.setAccent('blue');

    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#5b8def');
    expect(new SettingsService().accentId()).toBe('blue');
  });

  it('ignores an accent that does not exist', () => {
    const settings = new SettingsService();

    settings.setAccent('pink-glitter');

    expect(settings.accentId()).toBe('orange');
  });

  it('does not touch the startup setting outside the desktop app', async () => {
    const settings = new SettingsService();

    await settings.loadStartup();
    await settings.setStartup(true);

    expect(settings.isDesktop).toBe(false);
    expect(settings.startupEnabled()).toBeNull();
  });
});
