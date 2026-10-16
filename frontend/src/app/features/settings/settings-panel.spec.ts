import { TestBed } from '@angular/core/testing';
import { I18nService } from '../../core/i18n/i18n.service';
import { SettingsService } from '../../core/settings/settings.service';
import { SettingsPanel } from './settings-panel';

describe('SettingsPanel', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [SettingsPanel] }).compileComponents();
  });

  it('shows the four groups of settings', () => {
    const fixture = TestBed.createComponent(SettingsPanel);
    fixture.detectChanges();

    const titles = [...fixture.nativeElement.querySelectorAll('h3')].map((node) =>
      (node as HTMLElement).textContent?.trim(),
    );

    expect(titles).toEqual(['General', 'Appearance', 'System', 'Data and privacy']);
  });

  it('changes the language from the select', () => {
    const fixture = TestBed.createComponent(SettingsPanel);
    fixture.detectChanges();
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;

    select.value = 'pt';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(TestBed.inject(I18nService).language()).toBe('pt');
    expect(fixture.nativeElement.querySelector('h2').textContent).toContain('Definições');
  });

  it('changes the accent colour from the swatches', () => {
    const fixture = TestBed.createComponent(SettingsPanel);
    fixture.detectChanges();
    const swatches = fixture.nativeElement.querySelectorAll('.swatch') as NodeListOf<HTMLElement>;

    swatches[3]?.click();

    expect(TestBed.inject(SettingsService).accentId()).toBe('blue');
  });

  it('keeps the startup switch disabled outside the desktop app', () => {
    const fixture = TestBed.createComponent(SettingsPanel);
    fixture.detectChanges();
    const toggle = fixture.nativeElement.querySelector('.toggle') as HTMLButtonElement;

    expect(toggle.disabled).toBe(true);
  });
});
