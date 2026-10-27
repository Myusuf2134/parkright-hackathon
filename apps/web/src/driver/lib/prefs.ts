/** Driver preferences. Stored on this device only: there are no accounts. */
import { useCallback, useState } from 'react';

export interface Prefs {
  vehicle: 'gas' | 'ev';
  accessiblePlacard: boolean;
  /** Self-reported. Never treated as verified and never unlocks a space on its own. */
  studentPermit: boolean;
  /** In-app alert while ParkRight is open. Not a push notification. */
  spaceAlerts: boolean;
}

export const DEFAULT_PREFS: Prefs = { vehicle: 'gas', accessiblePlacard: false, studentPermit: false, spaceAlerts: true };

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
