import { TestBed } from '@angular/core/testing';
import { ClaudeCuratorService } from '../../core/claude/claude-curator.service';
import { MixEngineService } from '../../core/mixes/mix-engine.service';
import { MusicShellStore } from '../../core/state/music-shell.store';
import { HomeView } from './home-view';

describe('HomeView mixes', () => {
  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('queuer.language.v1', 'pt');
    await TestBed.configureTestingModule({ imports: [HomeView] }).compileComponents();
  });

  it('shows featured and daily mixes and opens a mix detail', () => {
    const fixture = TestBed.createComponent(HomeView);
    const mixes = TestBed.inject(MixEngineService);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.featured-card')).toHaveLength(2);
    expect(fixture.nativeElement.querySelectorAll('.daily-card').length).toBeGreaterThanOrEqual(4);

    (fixture.nativeElement.querySelector('.featured-card') as HTMLElement).click();
    fixture.detectChanges();

    expect(mixes.selectedMix()?.name).toBe('Descoberta');
    expect(fixture.nativeElement.querySelector('.mix-detail')).toBeTruthy();
  });

  it('plays a complete mix in local mode', () => {
    const fixture = TestBed.createComponent(HomeView);
    const store = TestBed.inject(MusicShellStore);
    fixture.detectChanges();

    const playButtons = fixture.nativeElement.querySelectorAll(
      '.featured-card__meta button',
    ) as NodeListOf<HTMLButtonElement>;
    playButtons[1].click();
    fixture.detectChanges();

    expect(store.currentTrackId()).toBe('demo-03');
    expect(store.queueIds().length).toBeGreaterThan(0);
    expect(store.isPlaying()).toBe(true);
  });

  it('keeps playing the rest of a mix, then wraps around, after starting one track', () => {
    const fixture = TestBed.createComponent(HomeView);
    const mixes = TestBed.inject(MixEngineService);
    const store = TestBed.inject(MusicShellStore);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.featured-card') as HTMLElement).click();
    fixture.detectChanges();

    const mix = mixes.selectedMix();
    const ids = mix?.tracks.map((track) => track.id) ?? [];
    expect(ids.length).toBeGreaterThan(3);
    const rows = fixture.nativeElement.querySelectorAll(
      '.mix-track-row .track-title-button',
    ) as NodeListOf<HTMLButtonElement>;
    rows[2]?.click();
    fixture.detectChanges();

    expect(store.currentTrackId()).toBe(ids[2]);
    expect(store.queueIds()).toEqual([...ids.slice(3), ...ids.slice(0, 2)]);
    expect(store.playbackContextId()).toBe(mix?.id);
  });

  it('shows an honest Claude warning and configuration state on the home', () => {
    const fixture = TestBed.createComponent(HomeView);
    const mixes = TestBed.inject(MixEngineService);
    const claude = TestBed.inject(ClaudeCuratorService);
    claude.status.set({ configured: true, model: 'test' });
    mixes.error.set('A Anthropic recusou o pedido.');

    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.claude-state')?.textContent).toContain(
      'Claude configurado',
    );
    expect(fixture.nativeElement.querySelector('.mix-warning')?.textContent).toContain(
      'A Anthropic recusou o pedido.',
    );
    expect(fixture.nativeElement.querySelector('.mix-warning')?.textContent).toContain(
      'As Daily Mixes ainda não foram criadas.',
    );
  });
});
