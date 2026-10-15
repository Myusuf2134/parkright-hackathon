/**
 * Ground truth leaves the simulator ONLY here, as a separate request to the evaluation
 * route — never with a frame. Failures are reported but never stop frame streaming.
 *
 * SIMULATOR GROUND TRUTH — NOT PROVIDED TO PERCEPTION.
 */
import type { GroundTruthRecord } from '@parkright/contracts';
import type { TruthSnapshot } from '../sim/world.ts';

export function toGroundTruthRecord(frame: { session_id: string; camera_id: string; seq: number }, truth: TruthSnapshot): GroundTruthRecord {
  const spaces = truth.spaces.map((s) => ({ space_id: s.space_id, truth: s.truth }));
  if (spaces.length === 0) throw new Error('ground truth needs at least one space');
  return {
    session_id: frame.session_id,
    camera_id: frame.camera_id,
    seq: frame.seq,
    sim_time_ms: truth.simTimeMs,
    environment_preset: truth.preset,
    spaces: spaces as GroundTruthRecord['spaces'],
  };
}

export type GroundTruthOutcome = { ok: true } | { ok: false; message: string };

export async function postGroundTruth(apiBase: string, record: GroundTruthRecord, timeoutMs = 5000): Promise<GroundTruthOutcome> {
  try {
    const res = await fetch(`${apiBase}/api/v1/evaluation/ground-truth`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? { ok: true } : { ok: false, message: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
