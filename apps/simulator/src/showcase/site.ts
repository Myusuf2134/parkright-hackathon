/**
 * Showcase sites. The showcase engine (world, lab, CCTV rig, streamer, UI) runs any site: the
 * 34-space garage (the default and recording fallback) or the Ohio Union North Garage-inspired
 * simulation. A site is plain data plus its routes; its three.js scene is chosen in lab.ts.
 *
 *   ?showcase=1&sim=garage                      34-space garage
 *   ?showcase=1&sim=garage&site=ohio-union      Ohio Union North Garage-inspired simulation
 *   ?sim=ohio-union                             same, short form
 */
import type { CameraPose } from '../camera/pose.ts';
import { OHIO_CAMERAS, OHIO_ROWS, ohioElevation } from '../ohio/layout.ts';
import { OHIO_SCENARIO_IDS, OHIO_TRAFFIC } from '../ohio/traffic.ts';
import { SHOWCASE_CAMERAS } from './layout.ts';
import type { ShowcaseScenarioId, TrafficSite } from './schedule.ts';
import { SHOWCASE_SCENARIO_IDS, SHOWCASE_TRAFFIC } from './traffic.ts';

export type SiteId = 'showcase-34' | 'ohio-union';
export const SITE_IDS: readonly SiteId[] = ['showcase-34', 'ohio-union'];

export interface SiteCamera {
  id: string;
  label: string;
  row: string;
  /** What the camera owns, for captions ("row A", "row A · west"). */
  zone: string;
  pose: CameraPose;
}

export interface QuickView {
  pos: [number, number, number];
  target: [number, number, number];
  /** Show the ceiling (an interior, eye-level view) instead of the observer's cutaway. */
  ceiling?: boolean;
}

export interface Site extends TrafficSite {
  id: SiteId;
  title: string;
  subtitle: string;
  /** Shown wherever the site is named: what this simulation is and is not. */
  disclaimer: string | null;
  cameras: readonly SiteCamera[];
  rows: readonly string[];
  scenarioIds: readonly ShowcaseScenarioId[];
  ownerColors: Record<string, string>;
  quickViews: Record<string, QuickView>;
  /** Floor height at (x, z) for vehicles (ramps). Level everywhere when absent. */
  elevation?: (x: number, z: number) => number;
  /** A camera with no frame for longer than this reads as stale in the UI (one round-robin cycle plus margin). */
  freshS: number;
  /** Scales the lighting preset's haze distances (a larger site is seen from further away). */
  fogScale?: number;
  /** Scales the preset's ceiling-fixture intensity (a larger deck with fewer lights per square metre). */
  fixtureScale?: number;
}

export const SHOWCASE_SITE: Site = {
  ...SHOWCASE_TRAFFIC,
  id: 'showcase-34',
  title: 'ParkRight · Live garage',
  subtitle: 'Simulated 34-space garage · 4 CCTV cameras · live A2 perception',
  disclaimer: null,
  cameras: SHOWCASE_CAMERAS.map((c) => ({ id: c.id, label: c.label, row: c.row, zone: `row ${c.row}`, pose: c.pose })),
  rows: ['A', 'B', 'C', 'D'],
  scenarioIds: SHOWCASE_SCENARIO_IDS,
  ownerColors: { 'cam-01': '#28e0ff', 'cam-02': '#ffb020', 'cam-03': '#7cff6b', 'cam-04': '#ff6bd5' },
  quickViews: {
    Overview: { pos: [42, 30, 52], target: [12, 0, 19] },
    Entrance: { pos: [-16, 6, 4], target: [6, 0, 10] },
    'Row A': { pos: [13, 9, 13], target: [13, 0, 2.5] },
    'Row B': { pos: [13, 9, 4], target: [11, 0, 15.5] },
    'Row C': { pos: [13, 9, 32], target: [11, 0, 21] },
    'Row D': { pos: [13, 9, 22], target: [13, 0, 33.5] },
    'CCTV overview': { pos: [13, 48, 19.5], target: [13, 0, 19.2] },
  },
  freshS: 10,
};

export const OHIO_SITE: Site = {
  ...OHIO_TRAFFIC,
  id: 'ohio-union',
  title: 'Ohio Union North Garage-inspired simulation',
  subtitle: 'Simulated 72-space level · 8 CCTV cameras · live A2 perception',
  disclaimer: 'Inspired by a campus parking deck. Not an official or exact digital twin; no real OSU data.',
  cameras: OHIO_CAMERAS.map((c) => ({ id: c.id, label: c.label, row: c.row, zone: `row ${c.row} · ${c.module}`, pose: c.pose })),
  rows: OHIO_ROWS,
  scenarioIds: OHIO_SCENARIO_IDS,
  ownerColors: {
    'cam-01': '#28e0ff', 'cam-02': '#ffb020', 'cam-03': '#7cff6b', 'cam-04': '#ff6bd5',
    'cam-05': '#4f8bff', 'cam-06': '#ff7a45', 'cam-07': '#c6f432', 'cam-08': '#b47cff',
  },
  quickViews: {
    Overview: { pos: [12, 46, 84], target: [36, 0, 17] },
    Entrance: { pos: [-22, 5, 2], target: [6, 1, 12] },
    'Drive aisle': { pos: [2, 1.6, 9.2], target: [30, 1.2, 9.6], ceiling: true },
    'West module': { pos: [13, 14, 44], target: [13, 0, 16] },
    'East module': { pos: [46, 14, 44], target: [46, 0, 16] },
    Spine: { pos: [29.7, 1.7, 3], target: [29.7, 1.0, 30], ceiling: true },
    Ramp: { pos: [57, 4, 6], target: [69, 1.5, 26] },
    'CCTV overview': { pos: [34, 76, 19.5], target: [34, 0, 19.2] },
  },
  elevation: ohioElevation,
  freshS: 25,
  fogScale: 2,
  fixtureScale: 1.6,
};

export const SITES: Record<SiteId, Site> = { 'showcase-34': SHOWCASE_SITE, 'ohio-union': OHIO_SITE };

/** ?site=ohio-union (or ?sim=ohio-union) → the Ohio Union-inspired site; anything else → 34-space. */
export function parseSite(params: URLSearchParams): Site {
  return params.get('site') === 'ohio-union' || params.get('sim') === 'ohio-union' ? OHIO_SITE : SHOWCASE_SITE;
}
