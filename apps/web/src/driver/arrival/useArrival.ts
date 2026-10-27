import { useMemo, useState } from 'react';
import type { Scenario } from '../net/api.ts';
import { evaluate, type ArrivalResult } from './engine.ts';
import { buildScenarios, DEFAULT_SEED, SCENARIO_IDS, type ScheduleSeed } from './scenarios.ts';
import type { ScenarioDef } from './types.ts';

const KEY = 'parkright.arrival.scenario';

function initialId(): string {
  const q = new URLSearchParams(location.search).get('arrival');
  if (q && SCENARIO_IDS.includes(q)) return q;
  try { const s = localStorage.getItem(KEY); if (s && SCENARIO_IDS.includes(s)) return s; } catch { /* ignore */ }
  return 'normal';
}

/** The demo schedule seed: the API's demo fixture when demo mode is on, otherwise the same default. */
export function seedFrom(scenario: Scenario | null | undefined): ScheduleSeed {
  if (!scenario) return DEFAULT_SEED;
  const nearest = [...scenario.candidates].sort((a, b) => a.walking_minutes - b.walking_minutes)[0];
  return {
    course: scenario.next_class.course, startsAt: scenario.next_class.time,
    building: scenario.next_class.destination, buildingShort: scenario.next_class.destination_short,
    walkMinutes: nearest?.walking_minutes ?? DEFAULT_SEED.walkMinutes,
  };
}

export interface LiveParking { trusted: boolean; open: number; forYou: number; garage: string; simulated: boolean }

export function useArrival(scenario: Scenario | null | undefined, parking: LiveParking | null) {
  const [id, setIdState] = useState(initialId);
  const setId = (next: string) => {
    setIdState(next);
    try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  };
  const defs: ScenarioDef[] = useMemo(() => buildScenarios(seedFrom(scenario)), [scenario]);
  const def = defs.find((d) => d.id === id) ?? defs[0];
  const result: ArrivalResult = useMemo(
    () => evaluate(def, parking ? { trusted: parking.trusted, open: parking.open, forYou: parking.forYou, garage: parking.garage, building: def.session.building } : null),
    [def, parking?.trusted, parking?.open, parking?.forYou, parking?.garage], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return { id: def.id, def, defs, setId, result };
}
