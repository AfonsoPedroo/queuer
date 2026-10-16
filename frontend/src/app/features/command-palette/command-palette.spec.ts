import { TestBed } from '@angular/core/testing';
import { MusicShellStore } from '../../core/state/music-shell.store';
import { CommandPalette } from './command-palette';

describe('CommandPalette playback', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [CommandPalette] }).compileComponents();
  });

  it('plays the chosen result and then the other results of the search', () => {
    const fixture = TestBed.createComponent(CommandPalette);
    const store = TestBed.inject(MusicShellStore);
    store.openCommandPalette();
    store.commandQuery.set('e');
    fixture.detectChanges();

    const options = fixture.nativeElement.querySelectorAll(
      'button[role="option"]',
    ) as NodeListOf<HTMLElement>;
    const rows = [...options].filter((option) => option.querySelector('app-artwork'));
    expect(rows.length).toBeGreaterThan(2);

    rows[1]?.click();
    fixture.detectChanges();

    expect(store.isPlaying()).toBe(true);
    expect(store.queueIds().length).toBe(rows.length - 1);
    expect(store.queueIds()).not.toContain(store.currentTrackId());
  });
});
