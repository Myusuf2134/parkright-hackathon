/** REST calls the driver app makes. All go through the same-origin /api proxy. */
import type { Facility, ParkingSpace } from '@parkright/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchScenario, type Scenario } from '../../demo/api.ts';

export type { Scenario };

export interface Health {
  status: string;
  perception: { provider: string; version: string };
  inference?: { phase: string | null; inference_ready: boolean };
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status}`);
  return (await r.json()) as T;
}

export type Load<T> = { state: 'loading' } | { state: 'ok'; value: T } | { state: 'error' };

/** Facilities, retried with backoff so a late API start still connects. */
export function useFacilities(): [Load<Facility[]>, () => void] {
  const [load, setLoad] = useState<Load<Facility[]>>({ state: 'loading' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      getJson<Facility[]>('/api/v1/facilities')
        .then((f) => alive && setLoad({ state: 'ok', value: f }))
        .catch(() => {
          if (!alive) return;
          attempt++;
          if (attempt >= 4) setLoad({ state: 'error' });
          timer = setTimeout(run, Math.min(5000, 600 * 2 ** attempt));
        });
    };
    run();
    return () => { alive = false; clearTimeout(timer); };
  }, [nonce]);
  return [load, useCallback(() => { setLoad({ state: 'loading' }); setNonce((n) => n + 1); }, [])];
}

export function useHealth(): Health | null {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => { getJson<Health>('/api/v1/health').then(setH).catch(() => setH(null)); }, []);
  return h;
}

/** Demo scenario, only served when the API runs in demo mode. null = not demo mode. */
export function useScenario(): Scenario | null | undefined {
  const [s, setS] = useState<Scenario | null | undefined>(undefined);
  useEffect(() => { void fetchScenario().then(setS); }, []);
  return s;
}

/** Fresh read of one space, used to recheck a space right before a trip starts. */
export async function fetchSpace(facilityId: string, spaceId: string, signal?: AbortSignal): Promise<ParkingSpace> {
  return getJson<ParkingSpace>(`/api/v1/facilities/${encodeURIComponent(facilityId)}/spaces/${encodeURIComponent(spaceId)}`, { signal });
}

// ---------- recommendation (endpoint-local DTOs, as in RecommendationPanel) ----------

export interface Advice {
  text: string;
  uncertainties: string[];
  expiresAt: number;
  source: 'nemotron' | 'fallback';
  model: string;
  fallbackReason: string | null;
}

export type AdviceState = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; advice: Advice } | { state: 'unavailable'; reason: string };

interface RecommendationResponse {
  result: {
    recommendation: string;
    uncertainties: string[];
    expires_at: string;
    provenance: { status: 'success' | 'fallback'; model: string; provider_reported_model: string | null; fallback_reason: string | null };
  };
}

const FALLBACK_TEXT: Record<string, string> = {
  no_confirmed_availability: 'No space is confirmed open, so Nemotron wasn’t asked.',
  missing_api_key: 'Nemotron isn’t configured on this server.',
  snapshot_expired: 'The occupancy evidence expired.',
};

/**
 * Advice for a facility. It resets whenever the evidence it was based on changes (signature),
 * and drops itself at expires_at. The browser sends no facts: the API builds them from its own state.
 */
export function useAdvice(facilityId: string | null, signature: string, enabled: boolean): AdviceState {
  const [st, setSt] = useState<AdviceState>({ state: 'idle' });
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    ctrl.current?.abort();
    if (!facilityId || !enabled) { setSt({ state: 'idle' }); return; }
    const c = new AbortController();
    ctrl.current = c;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; c.abort(); }, 12000);
    setSt({ state: 'loading' });
    fetch(`/api/v1/facilities/${encodeURIComponent(facilityId)}/recommendation`, { method: 'POST', signal: c.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as RecommendationResponse;
        const p = data.result.provenance;
        const expiresAt = Date.parse(data.result.expires_at);
        if (!(expiresAt > Date.now())) { setSt({ state: 'unavailable', reason: 'No fresh evidence to base advice on.' }); return; }
        setSt({
          state: 'ok',
          advice: {
            text: data.result.recommendation,
            uncertainties: data.result.uncertainties,
            expiresAt,
            source: p.status === 'success' ? 'nemotron' : 'fallback',
            model: p.provider_reported_model ?? p.model,
            fallbackReason: p.fallback_reason ? (FALLBACK_TEXT[p.fallback_reason] ?? p.fallback_reason) : null,
          },
        });
      })
      // An abort because the evidence changed is not a failure; a timeout or HTTP error is.
      .catch(() => { if (!c.signal.aborted || timedOut) setSt({ state: 'unavailable', reason: 'Advice isn’t available right now.' }); })
      .finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); c.abort(); };
  }, [facilityId, signature, enabled]);

  // Expire on time.
  useEffect(() => {
    if (st.state !== 'ok') return;
    const t = setTimeout(() => setSt({ state: 'idle' }), Math.max(0, st.advice.expiresAt - Date.now()));
    return () => clearTimeout(t);
  }, [st]);

  return st;
}
