import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { MusicShellStore } from './core/state/music-shell.store';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('creates the desktop application shell', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('labels the bundled fixtures as fictional demo data', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Queuer');
    expect(compiled.textContent).toContain('Demo mode');
  });

  it('opens the command palette with Ctrl+K', () => {
    const fixture = TestBed.createComponent(App);
    const store = TestBed.inject(MusicShellStore);
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));

    expect(store.commandOpen()).toBe(true);
  });
});
