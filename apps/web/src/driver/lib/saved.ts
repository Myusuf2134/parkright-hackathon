/** Favorite garages, saved places and recents. Stored on this device only, like Prefs. */
import { useCallback, useState } from 'react';

export interface Saved { favorites: string[]; places: string[]; recentGarages: string[]; recentDestinations: string[] }
export const EMPTY_SAVED: Saved = { favorites: [], places: [], recentGarages: [], recentDestinations: [] };
const KEY = 'parkright.saved.v1';
const MAX_RECENT = 5;
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function loadSaved(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>;
    return { favorites: strings(raw.favorites), places: strings(raw.places), recentGarages: strings(raw.recentGarages), recentDestinations: strings(raw.recentDestinations) };
  } catch {
    return EMPTY_SAVED;
  }
}

export const pushRecent = (list: string[], item: string) => [item, ...list.filter((x) => x !== item)].slice(0, MAX_RECENT);

export function useSaved() {
  const [saved, setSaved] = useState(loadSaved);
  const change = useCallback((fn: (s: Saved) => Saved) => {
    setSaved((s) => {
      const next = fn(s);
      if (next === s) return s;
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: keep in memory */ }
      return next;
    });
  }, []);
  return {
    saved,
    togglePlace: useCallback((name: string) => change((s) => ({ ...s, places: s.places.includes(name) ? s.places.filter((x) => x !== name) : [...s.places, name] })), [change]),
    toggleFavorite: useCallback((id: string) => change((s) => ({ ...s, favorites: s.favorites.includes(id) ? s.favorites.filter((x) => x !== id) : [...s.favorites, id] })), [change]),
    viewedGarage: useCallback((id: string) => change((s) => (s.recentGarages[0] === id ? s : { ...s, recentGarages: pushRecent(s.recentGarages, id) })), [change]),
    usedDestination: useCallback((name: string) => change((s) => (s.recentDestinations[0] === name ? s : { ...s, recentDestinations: pushRecent(s.recentDestinations, name) })), [change]),
    clearRecents: useCallback(() => change((s) => ({ ...s, recentGarages: [], recentDestinations: [] })), [change]),
  };
}
