/**
 * How old the evidence on screen is, per space and for a group of spaces.
 *
 * Ages come from each space's own last_observed_at (server clock), corrected by the offset between
 * the client and server clocks (measured from each update's published_at). A garage summary uses the
 * *oldest* fresh view, never the newest frame from any camera, so eight cameras on a round robin can't
 * make an 18-second-old space read as "1 s". Nothing here decides availability: that stays
 * isConfirmedAvailable (fresh OPEN), and this module never widens it.
 */
import type { ParkingSpace } from '@parkright/contracts';
import { ago } from './time.ts';

/** Past this, a view is not called "Live": the recommendation only trusts evidence under 12 s. */
export const LIVE_MAX_MS = 12_000;

/** Milliseconds since the space was last observed, or null if it never was. Never negative. */
export function spaceAgeMs(space: Pick<ParkingSpace, 'last_observed_at'>, now: number, offsetMs = 0): number | null {
  if (!space.last_observed_at) return null;
  const at = Date.parse(space.last_observed_at);
  return Number.isFinite(at) ? Math.max(0, now - offsetMs - at) : null;
}

export interface Evidence {
  /** Spaces with a current (not stale) observation. */
  fresh: number;
  /** Spaces whose last observation is too old (the backend marks them stale; never offered). */
  stale: number;
  /** Spaces never observed. */
  never: number;
  newestMs: number | null;
  /** The oldest current observation: the conservative age of the group. */
  oldestMs: number | null;
}

export function summarize(spaces: ParkingSpace[], now: number, offsetMs = 0): Evidence {
  const e: Evidence = { fresh: 0, stale: 0, never: 0, newestMs: null, oldestMs: null };
  for (const s of spaces) {
    const age = spaceAgeMs(s, now, offsetMs);
    if (age === null) { e.never++; continue; }
    if (s.stale) { e.stale++; continue; }
    e.fresh++;
    e.newestMs = e.newestMs === null ? age : Math.min(e.newestMs, age);
    e.oldestMs = e.oldestMs === null ? age : Math.max(e.oldestMs, age);
  }
  return e;
}

export type Tone = 'live' | 'aging' | 'none';

/** "3 s", or "2–18 s" when the views in a group differ by a couple of seconds or more. */
export function ageRange(e: Evidence): string {
  if (e.oldestMs === null || e.newestMs === null) return '';
  const lo = Math.round(e.newestMs / 1000), hi = Math.round(e.oldestMs / 1000);
  return hi - lo < 2 || hi >= 60 ? ago(e.oldestMs) : `${lo}–${hi} s`;
}

/**
 * Garage-level label. Green only when every current view is under 12 s. Stale spaces are already
 * "can't confirm" and are counted beside the label ("3 without a recent view") by Provenance.
 */
export function groupLabel(e: Evidence): { tone: Tone; text: string } {
  if (e.fresh === 0) return { tone: 'none', text: e.stale ? 'No recent camera view' : 'Connected · no camera frames yet' };
  const old = (e.oldestMs ?? 0) > LIVE_MAX_MS;
  if (!old) return { tone: 'live', text: `Live · ${ageRange(e)}` };
  return { tone: 'aging', text: `Camera views ${ageRange(e)} old` };
}

/** One space: "Seen 3 s ago" (live), "Seen 17 s ago" (aging), or why it can't be trusted. */
export function spaceLabel(space: ParkingSpace, now: number, offsetMs = 0): { tone: Tone; text: string } {
  const age = spaceAgeMs(space, now, offsetMs);
  if (age === null) return { tone: 'none', text: 'Not seen by a camera yet' };
  if (space.stale) return { tone: 'none', text: `No recent camera view · last seen ${ago(age)} ago` };
  return { tone: age > LIVE_MAX_MS ? 'aging' : 'live', text: `Seen ${ago(age)} ago` };
}
