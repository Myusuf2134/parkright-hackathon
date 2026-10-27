/**
 * Arrival Intelligence engine: pure and deterministic.
 *
 * 1. judge(): is a signal worth the student's attention for *this* trip? It must be fresh, trusted,
 *    on their route / about their class, during their travel time, and big enough to matter.
 * 2. departure(): class start − drive − parking − walk − buffer, where traffic is added only when the
 *    drive estimate doesn't already include it (no double counting), and only relevant signals count.
 */
import { minusMinutes } from '../lib/time.ts';
import type { Check, ClassSession, Departure, DeparturePart, Judged, PlannedRoute, ScenarioDef, Signal, Source } from './types.ts';

export const MIN_CONFIDENCE = 0.6;
export const MIN_DELAY_MIN = 3;

export interface TripContext {
  session: ClassSession;
  route: PlannedRoute;
  /** Travel window relative to class start, e.g. { fromMin: -40, toMin: 0 }. */
  travel: { fromMin: number; toMin: number };
}

function onRoute(s: Signal, ctx: TripContext): Check {
  switch (s.kind) {
    case 'traffic':
    case 'construction': {
      const hit = (s.legs ?? []).find((l) => ctx.route.legs.includes(l) || l === ctx.route.entrance);
      return { test: 'on-route', ok: !!hit, why: hit ? `On your route (${hit})` : `Not on your route (${(s.legs ?? []).join(', ') || 'elsewhere'})` };
    }
    case 'weather':
      return { test: 'on-route', ok: s.area !== 'elsewhere', why: s.area === 'elsewhere' ? 'Weather outside your commute area' : 'Covers your commute area' };
    case 'announcement': {
      const mine = (s.courses ?? []).includes(ctx.session.course) || (s.buildings ?? []).includes(ctx.session.building);
      return { test: 'on-route', ok: mine, why: mine ? `About ${ctx.session.course}` : `About ${(s.courses ?? s.buildings ?? []).join(', ') || 'another class'}, not yours` };
    }
    case 'parking': {
      const mine = !s.buildings || s.buildings.includes(ctx.session.building);
      return { test: 'on-route', ok: mine, why: mine ? 'Your parking near class' : 'Parking elsewhere' };
    }
  }
}

function inTime(s: Signal, ctx: TripContext): Check {
  if (!s.window) return { test: 'in-time', ok: true, why: 'Applies during your trip' };
  const overlap = s.window.fromMin < ctx.travel.toMin && s.window.toMin > ctx.travel.fromMin;
  return { test: 'in-time', ok: overlap, why: overlap ? 'Overlaps your travel time' : 'Outside your travel time' };
}

function meaningful(s: Signal): Check {
  if (s.effect) return { test: 'meaningful', ok: true, why: s.effect === 'cancel' ? 'Changes whether you need to go' : 'Changes where you need to go' };
  if (s.kind === 'parking') return { test: 'meaningful', ok: true, why: 'Changes where you can park' };
  const delay = (s.driveDelayMin ?? 0) + (s.walkDelayMin ?? 0);
  if (s.kind === 'construction' && s.severity !== 'minor') return { test: 'meaningful', ok: true, why: 'Affects how you reach campus' };
  const ok = delay >= MIN_DELAY_MIN || s.severity === 'major';
  return { test: 'meaningful', ok, why: ok ? `Could add about ${delay} min` : delay ? `Only about ${delay} min` : 'No real effect on arrival' };
}

/** Every check is kept so the UI can explain why something was or wasn't shown. */
export function judge(s: Signal, ctx: TripContext): Judged {
  const checks: Check[] = [
    { test: 'fresh', ok: s.minutesOld <= s.maxAgeMin, why: s.minutesOld <= s.maxAgeMin ? 'Recent' : `Out of date (${s.minutesOld} min old)` },
    { test: 'trusted', ok: s.confidence >= MIN_CONFIDENCE, why: s.confidence >= MIN_CONFIDENCE ? 'Reliable source' : 'Low confidence' },
    onRoute(s, ctx),
    inTime(s, ctx),
    meaningful(s),
  ];
  const failed = checks.find((c) => !c.ok);
  const sev = { minor: 1, moderate: 2, major: 3 }[s.severity];
  const priority = (s.effect ? 100 : 0) + sev * 10 + (s.driveDelayMin ?? 0) + (s.walkDelayMin ?? 0);
  return { signal: s, relevant: !failed, checks, reason: failed ? failed.why : checks[2].why, priority };
}

export interface DepartureInput {
  session: ClassSession;
  route: PlannedRoute;
  parkingMinutes: number | null;
  walkMinutes: number | null;
  bufferMinutes: number;
  /** Only signals already judged relevant. */
  relevant: Signal[];
}

export function departure(input: DepartureInput): Departure {
  const { session, route, relevant } = input;
  if (relevant.some((s) => s.effect === 'cancel')) return { state: 'not-needed' };
  const moved = relevant.find((s) => s.effect === 'move')?.movedTo;
  const walk = moved?.walkMinutes ?? input.walkMinutes;
  const missing = [route.driveMinutes === null && 'drive time', walk === null && 'walking time'].filter(Boolean) as string[];
  if (missing.length) return { state: 'unavailable', missing };

  const parts: DeparturePart[] = [{ label: 'Drive', minutes: route.driveMinutes!, source: route.source }];
  for (const s of relevant) {
    // A provider ETA that includes live traffic already contains traffic delays: never add them twice.
    if (s.kind === 'traffic' && route.etaIncludesTraffic) continue;
    if (s.driveDelayMin) parts.push({ label: s.kind === 'weather' ? 'Weather' : s.kind === 'construction' ? 'Roadwork' : 'Traffic', minutes: s.driveDelayMin, source: s.source });
  }
  const incomplete: string[] = [];
  if (input.parkingMinutes === null) incomplete.push('parking');
  else parts.push({ label: 'Park', minutes: input.parkingMinutes, source: 'estimated' });
  const walkDelay = relevant.reduce((n, s) => n + (s.walkDelayMin ?? 0), 0);
  parts.push({ label: 'Walk', minutes: walk! + walkDelay, source: 'estimated' });
  parts.push({ label: 'Buffer', minutes: input.bufferMinutes, source: 'estimated' });

  const total = parts.reduce((n, p) => n + p.minutes, 0);
  const leaveAt = minusMinutes(session.startsAt, total);
  const arriveBy = minusMinutes(session.startsAt, input.bufferMinutes);
  if (!leaveAt || !arriveBy) return { state: 'unavailable', missing: ['class time'] };
  const anyDemo = parts.some((p) => p.source === 'demo') || session.source === 'demo';
  return { state: 'ok', leaveAt, arriveBy, spareMinutes: input.bufferMinutes, totalMinutes: total, parts, source: anyDemo ? 'demo' : 'estimated', incomplete };
}

/** Live parking turned into a signal: real data, so it is never a demo alert. */
export function parkingSignal(p: { trusted: boolean; open: number; forYou: number; garage: string; building: string } | null): Signal | null {
  if (!p) return null;
  if (!p.trusted) {
    return { id: 'parking-paused', kind: 'parking', title: 'Live parking data paused', detail: `${p.garage} can't be confirmed right now.`, buildings: [p.building], severity: 'moderate', confidence: 1, minutesOld: 0, maxAgeMin: 5, action: 'find-parking', source: 'live' };
  }
  if (p.forYou > 0) return null;
  return {
    id: 'parking-none', kind: 'parking', title: 'No confirmed open spaces',
    detail: `${p.garage} has no space you can use confirmed open right now.`,
    buildings: [p.building], severity: 'moderate', confidence: 1, minutesOld: 0, maxAgeMin: 5, action: 'find-parking', source: 'live',
  };
}

export interface ArrivalResult {
  session: ClassSession;
  route: PlannedRoute;
  shown: Judged[];
  filtered: Judged[];
  departure: Departure;
  canceled: boolean;
  movedTo: Signal['movedTo'] | null;
  /** The one line under the departure time. */
  note: { text: string; tone: 'calm' | 'notice' | 'important'; source: Source } | null;
}

/** Evaluate a scenario plus (optionally) live parking. Deterministic for the same inputs. */
export function evaluate(def: ScenarioDef, live: Parameters<typeof parkingSignal>[0] = null): ArrivalResult {
  const typical = (def.route.driveMinutes ?? 20) + def.parkingMinutes + def.walkMinutes + def.bufferMinutes;
  const ctx: TripContext = { session: def.session, route: def.route, travel: { fromMin: -(typical + 20), toMin: 0 } };
  const signals = [...def.signals];
  const ps = parkingSignal(live);
  if (ps) signals.push(ps);
  const judged = signals.map((s) => judge(s, ctx));
  const shown = judged.filter((j) => j.relevant).sort((a, b) => b.priority - a.priority);
  const filtered = judged.filter((j) => !j.relevant);
  const relevant = shown.map((j) => j.signal);
  const parkingMinutes = live && live.trusted && live.forYou === 0 ? null : def.parkingMinutes;
  const dep = departure({ session: def.session, route: def.route, parkingMinutes, walkMinutes: def.walkMinutes, bufferMinutes: def.bufferMinutes, relevant });
  const canceled = dep.state === 'not-needed';
  const movedTo = relevant.find((s) => s.effect === 'move')?.movedTo ?? null;

  let note: ArrivalResult['note'] = null;
  const top = shown[0]?.signal;
  if (canceled) note = { text: `Your ${def.session.startsAt} class has been canceled.`, tone: 'important', source: top?.source ?? 'demo' };
  else if (movedTo) note = { text: `Your class has moved to ${movedTo.building}.`, tone: 'important', source: top?.source ?? 'demo' };
  else if (top?.kind === 'traffic' && !def.route.etaIncludesTraffic) note = { text: `Traffic on your route may add ${top.driveDelayMin} minutes.`, tone: 'notice', source: top.source };
  else if (top?.kind === 'weather') note = { text: `${top.title}. Extra time included.`, tone: 'notice', source: top.source };
  else if (top?.kind === 'construction') note = { text: top.title + '.', tone: 'notice', source: top.source };
  else if (top?.kind === 'parking') note = { text: top.title + '.', tone: 'notice', source: top.source };
  else if (dep.state === 'ok') note = { text: 'Parking and walking time included.', tone: 'calm', source: dep.source };
  return { session: def.session, route: def.route, shown, filtered, departure: dep, canceled, movedTo, note };
}
