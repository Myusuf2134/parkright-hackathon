/**
 * Pure helpers for the presentation view. Everything here derives from what the API reports
 * (facility, live spaces, demo status, events); nothing is invented or read from simulator truth.
 */
import type { ParkingSpace } from '@parkright/contracts';
import { bayState } from '../driver/lib/parking.ts';
import { garageTitle } from '../driver/lib/names.ts';

export type Mode = 'split' | 'student' | 'ai';

export function modeFrom(search: string): Mode {
  const m = new URLSearchParams(search).get('mode');
  return m === 'student' || m === 'ai' ? m : 'split';
}

/**
 * Headline for the site: "Ohio Union North Garage-inspired" plus a separate SIMULATION mark.
 * Uses the site's own title when the API gives one, otherwise the facility name; only a trailing
 * "simulation" word and a "(N spaces)" suffix are moved out of the headline, never reworded.
 */
export function siteHeadline(siteTitle: string | null | undefined, facilityName: string | null | undefined, simulated: boolean) {
  const raw = (siteTitle || (facilityName ? garageTitle(facilityName) : '') || 'ParkRight garage').trim();
  const stripped = raw.replace(/\s+simulation$/i, '');
  return { title: stripped || raw, simulation: simulated || stripped !== raw };
}

export interface Tally { total: number; occupied: number; uncertain: number; open: number }

/** Driver-facing counts: fresh OPEN, fresh OCCUPIED, everything else can't confirm. */
export function tally(spaces: ParkingSpace[]): Tally {
  const t: Tally = { total: spaces.length, occupied: 0, uncertain: 0, open: 0 };
  for (const s of spaces) {
    const st = bayState(s);
    if (st === 'open') t.open++;
    else if (st === 'occupied') t.occupied++;
    else t.uncertain++;
  }
  return t;
}

/** Median of the recent samples, or null. Used for camera → app latency. */
export function median(samples: number[]): number | null {
  if (!samples.length) return null;
  const s = [...samples].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** "2.4 s" / "180 ms". */
export function seconds(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Camera freshness against the recommendation's 12 s rule and the facility's stale window. */
export function cameraTone(ageS: number | null | undefined, staleAfterS: number): 'fresh' | 'aging' | 'stale' | 'none' {
  if (ageS === null || ageS === undefined) return 'none';
  if (ageS <= 12) return 'fresh';
  return ageS <= staleAfterS ? 'aging' : 'stale';
}

/** "A10–A18" for a camera's owned bays (in the order the API lists them). */
export function ownedRange(owned: string[]): string {
  if (!owned.length) return 'no bays';
  return owned.length === 1 ? owned[0]! : `${owned[0]}–${owned[owned.length - 1]}`;
}

export const STATE_WORD = { OPEN: 'Open', OCCUPIED: 'Occupied', UNCERTAIN: "Can't confirm" } as const;
