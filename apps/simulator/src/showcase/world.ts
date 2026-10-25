/**
 * The showcase simulation: a site, a traffic scenario, a lighting preset and sim time. Pure TypeScript.
 * Time moves only through advance()/setTime(); (scenario, seed, t) always gives the same garage.
 */
import type { GaragePresetId } from '../garage/presets.ts';
import type { TruthSnapshot } from '../sim/world.ts';
import type { ShowcaseCameraId } from './layout.ts';
import { buildSiteSchedule, HORIZON_MS, occupiedIn, posesAt, type Schedule, type ShowcaseScenarioId, type VehiclePose } from './schedule.ts';
import { SHOWCASE_SITE, type Site } from './site.ts';

export interface ShowcaseSpec {
  kind: 'showcase';
  scenario: ShowcaseScenarioId;
  preset: GaragePresetId;
  seed: number;
}

/** Ground truth for one instant (development and evaluation only; never part of a frame). */
export interface ShowcaseTruth extends TruthSnapshot {
  readonly scenario: ShowcaseScenarioId;
  readonly vehicles: readonly { id: string; kind: string; x: number; z: number; heading: number; moving: boolean }[];
}

type Listener = () => void;

export class ShowcaseWorld {
  spec: ShowcaseSpec;
  schedule: Schedule;
  simTimeMs = 0;
  playing = true;
  speed = 1;
  version = 0;
  /** Bumps whenever time jumps backwards or the scenario changes (streams must start new sessions). */
  epoch = 0;
  private listeners = new Set<Listener>();

  constructor(scenario: ShowcaseScenarioId = 'live', preset: GaragePresetId = 'clear_day', seed = 4242, readonly site: Site = SHOWCASE_SITE) {
    this.spec = { kind: 'showcase', scenario, preset, seed };
    this.schedule = buildSiteSchedule(site, scenario, seed);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  load(scenario: ShowcaseScenarioId): void {
    this.spec = { ...this.spec, scenario };
    this.schedule = buildSiteSchedule(this.site, scenario, this.spec.seed);
    this.simTimeMs = 0;
    this.epoch++;
    this.changed();
  }

  setPreset(preset: GaragePresetId): void {
    this.spec = { ...this.spec, preset };
    this.changed();
  }

  setTime(ms: number): void {
    const t = Math.max(0, Math.min(ms, HORIZON_MS));
    if (t < this.simTimeMs) this.epoch++;
    this.simTimeMs = t;
    this.changed();
  }

  reset(): void {
    this.setTime(0);
  }

  play(): void {
    this.playing = true;
    this.changed();
  }

  pause(): void {
    this.playing = false;
    this.changed();
  }

  advance(dtMs: number): void {
    if (!this.playing || dtMs <= 0) return;
    const next = this.simTimeMs + Math.min(dtMs, 250) * this.speed;
    if (next >= HORIZON_MS) this.setTime(0); // the 30-minute schedule repeats from the start
    else this.simTimeMs = next;
  }

  vehicles(): VehiclePose[] {
    return posesAt(this.schedule, this.simTimeMs);
  }

  truth(owned?: readonly string[]): ShowcaseTruth {
    const poses = this.vehicles();
    const occupied = new Set(occupiedIn(this.site.bays, poses));
    const bays = owned ? this.site.bays.filter((b) => owned.includes(b.id)) : this.site.bays;
    return {
      simTimeMs: this.simTimeMs,
      preset: this.spec.preset,
      scenario: this.spec.scenario,
      spaces: bays.map((b) => ({ space_id: b.id, truth: occupied.has(b.id) ? 'occupied' : 'empty' })),
      vehicles: poses.map((p) => ({ id: p.id, kind: p.spec.kind, x: p.x, z: p.z, heading: p.heading, moving: p.moving })),
    };
  }
}

export type { ShowcaseCameraId };
