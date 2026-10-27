/**
 * Typed DEMO scenarios for Arrival Intelligence. None of this is current, real-world information:
 * every value carries source 'demo' and the UI labels it. Road names are generic on purpose
 * ("Highway leg"), so nothing reads as a real closure on a real road.
 */
import type { ClassSession, PlannedRoute, ScenarioDef, Signal } from './types.ts';

export interface ScheduleSeed { course: string; startsAt: string; building: string; buildingShort: string; walkMinutes: number }

/** Matches the hackathon demo fixture's next class, so Plan and Explore agree. */
export const DEFAULT_SEED: ScheduleSeed = { course: 'CSE 2421', startsAt: '10:20 AM', building: 'Dreese Laboratories', buildingShort: 'Dreese Labs', walkMinutes: 4 };

const route = (over: Partial<PlannedRoute> = {}): PlannedRoute => ({
  origin: 'Home (demo)', legs: ['Highway leg', 'Campus approach'], entrance: 'North campus entrance',
  driveMinutes: 10, etaIncludesTraffic: false, source: 'demo', ...over,
});

// ---- signals that should NOT surface (they make the filtering visible) ----
const elsewhereClosure: Signal = {
  id: 'closure-elsewhere', kind: 'traffic', title: 'Highway closed on the east side', detail: 'Full closure on a highway your route doesn’t use.',
  legs: ['East-side highway'], severity: 'major', driveDelayMin: 25, confidence: 0.9, minutesOld: 6, maxAgeMin: 30, source: 'demo',
};
const lightRain: Signal = {
  id: 'light-rain', kind: 'weather', title: 'Light rain', detail: 'Light rain this morning.', area: 'campus',
  severity: 'minor', driveDelayMin: 1, confidence: 0.8, minutesOld: 20, maxAgeMin: 90, source: 'demo',
};
const otherClass: Signal = {
  id: 'other-class', kind: 'announcement', title: 'MATH 2568 canceled', detail: 'A class you’re not taking today.',
  courses: ['MATH 2568'], effect: 'cancel', severity: 'major', confidence: 0.95, minutesOld: 40, maxAgeMin: 600, source: 'demo',
};
const staleCrash: Signal = {
  id: 'stale-crash', kind: 'traffic', title: 'Crash reported on your highway', detail: 'Reported over an hour and a half ago.',
  legs: ['Highway leg'], severity: 'moderate', driveDelayMin: 8, confidence: 0.8, minutesOld: 95, maxAgeMin: 30, source: 'demo',
};
const eveningWork: Signal = {
  id: 'evening-work', kind: 'construction', title: 'Evening lane closure', detail: 'Lane closed tonight from 7 PM.',
  legs: ['Campus approach'], window: { fromMin: 520, toMin: 760 }, severity: 'moderate', driveDelayMin: 6, confidence: 0.9, minutesOld: 120, maxAgeMin: 1440, source: 'demo',
};

// ---- signals that should surface ----
const routeCrash: Signal = {
  id: 'route-crash', kind: 'traffic', title: 'Crash on your highway leg', detail: 'Slow traffic before your campus exit.',
  legs: ['Highway leg'], window: { fromMin: -70, toMin: 10 }, severity: 'moderate', driveDelayMin: 12, confidence: 0.85, minutesOld: 4, maxAgeMin: 30, action: 'allow-time', source: 'demo',
};
const snow: Signal = {
  id: 'snow', kind: 'weather', title: 'Snow may slow your commute', detail: 'Snow and slick roads through mid-morning. Walk carefully from the garage.', area: 'campus',
  window: { fromMin: -180, toMin: 60 }, severity: 'moderate', driveDelayMin: 6, walkDelayMin: 2, confidence: 0.8, minutesOld: 15, maxAgeMin: 90, action: 'allow-time', source: 'demo',
};
const entranceWork: Signal = {
  id: 'entrance-work', kind: 'construction', title: 'Roadwork at your usual campus entrance', detail: 'One lane closed at the north entrance. Expect a short delay or use another entrance.',
  legs: ['North campus entrance'], window: { fromMin: -240, toMin: 240 }, severity: 'moderate', driveDelayMin: 5, confidence: 0.9, minutesOld: 30, maxAgeMin: 1440, action: 'review-route', source: 'demo',
};
const canceled: Signal = {
  id: 'class-canceled', kind: 'announcement', title: 'CSE 2421 canceled today', detail: 'Your instructor posted that today’s 10:20 AM class won’t meet.',
  courses: ['CSE 2421'], effect: 'cancel', severity: 'major', confidence: 0.95, minutesOld: 25, maxAgeMin: 600, action: 'dismiss-trip', source: 'demo',
};
const moved: Signal = {
  id: 'class-moved', kind: 'announcement', title: 'CSE 2421 moved to Engineering Annex', detail: 'Today’s class meets in Engineering Annex instead of Dreese Laboratories.',
  courses: ['CSE 2421'], effect: 'move', movedTo: { building: 'Engineering Annex', buildingShort: 'Engineering Annex', walkMinutes: 7 },
  severity: 'major', confidence: 0.9, minutesOld: 50, maxAgeMin: 600, action: 'review-parking', source: 'demo',
};

export function buildScenarios(seed: ScheduleSeed = DEFAULT_SEED): ScenarioDef[] {
  const session: ClassSession = { course: seed.course, startsAt: seed.startsAt, building: seed.building, buildingShort: seed.buildingShort, source: 'demo' };
  const base = { session, parkingMinutes: 3, walkMinutes: seed.walkMinutes, bufferMinutes: 5 };
  return [
    { ...base, id: 'normal', label: 'Normal day', blurb: 'Nothing affects your trip.', route: route(), signals: [] },
    { ...base, id: 'quiet', label: 'Busy elsewhere', blurb: 'Several events, none on your trip.', route: route(), signals: [elsewhereClosure, lightRain, otherClass, staleCrash, eveningWork] },
    { ...base, id: 'traffic', label: 'Traffic', blurb: 'A crash on your highway leg.', route: route(), signals: [routeCrash, elsewhereClosure, otherClass] },
    { ...base, id: 'weather', label: 'Snow', blurb: 'Snow slows driving and walking.', route: route(), signals: [snow] },
    { ...base, id: 'construction', label: 'Roadwork', blurb: 'Work at your usual entrance.', route: route(), signals: [entranceWork, eveningWork] },
    { ...base, id: 'canceled', label: 'Class canceled', blurb: 'Your class won’t meet.', route: route(), signals: [canceled] },
    { ...base, id: 'moved', label: 'Room change', blurb: 'Your class moved buildings.', route: route(), signals: [moved, lightRain] },
    { ...base, id: 'missing', label: 'No route estimate', blurb: 'Drive time unavailable.', route: route({ driveMinutes: null, source: 'unavailable' }), signals: [] },
  ];
}

export const SCENARIO_IDS = buildScenarios().map((s) => s.id);
