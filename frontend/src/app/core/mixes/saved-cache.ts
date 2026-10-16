export function readSavedCache<T>(key: string): Record<string, T> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (parsed && typeof parsed === 'object') return parsed as Record<string, T>;
    return {};
  } catch {
    return {};
  }
}

export function writeSavedCache<T extends { at: number }>(
  key: string,
  entries: Record<string, T>,
  maxEntries: number,
  isFresh: (entryKey: string, entry: T) => boolean,
): void {
  const kept = Object.entries(entries)
    .filter(([entryKey, entry]) => isFresh(entryKey, entry))
    .sort(([, first], [, second]) => second.at - first.at)
    .slice(0, maxEntries);

  try {
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(kept)));
  } catch {}
}
