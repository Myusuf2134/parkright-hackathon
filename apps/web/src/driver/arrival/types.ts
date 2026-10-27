/**
 * Arrival Intelligence types. These are the integration boundary: a real schedule, announcement,
 * weather, traffic or roadwork feed would produce the same shapes. Today only parking can be live;
 * everything else comes from typed demo scenarios and says so.
 */

/** Where a value came from. Shown next to every estimate and alert. */
export type Source = 'live' | 'simulated' | 'demo' | 'estimated' | 'unavailable';

export interface ClassSession {
  course: string;
  /** Clock time, e.g. "10:20 AM". */
  startsAt: string;
  building: string;
  buildingShort: string;
  source: Source;
}

/** A planned drive. Legs are named route segments; no coordinates are invented. */
export interface PlannedRoute {
  origin: string;
  legs: string[];
  /** The campus entrance this route uses. */
  entrance: string;
  /** Typical drive time, or null when no estimate exists. */
  driveMinutes: number | null;
  /** True when driveMinutes already includes current traffic (a routing provider's ETA). */
  etaIncludesTraffic: boolean;
  source: Source;
}

export type SignalKind = 'traffic' | 'weather' | 'construction' | 'announcement' | 'parking';
export type Severity = 'minor' | 'moderate' | 'major';

export interface Signal {
  id: string;
  kind: SignalKind;
  title: string;
  detail: string;
  /** Route legs or entrances it touches (traffic, construction). */
  legs?: string[];
  /** Courses or buildings it concerns (announcements, parking). */
  courses?: string[];
  buildings?: string[];
  /** Weather applies to an area rather than a road. */
  area?: 'campus' | 'city' | 'elsewhere';
  /** When it applies, in minutes relative to class start (e.g. -60 … +30). Omitted = all morning. */
  window?: { fromMin: number; toMin: number };
  /** Extra drive minutes, extra walk minutes. */
  driveDelayMin?: number;
  walkDelayMin?: number;
  severity: Severity;
  /** 0–1: how sure the source is. */
  confidence: number;
  minutesOld: number;
  maxAgeMin: number;
  /** Announcements that change the plan itself. */
  effect?: 'cancel' | 'move';
  movedTo?: { building: string; buildingShort: string; walkMinutes: number };
  /** Short label for the one action this alert offers, if any. */
  action?: 'find-parking' | 'review-parking' | 'review-route' | 'dismiss-trip' | 'allow-time';
  source: Source;
}

export interface ScenarioDef {
  id: string;
  label: string;
  blurb: string;
  session: ClassSession;
  route: PlannedRoute;
  /** Minutes to park and walk, per the demo garage near the destination. */
  parkingMinutes: number;
  walkMinutes: number;
  bufferMinutes: number;
  signals: Signal[];
}

export interface Check { test: 'fresh' | 'trusted' | 'on-route' | 'in-time' | 'meaningful'; ok: boolean; why: string }
export interface Judged { signal: Signal; relevant: boolean; checks: Check[]; reason: string; priority: number }

export interface DeparturePart { label: string; minutes: number; source: Source }
export type Departure =
  | { state: 'ok'; leaveAt: string; arriveBy: string; spareMinutes: number; totalMinutes: number; parts: DeparturePart[]; source: Source; incomplete: string[] }
  | { state: 'unavailable'; missing: string[] }
  | { state: 'not-needed' };
