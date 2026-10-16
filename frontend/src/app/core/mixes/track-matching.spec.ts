import { baseTrackTitle, recordingIdentity, weaveByShare } from './track-helpers';

describe('track matching helpers', () => {
  it('collapses remaster, live and bracketed version suffixes to the same song', () => {
    expect(baseTrackTitle('Heroes - 2017 Remaster')).toBe('heroes');
    expect(baseTrackTitle('Heroes - Remastered 2011')).toBe('heroes');
    expect(baseTrackTitle('Heroes (Live at Wembley)')).toBe('heroes');
    expect(baseTrackTitle('Heroes [Deluxe Edition]')).toBe('heroes');
    expect(baseTrackTitle('Song - Radio Edit')).toBe('song');
  });

  it('keeps genuinely different songs apart', () => {
    expect(baseTrackTitle('Love')).not.toBe(baseTrackTitle('Love Story'));
    expect(baseTrackTitle('Time - Part 2')).toBe('time part 2');
  });

  it('identifies one recording across versions and feature credits', () => {
    expect(recordingIdentity('Alright', 'Kendrick Lamar')).toBe(
      recordingIdentity('Alright - Remastered 2020', 'Kendrick Lamar, SZA'),
    );
    expect(recordingIdentity('Alright', 'Kendrick Lamar')).not.toBe(
      recordingIdentity('Alright', 'Another Artist'),
    );
  });

  it('falls back to the plain title when stripping would leave nothing', () => {
    expect(baseTrackTitle('(Untitled)')).toBe('untitled');
  });
});

describe('weaveByShare', () => {
  const fill = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => `${prefix}${index}`);

  it('interleaves 15/15/20 in proportion and keeps the first 50 on target', () => {
    const woven = weaveByShare([fill('f', 20), fill('r', 20), fill('n', 30)], [15, 15, 20]);
    const firstFifty = woven.slice(0, 50);

    expect(firstFifty.filter((item) => item.startsWith('f'))).toHaveLength(15);
    expect(firstFifty.filter((item) => item.startsWith('r'))).toHaveLength(15);
    expect(firstFifty.filter((item) => item.startsWith('n'))).toHaveLength(20);
    expect(firstFifty.slice(0, 10).some((item) => item.startsWith('n'))).toBe(true);
    expect(firstFifty.slice(0, 10).some((item) => item.startsWith('f'))).toBe(true);
    expect(woven).toHaveLength(70);
  });

  it('backfills with reserves when a list is short and never repeats an item', () => {
    const woven = weaveByShare([fill('f', 20), fill('r', 20), fill('n', 4)], [15, 15, 20]);

    expect(woven).toHaveLength(44);
    expect(new Set(woven).size).toBe(44);
    expect(woven.slice(0, 34).filter((item) => item.startsWith('n'))).toHaveLength(4);
    expect(woven.slice(34)).toEqual([...fill('f', 20).slice(15), ...fill('r', 20).slice(15)]);
  });
});
