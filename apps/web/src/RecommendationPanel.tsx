import type { Facility, ParkingSpace } from '@parkright/contracts';
import { isConfirmedAvailable } from '@parkright/contracts';
import { useEffect, useRef, useState } from 'react';
import type { Connection } from './live.ts';

// Endpoint-local DTO: the occupancy/shared contract is deliberately unchanged.
interface Recommendation {
  recommendation: string;
  uncertainties: string[];
  expires_at: string;
  provenance: {
    provider: string;
    model: string;
    status: 'success' | 'fallback';
    latency_ms: number;
    fallback_reason: string | null;
  };
}

export function RecommendationPanel({ facility, spaces, connection, observedAt }: {
  facility: Facility; spaces: ParkingSpace[]; connection: Connection; observedAt: string | null;
}) {
  const [result, setResult] = useState<Recommendation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const available = spaces.filter((s) => isConfirmedAvailable(s) && s.designation === 'standard').length;
  const occupied = spaces.filter((s) => !s.stale && s.current_state === 'OCCUPIED').length;
  // Invalidate on evidence changes/disconnection, not simply a repeated frame with unchanged facts.
  const signature = JSON.stringify([facility.facility_id, facility.name, facility.is_simulated, connection,
    spaces.map((s) => [s.space_id, s.current_state, s.stale, s.designation])]);

  useEffect(() => {
    active.current?.abort();
    active.current = null;
    setResult(null);
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
    setError(null);
    try {
      const response = await fetch('/api/v1/recommendations', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facilities: [{
            facility_id: facility.facility_id, name: facility.name,
            total_spaces: spaces.length, available_spaces: available,
            occupancy_percentage: occupied / spaces.length * 100,
            is_simulated: facility.is_simulated,
            observed_at: observedAt,
          }],
        }),
      });
      if (!response.ok) throw new Error('Recommendation unavailable.');
      const data = await response.json() as Recommendation;
      if (!controller.signal.aborted && Date.parse(data.expires_at) > Date.now()) setResult(data);
      else if (!controller.signal.aborted) setError('No fresh confirmed availability. Uncertain spaces are not offered.');
    } catch {
      if (active.current === controller) setError('Recommendation unavailable. Check the live parking status.');
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) setBusy(false);
    }
  };

  return (
    <aside aria-label="Parking recommendation">
      <h3>Parking advice</h3>
      <p className="muted small">Advisory only. This does not detect occupancy, reserve a space, or change availability.</p>
      <button onClick={ask} disabled={busy || connection !== 'live' || !observedAt || spaces.length === 0}>
        {busy ? 'Requesting advice…' : 'Get recommendation'}
      </button>
      <div aria-live="polite">
        {error && <p>{error}</p>}
        {result && <>
          <p>{result.recommendation}</p>
          <p className="muted small">{result.uncertainties.join(' ')}</p>
          <p className="muted small">
            {result.provenance.status === 'success' ? 'Nemotron selection · grounded explanation' : 'Local fallback — not a Nemotron recommendation'}
            {' · '}{result.provenance.latency_ms} ms
          </p>
          <details><summary>Recommendation provenance</summary>
            <pre>{JSON.stringify(result.provenance, null, 2)}</pre>
          </details>
        </>}
      </div>
    </aside>
  );
}
