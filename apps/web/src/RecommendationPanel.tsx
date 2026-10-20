import type { Facility, ParkingSpace } from '@parkright/contracts';
import { useEffect, useRef, useState } from 'react';
import type { Connection } from './live.ts';

// Endpoint-local DTOs: the occupancy/shared contract is deliberately unchanged.
interface Recommendation {
  facility_id: string | null;
  recommendation: string;
  uncertainties: string[];
  expires_at: string;
  provenance: {
    provider: string;
    model: string;
    status: 'success' | 'fallback';
    attempted: boolean;
    latency_ms: number;
    fallback_reason: string | null;
    provider_reported_model: string | null;
  };
}

interface Facts {
  facilities: {
    facility_id: string; total_spaces: number; available_spaces: number | null;
    occupancy_percentage: number | null; observed_at: string; is_simulated: boolean;
  }[];
}

interface RecommenderStatus { provider: string; model: string; configured: boolean }

const FALLBACK_TEXT: Record<string, string> = {
  no_confirmed_availability: 'no space is confirmed available, so Nemotron was not asked',
  missing_api_key: 'Nebius is not configured on the API',
  snapshot_expired: 'the occupancy evidence expired',
};

export function RecommendationPanel({ facility, spaces, connection, observedAt }: {
  facility: Facility; spaces: ParkingSpace[]; connection: Connection; observedAt: string | null;
}) {
  const [result, setResult] = useState<Recommendation | null>(null);
  const [facts, setFacts] = useState<Facts | null>(null);
  const [status, setStatus] = useState<RecommenderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  // Invalidate on evidence changes/disconnection, not simply a repeated frame with unchanged facts.
  const signature = JSON.stringify([facility.facility_id, facility.name, facility.is_simulated, connection,
    spaces.map((s) => [s.space_id, s.current_state, s.stale, s.designation])]);

  useEffect(() => {
    fetch('/api/v1/recommendations/status').then((r) => (r.ok ? r.json() : null)).then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    active.current?.abort();
    active.current = null;
    setResult(null);
    setFacts(null);
    setBusy(false);
    setError(null);
    return () => { active.current?.abort(); active.current = null; };
  }, [signature]);

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), Math.max(0, Date.parse(result.expires_at) - Date.now()));
    return () => clearTimeout(timer);
  }, [result]);

  const ask = async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const timeout = setTimeout(() => controller.abort(), 10000);
    setBusy(true);
    setResult(null);
    setFacts(null);
    setError(null);
    try {
      // The API assembles the facts from its own occupancy state; the browser sends none.
      const response = await fetch(`/api/v1/facilities/${encodeURIComponent(facility.facility_id)}/recommendation`, {
        method: 'POST', signal: controller.signal,
      });
      if (!response.ok) throw new Error('Recommendation unavailable.');
      const data = await response.json() as { facts: Facts; result: Recommendation };
      if (controller.signal.aborted) return;
      setFacts(data.facts);
      if (Date.parse(data.result.expires_at) > Date.now()) setResult(data.result);
      else setError('No fresh confirmed availability. Uncertain spaces are not offered.');
    } catch {
      if (active.current === controller) setError('Recommendation unavailable. Check the live parking status.');
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) setBusy(false);
    }
  };

  const p = result?.provenance;
  return (
    <aside aria-label="Parking recommendation">
      <h3>Parking advice</h3>
      <p className="muted small">Advisory only. This does not detect occupancy, reserve a space, or change availability.</p>
      <p className="muted small" data-testid="recommender-status">
        Recommender: {status ? `${status.model} via ${status.provider} · ${status.configured ? 'configured' : 'not configured — local fallback only'}` : 'status unavailable'}
      </p>
      <button onClick={ask} disabled={busy || connection !== 'live' || !observedAt || spaces.length === 0}>
        {busy ? 'Requesting advice…' : 'Get recommendation'}
      </button>
      <div aria-live="polite" data-testid="recommendation">
        {error && <p>{error}</p>}
        {result && p && <>
          <p>{result.recommendation}</p>
          <p className="muted small">{result.uncertainties.join(' ')}</p>
          <p className="muted small" data-testid="recommendation-source">
            {p.status === 'success'
              ? `Nemotron selection (${p.provider_reported_model ?? p.model}) · grounded explanation`
              : `Local fallback — not a Nemotron recommendation (${FALLBACK_TEXT[p.fallback_reason ?? ''] ?? p.fallback_reason})`}
            {' · '}{p.latency_ms} ms
          </p>
          <details><summary>Recommendation provenance and facts sent</summary>
            <pre>{JSON.stringify({ provenance: p, facts }, null, 2)}</pre>
          </details>
        </>}
      </div>
    </aside>
  );
}
