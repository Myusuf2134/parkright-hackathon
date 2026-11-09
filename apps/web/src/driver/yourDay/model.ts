/** Provenance-aware local-only Your Day contracts. Never claim a student-entered class is university-verified. */
export interface SavedClass {
  id: string;
  course: string;
  building: string;
  /** ISO instant so day boundaries and ordering remain unambiguous. */
  startsAt: string;
}

export interface CampusForecast {
  status: 'available' | 'unavailable';
  kind: 'forecast';
  location: string;
  source: string;
  checked_at: string;
  expires_at: string | null;
  forecast_at: string | null;
  temperature_f: number | null;
  summary: string | null;
  source_url: string | null;
  reason: string | null;
}

export const DEVICE_STORE = 'meridian.your-day.classes.v1';

export function validateClasses(input: unknown): SavedClass[] {
  if (!Array.isArray(input)) return [];
  const out: SavedClass[] = [];
  for (const value of input.slice(0, 25)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Partial<Record<keyof SavedClass, unknown>>;
    if (typeof v.id !== 'string' || !v.id || v.id.length > 100) continue;
    if (typeof v.course !== 'string' || !v.course.trim() || v.course.length > 90) continue;
    if (typeof v.building !== 'string' || !v.building.trim() || v.building.length > 140) continue;
    if (typeof v.startsAt !== 'string' || !Number.isFinite(Date.parse(v.startsAt))) continue;
    out.push({ id: v.id, course: v.course.trim(), building: v.building.trim(), startsAt: new Date(v.startsAt).toISOString() });
  }
  return out;
}

export function upcoming(classes: SavedClass[], now: Date): SavedClass[] {
  return classes.filter((c) => Date.parse(c.startsAt) >= now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export function whenAt(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return date.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function isUsableForecast(
  value: CampusForecast | null,
  now = new Date(),
): value is CampusForecast & {
  status: 'available'; temperature_f: number; summary: string; forecast_at: string; source_url: string;
} {
  return !!value && value.status === 'available' && value.source === 'National Weather Service'
    && Number.isFinite(value.temperature_f) && typeof value.summary === 'string' && !!value.summary
    && typeof value.forecast_at === 'string' && Number.isFinite(Date.parse(value.forecast_at))
    && typeof value.expires_at === 'string' && Date.parse(value.expires_at) > now.getTime()
    && typeof value.source_url === 'string' && /^https:\/\/api\.weather\.gov\//.test(value.source_url);
}
