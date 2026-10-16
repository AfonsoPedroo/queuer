import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { MusicShellStore } from './core/state/music-shell.store';

describe('App', () => {
  beforeEach(async () => {
    localStorage.setItem('queuer.language.v1', 'pt');
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('creates the desktop application shell', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows the local demo shell before Spotify is connected', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Queuer');
    expect(compiled.textContent).toContain('Modo local');
    expect(compiled.textContent).toContain('Descoberta');
  });

  it('opens the command palette with Ctrl+K', () => {
    const fixture = TestBed.createComponent(App);
    const store = TestBed.inject(MusicShellStore);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));

    expect(store.commandOpen()).toBe(true);
  });

  it('returns from a mix to Home and opens History from the top navigation', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('.featured-card') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.mix-detail')).toBeTruthy();

    const navigation = fixture.nativeElement.querySelectorAll(
      '.primary-modes__item',
    ) as NodeListOf<HTMLButtonElement>;
    navigation[0].click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.mix-detail')).toBeFalsy();
    expect(fixture.nativeElement.querySelector('.page-header')).toBeTruthy();

    navigation[1].click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.collection-view')).toBeTruthy();
  });
});
