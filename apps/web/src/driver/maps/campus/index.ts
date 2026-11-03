import data from './osu.json';
import type { Campus, CampusBuilding, CampusGarage } from './types.ts';

export * from './types.ts';

const OSU: Campus = {
  id: 'osu',
  name: 'The Ohio State University',
  center: { lat: 40.0005, lng: -83.0145 },
  zoom: 14.7,
  source: data.source,
  retrieved: data.retrieved,
  garages: data.garages as unknown as CampusGarage[],
  buildings: data.buildings as unknown as CampusBuilding[],
  links: { candidates: { 'tuttle-garage': 'osu-tuttle', 'lane-avenue-garage': 'osu-lane-avenue', 'ohio-union-garage': 'osu-union-north' } },
};

const CAMPUSES: Record<string, Campus> = { osu: OSU };

/** The one campus for now. VITE_CAMPUS picks another once its data file exists. */
export const activeCampus = (): Campus => CAMPUSES[import.meta.env?.VITE_CAMPUS ?? 'osu'] ?? OSU;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** A destination string from the app (short name, full name or schedule text) as a campus building. */
export function findBuilding(campus: Campus, text: string | null): CampusBuilding | null {
  if (!text) return null;
  const t = norm(text);
  return campus.buildings.find((b) => norm(b.short) === t || norm(b.name) === t)
    ?? campus.buildings.find((b) => t.includes(norm(b.short)) || t.includes(norm(b.name)) || norm(b.name).includes(t))
    ?? null;
}
