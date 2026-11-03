/** Driver preferences. Stored on this device only: there are no accounts. */
import { useCallback, useState } from 'react';
import type { MapsApp } from './directions.ts';
import type { Priority } from './directory.ts';
import type { ThemePref } from '../maps/mapStyle.ts';

export interface Prefs {
  vehicle: 'gas' | 'ev';
  accessiblePlacard: boolean;
  /** Self-reported. Never treated as verified and never unlocks a space on its own. */
  studentPermit: boolean;
  /** In-app alert while ParkRight is open. Not a push notification. */
  spaceAlerts: boolean;
  /** In-app alert when a saved garage goes from nothing usable to a confirmed-open space. */
  favoriteAlerts: boolean;
  /** How garages are ranked. Eligibility and confirmed availability are never traded away by this. */
  priority: Priority;
  mapsApp: MapsApp;
  /** Map appearance. auto follows the system. */
  mapTheme: ThemePref;
}

export const DEFAULT_PREFS: Prefs = { vehicle: 'gas', accessiblePlacard: false, studentPermit: false, spaceAlerts: true, favoriteAlerts: true, priority: 'closest', mapsApp: 'auto', mapTheme: 'auto' };

const KEY = 'parkright.prefs.v1';

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState(loadPrefs);
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: keep in memory */ }
      return next;
    });
  }, []);
  return [prefs, update];
}

/** Small persisted flags (intro seen, etc). */
export const flags = {
  get(key: string): boolean {
    try { return localStorage.getItem(`parkright.${key}`) === '1'; } catch { return false; }
  },
  set(key: string, on = true) {
    try { if (on) localStorage.setItem(`parkright.${key}`, '1'); else localStorage.removeItem(`parkright.${key}`); } catch { /* ignore */ }
  },
  session(key: string): boolean {
    try { return sessionStorage.getItem(`parkright.${key}`) === '1'; } catch { return false; }
  },
  setSession(key: string) {
    try { sessionStorage.setItem(`parkright.${key}`, '1'); } catch { /* ignore */ }
  },
};
