import type { LatLng } from '../campus/types.ts';

const M_PER_DEG = 111_320;

/** Metres between two points. Equirectangular: accurate at campus and city scale. */
export function metres(a: LatLng, b: LatLng): number {
  const k = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return Math.hypot((a.lat - b.lat) * M_PER_DEG, (a.lng - b.lng) * M_PER_DEG * k);
}

export const toLatLng = ([lng, lat]: [number, number]): LatLng => ({ lat, lng });

/** Closest point on segment a→b: its position, its fraction along, and the distance to p. */
export function projectOnSegment(p: LatLng, a: LatLng, b: LatLng): { point: LatLng; t: number; distance: number } {
  const k = Math.cos(p.lat * Math.PI / 180);
  const ax = (a.lng - p.lng) * k, ay = a.lat - p.lat, bx = (b.lng - p.lng) * k, by = b.lat - p.lat;
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len));
  const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  return { point, t, distance: metres(p, point) };
}

export function bearing(a: LatLng, b: LatLng): number {
  const k = Math.cos(a.lat * Math.PI / 180);
  return (Math.atan2((b.lng - a.lng) * k, b.lat - a.lat) * 180 / Math.PI + 360) % 360;
}

export function formatDistance(m: number): string {
  const miles = m / 1609.344;
  if (miles < 0.1) { const ft = m * 3.28084; return `${Math.max(10, Math.round(ft / 10) * 10)} ft`; }
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

export const clockAt = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
