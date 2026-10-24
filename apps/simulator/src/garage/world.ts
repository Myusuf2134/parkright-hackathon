/**
 * The garage simulation: a scenario, a lighting preset and sim time. Pure TypeScript.
 * Time moves only through advance()/setTime(); nothing reads the wall clock, so a
 * (scenario, preset, t) triple always yields the same vehicles and the same truth.
 */
import type { CameraPose } from '../camera/pose.ts';
import type { PresetId } from '../sim/presets.ts';
import type { TruthSnapshot } from '../sim/world.ts';
import { GARAGE_BAYS, GARAGE_CAM01_POSE } from './layout.ts';
import { buildScenario, type GarageVehiclePose, occupiedBays, posesAt, type Scenario, type ScenarioId } from './scenarios.ts';
import { type GaragePresetId } from './presets.ts';

export interface GarageSpec {
  kind: 'garage';
  scenario: ScenarioId;
  preset: GaragePresetId;
  seed: number;
  camera: CameraPose;
}

/** Ground truth for one instant. Evaluation and debugging only; never part of a frame. */
export interface GarageTruth extends TruthSnapshot {
  readonly scenario: ScenarioId;
  readonly vehicles: readonly { id: string; kind: string; x: number; z: number; heading: number; moving: boolean }[];
}

type Listener = () => void;

export class GarageWorld {
  spec: GarageSpec;
  scenario: Scenario;
  simTimeMs = 0;
  playing = false;
  loop = false;
  version = 0;
  private listeners = new Set<Listener>();

  constructor(scenario: ScenarioId = 'static', preset: GaragePresetId = 'clear_day', seed = 4242) {
    this.spec = { kind: 'garage', scenario, preset, seed, camera: structuredClone(GARAGE_CAM01_POSE) };
    this.scenario = buildScenario(scenario, seed);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** Loads a scenario (and optionally a preset) from its start. */
  load(scenario: ScenarioId, preset: GaragePresetId = this.spec.preset): void {
    this.spec = { ...this.spec, scenario, preset };
    this.scenario = buildScenario(scenario, this.spec.seed);
    this.simTimeMs = 0;
    this.changed();
  }

  setPreset(preset: GaragePresetId): void {
    this.spec = { ...this.spec, preset };
    this.changed();
  }

  reset(): void {
    this.simTimeMs = 0;
    this.changed();
  }

  play(): void {
    this.playing = true;
    this.changed();
  }

  pause(): void {
    this.playing = false;
    this.changed();
  }

  setTime(ms: number): void {
    this.simTimeMs = Math.max(0, Math.min(ms, this.scenario.durationMs));
    this.changed();
  }

  /** Advances by wall-clock dt while playing; stops at the scenario's end. */
  advance(dtMs: number): void {
    if (!this.playing || dtMs <= 0) return;
    const next = this.simTimeMs + Math.min(dtMs, 250);
    if (next >= this.scenario.durationMs) {
      this.simTimeMs = this.scenario.durationMs;
      this.playing = false;
      this.changed();
    } else this.simTimeMs = next;
  }

  vehicles(): GarageVehiclePose[] {
    return posesAt(this.scenario, this.simTimeMs);
  }

  truth(): GarageTruth {
    const poses = this.vehicles();
    const occupied = new Set(occupiedBays(poses));
    return {
      simTimeMs: this.simTimeMs,
      preset: this.spec.preset,
      scenario: this.spec.scenario,
      spaces: GARAGE_BAYS.map((b) => ({ space_id: b.id, truth: occupied.has(b.id) ? 'occupied' : 'empty' })),
      vehicles: poses.map((p) => ({ id: p.id, kind: p.spec.kind, x: p.x, z: p.z, heading: p.heading, moving: p.moving })),
    };
  }
}

export type { PresetId };
