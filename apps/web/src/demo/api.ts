/** Demo-mode API: DTOs for /api/v1/demo/* and the hooks the demo screen reads. */
import { useEffect, useState } from 'react';

export interface Candidate {
  facility_id: string;
  name: string;
  walking_minutes: number;
  traffic: string;
  total_spaces: number;
  demo_available_spaces: number;
  demo_space: { level: string; space_id: string };
}

export interface Scenario {
  scenario_id: string;
  disclaimer: string;
  student: { name: string };
  next_class: { time: string; course: string; destination: string; destination_short: string };
  simulator: { facility_id: string; camera_id: string; hash: string };
  camera_garage: string;
  candidates: Candidate[];
}

export interface Detection { label: string; confidence: number; box: number[] }

export interface DemoStatus {
  epoch: number;
  frames_since_reset: number;
  nemotron: { mode: 'live' | 'fallback'; model: string; provider: string; live_configured: boolean; will_call_nemotron: boolean };
  perception: { provider: string; phase: string | null; inference_ready: boolean; loaded: boolean; allow_open: boolean; artifact_error: string | null };
  calibration: Record<string, { x: number; y: number }[]> | null;
  showcase?: boolean;
  cameras?: {
    camera_id: string;
    name: string;
    owned: string[];
    polygons: Record<string, { x: number; y: number }[]> | null;
    last_frame: null | { seq: number; received_at: string; age_s: number; detections: Detection[]; timings: Record<string, number> };
  }[];
  camera: {
    fresh: boolean;
    live_bays: number;
    occupied: string[];
    uncertain: string[];
    open: string[];
    last_frame: null | { seq: number; received_at: string; age_s: number; detections: Detection[]; timings: Record<string, number> };
  };
}

export interface Presentation {
  recommended: boolean;
  facility_id: string | null;
  garage: string | null;
  level: string | null;
  space_id: string | null;
  walking_minutes: number | null;
  destination: string;
  class_time: string;
  headline: string;
  explanation: string;
  source: 'nemotron' | 'fallback';
  source_label: string;
  comparison: { facility_id: string; name: string; walking_minutes: number; available_spaces: number; traffic: string; chosen: boolean }[];
}

export interface DemoRecommendation {
  facts: unknown;
  result: { facility_id: string | null; provenance: { status: 'success' | 'fallback'; attempted: boolean; latency_ms: number; fallback_reason: string | null } };
  presentation: Presentation;
}

export async function fetchScenario(): Promise<Scenario | null> {
  const r = await fetch('/api/v1/demo/scenario').catch(() => null);
  return r && r.ok ? ((await r.json()) as Scenario) : null;
}

export async function requestRecommendation(): Promise<DemoRecommendation> {
  const r = await fetch('/api/v1/demo/recommendation', { method: 'POST' });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.error?.message ?? `The API answered ${r.status}`);
  }
  return (await r.json()) as DemoRecommendation;
}

/** Polls /demo/status. `null` until the first answer, `'down'` while the API is unreachable. */
export function useDemoStatus(intervalMs = 1000): DemoStatus | null | 'down' {
  const [status, setStatus] = useState<DemoStatus | null | 'down'>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/v1/demo/status', { signal: AbortSignal.timeout(2500) })
        .then((r) => (r.ok ? (r.json() as Promise<DemoStatus>) : Promise.reject(new Error(String(r.status)))))
        .then((s) => alive && setStatus(s))
        .catch(() => alive && setStatus('down'));
    void load();
    const t = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs]);
  return status;
}

export const flags = (search = location.search) => {
  const q = new URLSearchParams(search);
  return { record: q.get('record') === '1', autoplay: q.get('autoplay') === '1', tech: q.get('tech') === '1' };
};

export interface PerceptionEvent {
  id: number;
  at: string;
  camera_id: string;
  seq: number;
  vehicles: number;
  a2_ms: number;
  changes: { space_id: string; from: string | null; to: string }[];
}

/** Real perception events from the API (one per processed frame), newest last, at most `keep`. */
export function useEvents(keep = 20): PerceptionEvent[] {
  const [events, setEvents] = useState<PerceptionEvent[]>([]);
  useEffect(() => {
    let after = 0;
    let epoch: number | null = null;
    let alive = true;
    const t = setInterval(async () => {
      const r = await fetch(`/api/v1/demo/events?after=${after}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (!alive || !r) return;
      if (epoch !== null && r.epoch !== epoch) {
        after = 0;
        setEvents([]);
      }
      epoch = r.epoch;
      if (r.events.length) {
        after = r.events[r.events.length - 1].id;
        setEvents((e) => [...e, ...r.events].slice(-keep));
      }
    }, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [keep]);
  return events;
}
