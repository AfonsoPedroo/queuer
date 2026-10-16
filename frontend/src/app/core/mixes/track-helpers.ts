export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLocaleLowerCase();
}

export function baseTrackTitle(title: string): string {
  let result = title.replace(/\s*[([][^)\]]*[)\]]/g, '');
  result = result.replace(
    /\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|live|mono|stereo|single version|radio edit|album version|deluxe|bonus track|acoustic|demo|version|feat\.?|ft\.?)\b.*$/i,
    '',
  );
  return normalizeText(result) || normalizeText(title);
}

export function recordingIdentity(title: string, artist: string): string {
  const firstArtist = artist.split(',')[0] ?? artist;
  return baseTrackTitle(title) + '::' + normalizeText(firstArtist);
}

export function formatWait(seconds: number): string {
  if (seconds < 90) return Math.max(1, Math.ceil(seconds)) + ' s';
  if (seconds < 5400) return Math.ceil(seconds / 60) + ' min';
  return Math.ceil(seconds / 3600) + ' h';
}

export function weaveByShare<T>(lists: readonly (readonly T[])[], shares: readonly number[]): T[] {
  const chosen: { item: T; position: number }[] = [];
  const reserves: T[] = [];

  lists.forEach((list, listIndex) => {
    const quota = Math.min(list.length, shares[listIndex] ?? 0);
    list.forEach((item, itemIndex) => {
      if (itemIndex < quota) {
        chosen.push({ item, position: (itemIndex + 0.5) / quota });
      } else {
        reserves.push(item);
      }
    });
  });

  chosen.sort((first, second) => first.position - second.position);
  return [...chosen.map((entry) => entry.item), ...reserves];
}
