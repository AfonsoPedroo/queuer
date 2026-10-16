import { PlaylistPrototype, PlaylistPrototypeMode } from '../models/music.models';

export interface PrototypeHistoryRecord {
  readonly title: string;
  readonly artist: string;
  readonly plays: number;
  readonly msPlayed: number;
  readonly firstPlayedAt: string;
  readonly lastPlayedAt: string;
}

const MODES: readonly PlaylistPrototypeMode[] = [
  'adjacent',
  'deep-cuts',
  'rediscover',
  'era',
  'comfort',
  'contrast',
];

const MODE_BRIEFS: Record<PlaylistPrototypeMode, string> = {
  adjacent: 'artistas próximos, com ligações naturais e poucas escolhas óbvias',
  'deep-cuts': 'faixas menos conhecidas e lados B do universo destes artistas',
  rediscover: 'reencontrar uma fase antiga sem soar a cápsula nostálgica',
  era: 'captar a fase de audição indicada e ligá-la ao gosto atual',
  comfort: 'uma seleção familiar, coesa e fácil de deixar tocar',
  contrast: 'misturar estes polos sem perder coerência musical',
};

interface ArtistProfile {
  readonly name: string;
  readonly plays: number;
  readonly msPlayed: number;
  readonly firstYear: number;
  readonly lastYear: number;
  readonly tracks: readonly PrototypeHistoryRecord[];
}

export function buildPlaylistPrototypes(
  records: readonly PrototypeHistoryRecord[],
  targetCount = 200,
): readonly PlaylistPrototype[] {
  if (records.length === 0 || targetCount <= 0) return [];

  const profiles = buildArtistProfiles(records).slice(0, 160);
  if (profiles.length === 0) return [];
  const firstYear = Math.min(...profiles.map((profile) => profile.firstYear));
  const lastYear = Math.max(...profiles.map((profile) => profile.lastYear));
  const prototypes: PlaylistPrototype[] = [];

  for (let index = 0; index < targetCount; index += 1) {
    const mode = MODES[index % MODES.length];
    const random = seededRandom(hashNumber(`${index}|${profiles.length}|${firstYear}|${lastYear}`));
    const seedCount = 3 + Math.floor(random() * 4);
    const chosen: ArtistProfile[] = [];
    const start = Math.floor(Math.pow(random(), 1.7) * profiles.length);
    let cursor = start;
    while (chosen.length < Math.min(seedCount, profiles.length)) {
      const profile = profiles[cursor % profiles.length];
      if (!chosen.includes(profile)) chosen.push(profile);
      cursor += 1 + Math.floor(random() * 17);
    }

    const focus = chosen[Math.floor(random() * chosen.length)] ?? chosen[0];
    const eraStart = Math.max(firstYear, Math.min(focus.firstYear, focus.lastYear - 1));
    const eraEnd = Math.min(lastYear, Math.max(eraStart, focus.lastYear));
    const discoveryPercent =
      mode === 'comfort' ? 15 : mode === 'deep-cuts' ? 45 : 25 + Math.floor(random() * 16);
    const seedTracks = chosen
      .flatMap((profile) => profile.tracks.slice(0, 2))
      .sort((left, right) => right.plays - left.plays || right.msPlayed - left.msPlayed)
      .slice(0, 5)
      .map((track) => ({ title: track.title, artist: track.artist }));

    prototypes.push({
      id: `recipe-${String(index + 1).padStart(3, '0')}`,
      mode,
      seedArtists: chosen.map((profile) => profile.name),
      seedTracks,
      era: eraStart === eraEnd ? String(eraStart) : `${eraStart}–${eraEnd}`,
      discoveryPercent,
      brief: MODE_BRIEFS[mode],
    });
  }
  return prototypes;
}

export function selectDailyPrototypes(
  prototypes: readonly PlaylistPrototype[],
  dayKey: string,
  count = 6,
): readonly PlaylistPrototype[] {
  if (prototypes.length <= count) return prototypes;
  const random = seededRandom(hashNumber(dayKey));
  const available = [...prototypes];
  const selected: PlaylistPrototype[] = [];
  const wantedModes = new Set<PlaylistPrototypeMode>();

  while (selected.length < count && available.length > 0) {
    const index = Math.floor(random() * available.length);
    const [candidate] = available.splice(index, 1);
    if (!candidate) continue;
    if (wantedModes.has(candidate.mode) && available.length > count - selected.length) continue;
    wantedModes.add(candidate.mode);
    selected.push(candidate);
  }
  return selected;
}

function buildArtistProfiles(records: readonly PrototypeHistoryRecord[]): readonly ArtistProfile[] {
  const grouped = new Map<string, PrototypeHistoryRecord[]>();
  for (const record of records) {
    const current = grouped.get(record.artist) ?? [];
    current.push(record);
    grouped.set(record.artist, current);
  }
  return [...grouped.entries()]
    .map(([name, tracks]) => ({
      name,
      plays: tracks.reduce((sum, track) => sum + track.plays, 0),
      msPlayed: tracks.reduce((sum, track) => sum + track.msPlayed, 0),
      firstYear: Math.min(...tracks.map((track) => new Date(track.firstPlayedAt).getUTCFullYear())),
      lastYear: Math.max(...tracks.map((track) => new Date(track.lastPlayedAt).getUTCFullYear())),
      tracks: [...tracks].sort(
        (left, right) => right.plays - left.plays || right.msPlayed - left.msPlayed,
      ),
    }))
    .sort((left, right) => right.plays - left.plays || right.msPlayed - left.msPlayed);
}

function hashNumber(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
