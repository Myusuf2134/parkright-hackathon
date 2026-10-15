/**
 * The ONLY code that sends a camera frame. It knows two things: canonical FrameMetadata
 * and JPEG bytes. It does not import the simulation or evaluation modules (enforced by
 * test/isolation.test.ts), so it has no way to attach ground truth, vehicle positions,
 * labels or debug data — not as fields, parts, filenames, headers or query strings.
 *
 * The ingest token is added by the dev-server proxy, server-side.
 */
import {
  FRAME_CONTENT_TYPE,
  FRAME_IMAGE_PART,
  FRAME_METADATA_PART,
  type FrameIngestResult,
  type FrameMetadata,
  IDENTIFIER,
} from '@parkright/contracts';

export const FRAME_METADATA_KEYS = ['session_id', 'camera_id', 'seq', 'sim_time_ms', 'captured_at'] as const;
/** Constant, content-free filename. */
export const FRAME_FILENAME = 'frame.jpg';

/** Throws unless `m` is exactly canonical FrameMetadata: the five keys, correctly typed, nothing else. */
export function assertCanonicalMetadata(m: unknown): asserts m is FrameMetadata {
  if (typeof m !== 'object' || m === null || Array.isArray(m)) throw new Error('metadata must be an object');
  const keys = Object.keys(m).sort();
  const expected = [...FRAME_METADATA_KEYS].sort();
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    throw new Error(`metadata must have exactly ${expected.join(', ')}; got ${keys.join(', ')}`);
  }
  const v = m as Record<string, unknown>;
  if (typeof v.session_id !== 'string' || !IDENTIFIER.test(v.session_id)) throw new Error('session_id is not a valid identifier');
  if (typeof v.camera_id !== 'string' || !IDENTIFIER.test(v.camera_id)) throw new Error('camera_id is not a valid identifier');
  for (const k of ['seq', 'sim_time_ms'] as const) {
    if (!Number.isSafeInteger(v[k]) || (v[k] as number) < 0) throw new Error(`${k} must be a non-negative integer`);
  }
  if (typeof v.captured_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(v.captured_at)) {
    throw new Error('captured_at must be ISO-8601 with an offset');
  }
}

export function buildFrameForm(metadata: FrameMetadata, jpeg: Blob): FormData {
  assertCanonicalMetadata(metadata);
  if (jpeg.type !== FRAME_CONTENT_TYPE) throw new Error(`frame must be ${FRAME_CONTENT_TYPE}, got ${jpeg.type || 'unknown'}`);
  // Serialise only the canonical keys, in a fixed order, from a fresh object.
  const canonical: FrameMetadata = {
    session_id: metadata.session_id,
    camera_id: metadata.camera_id,
    seq: metadata.seq,
    sim_time_ms: metadata.sim_time_ms,
    captured_at: metadata.captured_at,
  };
  const form = new FormData();
  form.append(FRAME_METADATA_PART, JSON.stringify(canonical));
  form.append(FRAME_IMAGE_PART, new Blob([jpeg], { type: FRAME_CONTENT_TYPE }), FRAME_FILENAME);
  return form;
}

export type UploadOutcome =
  | { kind: 'response'; status: number; result: FrameIngestResult }
  | { kind: 'error'; status: number; code: string; message: string }
  | { kind: 'network'; message: string };

export async function uploadFrame(apiBase: string, metadata: FrameMetadata, jpeg: Blob, timeoutMs = 8000): Promise<UploadOutcome> {
  const form = buildFrameForm(metadata, jpeg);
  const url = `${apiBase}/api/v1/cameras/${encodeURIComponent(metadata.camera_id)}/frames`;
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { kind: 'network', message: (e as Error).message };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON: e.g. the dev proxy reporting the API is down.
  }
  if ((res.status === 200 || res.status === 202) && body && typeof body === 'object' && 'outcome' in body) {
    return { kind: 'response', status: res.status, result: body as FrameIngestResult };
  }
  if (res.status >= 500 && !(body && typeof body === 'object' && 'error' in body)) return { kind: 'network', message: `API unreachable (HTTP ${res.status})` };
  const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
  return { kind: 'error', status: res.status, code: error?.code ?? `http_${res.status}`, message: error?.message ?? res.statusText };
}
