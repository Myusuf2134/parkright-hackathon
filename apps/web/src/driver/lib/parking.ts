/**
 * What a driver may be offered. The only availability predicate is the contract's
 * isConfirmedAvailable (fresh OPEN); eligibility can only narrow it, never widen it.
 */
import type { Level, ParkingSpace, SpaceDesignation } from '@parkright/contracts';
import { isConfirmedAvailable } from '@parkright/contracts';
import type { Prefs } from './prefs.ts';

export type BayState = 'open' | 'occupied' | 'uncertain';

export function bayState(space: ParkingSpace): BayState {
  if (isConfirmedAvailable(space)) return 'open';
  if (space.current_state === 'OCCUPIED' && !space.stale) return 'occupied';
  return 'uncertain';
}

export interface Eligibility { ok: boolean; reason: string | null }

export function eligibility(designation: SpaceDesignation, prefs: Prefs): Eligibility {
  switch (designation) {
    case 'standard':
      return { ok: true, reason: null };
    case 'accessible':
      return prefs.accessiblePlacard ? { ok: true, reason: null } : { ok: false, reason: 'Accessible space. Turn on "Accessible placard" in You if you have one.' };
    case 'ev':
      return prefs.vehicle === 'ev' ? { ok: true, reason: null } : { ok: false, reason: 'EV charging space. Only offered when your car is set to electric.' };
    case 'reserved':
      return { ok: false, reason: 'Reserved space. ParkRight never offers reserved spaces.' };
    default:
      return { ok: false, reason: 'Unknown space type.' };
  }
}

/** A space ParkRight may offer this driver: confirmed open right now and legal for them. */
export function offerable(space: ParkingSpace, prefs: Prefs): boolean {
  return isConfirmedAvailable(space) && eligibility(space.designation, prefs).ok;
}

export interface Counts { total: number; open: number; forYou: number; occupied: number; uncertain: number }

export function countSpaces(spaces: ParkingSpace[], prefs: Prefs): Counts {
  const c: Counts = { total: spaces.length, open: 0, forYou: 0, occupied: 0, uncertain: 0 };
  for (const s of spaces) {
    const st = bayState(s);
    if (st === 'open') c.open++;
    else if (st === 'occupied') c.occupied++;
    else c.uncertain++;
    if (offerable(s, prefs)) c.forYou++;
  }
  return c;
}

/** Reading order: level, then row (top to bottom), then left to right. */
export function readingOrder(spaces: ParkingSpace[], levels: Level[] = []): ParkingSpace[] {
  const ord = new Map(levels.map((l) => [l.level_id, l.ordinal]));
  return [...spaces].sort((a, b) =>
    (ord.get(a.level_id) ?? 0) - (ord.get(b.level_id) ?? 0) || a.plan.y - b.plan.y || a.plan.x - b.plan.x || a.space_id.localeCompare(b.space_id),
  );
}

/** The space to preselect: the first offerable one in reading order, or null. */
export function suggestSpace(spaces: ParkingSpace[], prefs: Prefs, levels: Level[] = []): ParkingSpace | null {
  return readingOrder(spaces, levels).find((s) => offerable(s, prefs)) ?? null;
}

const ORDINAL = ['1st', '2nd', '3rd'];
const ordinal = (n: number) => ORDINAL[n - 1] ?? `${n}th`;

/** "Row A · 4th from the left", derived only from the space geometry. */
export function describeSpace(space: ParkingSpace, spaces: ParkingSpace[]): string {
  const row = spaces
    .filter((s) => s.level_id === space.level_id && Math.abs(s.plan.y - space.plan.y) < 0.02)
    .sort((a, b) => a.plan.x - b.plan.x);
  const index = row.findIndex((s) => s.space_id === space.space_id) + 1;
  const letter = /^[A-Za-z]+/.exec(space.space_id)?.[0];
  return `${letter ? `Row ${letter.toUpperCase()} · ` : ''}${ordinal(index)} from the left`;
}

/** Bays drawn over a facility's level plan, sized so every bay stays tappable (≥ minBay px wide). */
export interface PlanLayout { width: number; height: number; bays: { space: ParkingSpace; x: number; y: number; w: number; h: number }[]; aisles: { y: number; h: number }[] }

export function layoutPlan(spaces: ParkingSpace[], containerWidth: number, minBay = 44, bayAspect = 0.58): PlanLayout {
  if (!spaces.length) return { width: containerWidth, height: 0, bays: [], aisles: [] };
  const minW = Math.min(...spaces.map((s) => s.plan.w));
  const minX = Math.min(...spaces.map((s) => s.plan.x));
  const maxX = Math.max(...spaces.map((s) => s.plan.x + s.plan.w));
  const span = maxX - minX || 1;
  // Width so the narrowest bay is at least minBay px; never narrower than the container.
  const scaleX = Math.max(containerWidth / span, minBay / minW);
  const width = span * scaleX;
  const bayW = (w: number) => w * scaleX;
  const typicalH = spaces[0].plan.h;
  const scaleY = (bayW(minW) / bayAspect) / typicalH;
  const minY = Math.min(...spaces.map((s) => s.plan.y));
  const bays = spaces.map((space) => ({
    space,
    x: (space.plan.x - minX) * scaleX,
    y: (space.plan.y - minY) * scaleY,
    w: space.plan.w * scaleX,
    h: space.plan.h * scaleY,
  }));
  const height = Math.max(...bays.map((b) => b.y + b.h));
  // Drive aisles: vertical gaps between rows that are wider than half a bay.
  const rows = [...new Set(bays.map((b) => Math.round(b.y)))].sort((a, b) => a - b);
  const aisles: PlanLayout['aisles'] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const bottom = Math.max(...bays.filter((b) => Math.round(b.y) === rows[i]).map((b) => b.y + b.h));
    const gap = rows[i + 1] - bottom;
    if (gap > bayW(minW) * 0.5) aisles.push({ y: bottom + gap * 0.18, h: gap * 0.64 });
  }
  return { width, height, bays, aisles };
}
