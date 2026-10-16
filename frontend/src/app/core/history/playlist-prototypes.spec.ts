import { buildPlaylistPrototypes, selectDailyPrototypes } from './playlist-prototypes';

describe('playlist prototypes', () => {
  const records = Array.from({ length: 24 }, (_, index) => ({
    title: `Track ${index}`,
    artist: `Artist ${index % 8}`,
    plays: 30 - index,
    msPlayed: (30 - index) * 180_000,
    firstPlayedAt: `${2018 + (index % 5)}-01-01T00:00:00.000Z`,
    lastPlayedAt: `${2022 + (index % 4)}-06-01T00:00:00.000Z`,
  }));

  it('builds exactly 200 deterministic private recipes', () => {
    const first = buildPlaylistPrototypes(records, 200);
    const second = buildPlaylistPrototypes(records, 200);
    expect(first).toHaveLength(200);
    expect(second).toEqual(first);
    expect(new Set(first.map((recipe) => recipe.id)).size).toBe(200);
    expect(first.every((recipe) => recipe.seedArtists.length >= 3)).toBe(true);
  });

  it('rotates a stable, varied daily subset', () => {
    const recipes = buildPlaylistPrototypes(records, 200);
    const today = selectDailyPrototypes(recipes, '2026-10-07', 6);
    const tomorrow = selectDailyPrototypes(recipes, '2026-10-08', 6);
    expect(today).toHaveLength(6);
    expect(new Set(today.map((recipe) => recipe.mode)).size).toBe(6);
    expect(tomorrow.map((recipe) => recipe.id)).not.toEqual(today.map((recipe) => recipe.id));
  });
});
