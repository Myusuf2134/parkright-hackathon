/**
 * Staggered multi-camera streaming for the showcase: CAM-01 → CAM-02 → CAM-03 → CAM-04 → …,
 * one frame in flight at a time (A2 runs one inference at a time on this machine; frames from
 * several cameras at once would only be refused as busy).
 *
 * Each camera has its own stream session and sequence numbers and is bound to its own calibration.
 * A frame is exactly FrameMetadata + JPEG through the existing upload path (stream/frameUpload).
 * Ground truth is never uploaded from the showcase.
 */
import type { FrameMetadata, OccupancyObservation } from '@parkright/contracts';
import { newSessionId } from '../stream/session.ts';
import { uploadFrame } from '../stream/frameUpload.ts';
import { SHOWCASE_CAMERAS, type ShowcaseCameraId } from './layout.ts';
import type { ShowcaseLab } from './lab.ts';

export interface Detection { label: string; confidence: number; box: number[] }

export interface CameraStream {
  id: ShowcaseCameraId;
  sessionId: string;
  nextSeq: number;
  bound: string | null;
  lastSimTimeMs: number;
  last: null | {
    seq: number; status: string; at: number; encodeMs: number; ingestMs: number; a2Ms: number | null; bytes: number;
    detections: Detection[]; occupied: string[]; observations: OccupancyObservation[]; detail: string | null;
  };
  accepted: number;
  failed: number;
}

interface Health {
  status: string;
  perception: { provider: string; version: string };
  calibration?: { cameras?: Record<string, { version: string; pose: unknown; polygons: Record<string, { x: number; y: number }[]> }> } | null;
  inference?: { phase?: string; inference_ready?: boolean; detections?: Detection[]; frame_seq?: number; session_id?: string; timings?: Record<string, number> };
}

type Listener = () => void;

export class ShowcaseStreamer {
  readonly streams = new Map<ShowcaseCameraId, CameraStream>();
  running = false;
  /** Minimum time between two frames (all cameras), ms. 0 = as fast as A2 allows. */
  minIntervalMs = 0;
  health: Health | null = null;
  api: 'unknown' | 'connected' | 'disconnected' = 'unknown';
  version = 0;
  private order = SHOWCASE_CAMERAS.map((c) => c.id);
  private next = 0;
  private epoch: number;
  private listeners = new Set<Listener>();
  private loop: Promise<void> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly lab: ShowcaseLab, private readonly apiBase = '') {
    for (const id of this.order) this.streams.set(id, this.fresh(id));
    this.epoch = lab.world.epoch;
  }

  private fresh(id: ShowcaseCameraId): CameraStream {
    return { id, sessionId: newSessionId(), nextSeq: 0, bound: null, lastSimTimeMs: -1, last: null, accepted: 0, failed: 0 };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  start(): void {
    void this.pollHealth();
    this.healthTimer = setInterval(() => void this.pollHealth(), 2000);
  }

  /** New sessions for every camera (scenario change, time jump, reset). */
  newSessions(): void {
    for (const id of this.order) this.streams.set(id, { ...this.fresh(id), accepted: this.streams.get(id)!.accepted });
    this.changed();
  }

  setRunning(on: boolean): void {
    this.running = on;
    if (on && !this.loop) this.loop = this.run().finally(() => (this.loop = null));
    this.changed();
  }

  get ready(): boolean {
    return this.health?.inference?.inference_ready === true || this.health?.inference?.phase === 'ready' || this.health?.inference?.phase === 'degraded';
  }

  private async run(): Promise<void> {
    while (this.running) {
      if (!this.ready || !this.health?.calibration?.cameras) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      const started = performance.now();
      const id = this.order[this.next]!;
      this.next = (this.next + 1) % this.order.length;
      await this.sendOne(id);
      const spent = performance.now() - started;
      if (this.minIntervalMs > spent) await new Promise((r) => setTimeout(r, this.minIntervalMs - spent));
    }
  }

  /** Captures one frame from `id` and sends it through the existing ingest path. */
  async sendOne(id: ShowcaseCameraId): Promise<CameraStream['last']> {
    if (this.lab.world.epoch !== this.epoch) {
      this.epoch = this.lab.world.epoch;
      this.newSessions();
    }
    const s = this.streams.get(id)!;
    const cal = this.health?.calibration?.cameras?.[id];
    if (!cal) return null;
    const frame = await this.lab.capture(id);
    if (frame.simTimeMs < s.lastSimTimeMs) Object.assign(s, { ...this.fresh(id), accepted: s.accepted });
    s.lastSimTimeMs = frame.simTimeMs;
    const metadata: FrameMetadata = { session_id: s.sessionId, camera_id: id, seq: s.nextSeq++, sim_time_ms: Math.round(frame.simTimeMs), captured_at: frame.capturedAt.toISOString() };
    const t0 = performance.now();
    if (s.bound !== s.sessionId) {
      const b = await fetch(`${this.apiBase}/api/v1/cameras/${id}/calibration`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: s.sessionId, version: cal.version, pose: cal.pose }), signal: AbortSignal.timeout(3000),
      }).catch(() => null);
      if (!b?.ok) {
        s.failed++;
        s.last = { seq: metadata.seq, status: 'calibration rejected', at: Date.now(), encodeMs: frame.encodeMs, ingestMs: 0, a2Ms: null, bytes: frame.jpeg.size, detections: [], occupied: [], observations: [], detail: null };
        this.changed();
        return s.last;
      }
      s.bound = s.sessionId;
    }
    const up = await uploadFrame(this.apiBase, metadata, frame.jpeg);
    const ingestMs = Math.round(performance.now() - t0);
    this.api = up.kind === 'network' ? 'disconnected' : 'connected';
    let detections: Detection[] = [];
    let a2Ms: number | null = null;
    const accepted = up.kind === 'response' && up.result.outcome === 'accepted';
    if (accepted) {
      const d = await fetch(`${this.apiBase}/api/v1/perception/status`, { signal: AbortSignal.timeout(3000) }).then((r) => r.json()).catch(() => null);
      if (d && d.frame_seq === metadata.seq && d.session_id === metadata.session_id) {
        detections = (d.detections ?? []).filter((x: Detection) => ['car', 'truck', 'bus'].includes(x.label));
        a2Ms = d.timings?.total_ms ?? null;
      }
      s.accepted++;
    } else s.failed++;
    const observations = up.kind === 'response' ? up.result.observations : [];
    s.last = {
      seq: metadata.seq, status: up.kind === 'response' ? up.result.outcome : up.kind === 'network' ? 'disconnected' : `error ${up.status}`,
      at: Date.now(), encodeMs: Math.round(frame.encodeMs), ingestMs, a2Ms: a2Ms === null ? null : Math.round(a2Ms), bytes: frame.jpeg.size,
      detections, observations, occupied: observations.filter((o) => o.state === 'OCCUPIED').map((o) => o.space_id).sort(),
      detail: up.kind === 'response' ? up.result.detail : up.message,
    };
    this.changed();
    return s.last;
  }

  private async pollHealth(): Promise<void> {
    try {
      const r = await fetch(`${this.apiBase}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
      this.health = r.ok ? ((await r.json()) as Health) : null;
      this.api = this.health ? 'connected' : 'disconnected';
    } catch {
      this.api = 'disconnected';
    }
    this.changed();
  }
}
