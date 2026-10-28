/**
 * Display names. Facility names may carry their size ("… (72 spaces)"), which the garage header
 * already shows beside the level, so it is dropped there to keep the title whole. Nothing is renamed.
 */
export function garageTitle(name: string): string {
  return name.replace(/\s*\(\d+\s+spaces?\)\s*$/i, '').trim() || name;
}

export type DetectorKind = 'a2' | 'scripted' | 'none' | 'other' | 'unknown';

/** What produced the space states, from the provider the API reports. */
export function detectorKind(provider: string | null | undefined): DetectorKind {
  if (!provider) return 'unknown';
  if (provider.startsWith('a2')) return 'a2';
  if (provider.startsWith('scripted')) return 'scripted';
  if (provider === 'none') return 'none';
  return 'other';
}

export const DETECTOR_LABEL: Record<DetectorKind, string> = {
  a2: 'NVIDIA A2 detector',
  scripted: 'Scripted test source, not a detector',
  none: 'No detector connected',
  other: 'Detector',
  unknown: 'Detector status unknown',
};

/**
 * Headline for a site: "Ohio Union North Garage-inspired" plus a separate SIMULATION mark. Uses the
 * site's own title when the API gives one, otherwise the facility name; only a trailing "simulation"
 * word and a "(N spaces)" suffix move out of the headline, never reworded.
 */
export function siteHeadline(siteTitle: string | null | undefined, facilityName: string | null | undefined, simulated: boolean) {
  const raw = (siteTitle || (facilityName ? garageTitle(facilityName) : '') || 'ParkRight garage').trim();
  const stripped = raw.replace(/\s+simulation$/i, '');
  return { title: stripped || raw, simulation: simulated || stripped !== raw };
}
