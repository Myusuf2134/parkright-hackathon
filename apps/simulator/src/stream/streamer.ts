/**
 * Streams cam-01. Each frame:
 *   1. capture cam-01's pixels (Lab.captureFrame)   2. encode JPEG
 *   3. build canonical FrameMetadata                 4. POST the frame (stream/frameUpload)
 *   5. if evaluation is on, POST ground truth separately (evaluation/groundTruth)
 *
 * seq increases by one per captured frame within a session, whether or not the upload
 * succeeds; failed frames are never re-sent. A new session starts whenever sim time
 * would go backwards (reset, new seed, loaded scene). If a frame is still uploading
 * when the next tick fires, that tick is skipped rather than queued.
 */
import type { FrameMetadata, FrameOutcome, ModelRef } from '@parkright/contracts';
import { postGroundTruth, toGroundTruthRecord } from '../evaluation/groundTruth.ts';
import type { Lab } from '../lab.ts';
import { CAMERA_ID } from '../sim/facility.ts';
import { uploadFrame } from './frameUpload.ts';
import { newSessionId } from './session.ts';

export const STREAM_RATES = [0, 1, 2, 5] as const;
export type StreamRate = (typeof STREAM_RATES)[number];

export type FrameStatus = FrameOutcome | 'rejected' | 'error' | 'disconnected';
export type GroundTruthStatus = 'sent' | 'failed' | 'off' | 'skipped';

export interface FrameLogEntry {
  sessionId: string;
  seq: number;
  simTimeMs: number;
  capturedAt: string;
  bytes: number;
  status: FrameStatus;
  httpStatus: number | null;
  detail: string | null;
  latencyMs: number;
  groundTruth: GroundTruthStatus;
  groundTruthDetail: string | null;
}

export interface ApiHealth {
  status: string;
  frame_contract_version: number;
  perception: ModelRef;
  evaluation_enabled: boolean;
}

export type ApiState = 'unknown' | 'connected' | 'disconnected';

type Listener = () => void;

export class FrameStreamer {
  rate: StreamRate = 0;
  sessionId = newSessionId();
  nextSeq = 0;
  inFlight = false;
  skippedTicks = 0;
  sendGroundTruth = true;
  api: ApiState = 'unknown';
  health: ApiHealth | null = null;
  log: FrameLogEntry[] = [];
  lastFrameUrl: string | null = null;
  version = 0;

  private lastSimTimeMs = -1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();

  constructor(
    private readonly lab: Lab,
    private readonly apiBase = '',
  ) {}

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

  stop(): void {
    this.setRate(0);
    if (this.healthTimer) clearInterval(this.healthTimer);
  }

  setRate(rate: StreamRate): void {
    this.rate = rate;
    if (this.timer) clearInterval(this.timer);
    this.timer = rate > 0 ? setInterval(() => void this.tick(), 1000 / rate) : null;
    this.changed();
  }

  setGroundTruth(on: boolean): void {
    this.sendGroundTruth = on;
    this.changed();
  }

  newSession(): void {
    this.sessionId = newSessionId();
    this.nextSeq = 0;
    this.lastSimTimeMs = -1;
    this.changed();
  }

  private async tick(): Promise<void> {
    if (this.inFlight) {
      this.skippedTicks++;
      this.changed();
      return;
    }
    await this.captureAndSend();
  }

  /** Captures one frame and sends it. Returns null if a frame is already in flight. */
  async captureAndSend(): Promise<FrameLogEntry | null> {
    if (this.inFlight) return null;
    this.inFlight = true;
    this.changed();
    try {
      const frame = await this.lab.captureFrame();
      if (frame.simTimeMs < this.lastSimTimeMs) this.newSession();
      this.lastSimTimeMs = frame.simTimeMs;
      const metadata: FrameMetadata = {
        session_id: this.sessionId,
        camera_id: CAMERA_ID,
        seq: this.nextSeq++,
        sim_time_ms: frame.simTimeMs,
        captured_at: frame.capturedAt.toISOString(),
      };
      if (this.lastFrameUrl) URL.revokeObjectURL(this.lastFrameUrl);
      this.lastFrameUrl = URL.createObjectURL(frame.jpeg);

      const started = performance.now();
      const upload = await uploadFrame(this.apiBase, metadata, frame.jpeg);
      const entry: FrameLogEntry = {
        sessionId: metadata.session_id,
        seq: metadata.seq,
        simTimeMs: metadata.sim_time_ms,
        capturedAt: metadata.captured_at,
        bytes: frame.jpeg.size,
        status: upload.kind === 'response' ? upload.result.outcome : upload.kind === 'network' ? 'disconnected' : upload.status === 409 || upload.status < 500 ? 'rejected' : 'error',
        httpStatus: upload.kind === 'network' ? null : upload.status,
        detail: upload.kind === 'response' ? upload.result.detail : upload.message + (upload.kind === 'error' ? ` (${upload.code})` : ''),
        latencyMs: Math.round(performance.now() - started),
        groundTruth: 'off',
        groundTruthDetail: null,
      };
      this.api = upload.kind === 'network' ? 'disconnected' : 'connected';

      // Ground truth: a separate request, only once the frame itself reached the backend.
      if (!this.sendGroundTruth || !this.health?.evaluation_enabled) entry.groundTruth = 'off';
      else if (upload.kind === 'network') entry.groundTruth = 'skipped';
      else {
        const gt = await postGroundTruth(this.apiBase, toGroundTruthRecord(metadata, frame.truth));
        entry.groundTruth = gt.ok ? 'sent' : 'failed';
        entry.groundTruthDetail = gt.ok ? null : gt.message;
      }

      this.log = [entry, ...this.log].slice(0, 40);
      return entry;
    } catch (e) {
      // Capture/encoding failure: keep running, report it.
      const failure: FrameLogEntry = {
        sessionId: this.sessionId, seq: -1, simTimeMs: 0, capturedAt: new Date().toISOString(), bytes: 0, status: 'error',
        httpStatus: null, detail: `capture failed: ${(e as Error).message}`, latencyMs: 0, groundTruth: 'skipped', groundTruthDetail: null,
      };
      this.log = [failure, ...this.log].slice(0, 40);
      return null;
    } finally {
      this.inFlight = false;
      this.changed();
    }
  }

  private async pollHealth(): Promise<void> {
    try {
      const res = await fetch(`${this.apiBase}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
      const body = res.ok ? ((await res.json()) as ApiHealth) : null;
      this.health = body;
      this.api = body?.status === 'ok' ? 'connected' : 'disconnected';
    } catch {
      this.api = 'disconnected';
    }
    this.changed();
  }
}
