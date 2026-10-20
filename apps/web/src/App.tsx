import type { Facility, ParkingSpace } from '@parkright/contracts';
import { isConfirmedAvailable } from '@parkright/contracts';
import { useEffect, useState } from 'react';
import { useLiveFacility } from './live.ts';
import { RecommendationPanel } from './RecommendationPanel.tsx';

export function App() {
  const [facilities, setFacilities] = useState<Facility[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/facilities')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`API answered ${r.status}`))))
      .then(setFacilities)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main>
      <header>
        <h1>ParkRight</h1>
        <p className="tagline">Find Parking</p>
      </header>
      {error && <p className="notice">Cannot reach the ParkRight API ({error}). Is it running on :8400?</p>}
      {selected ? (
        <FacilityView facilityId={selected} onBack={() => setSelected(null)} />
      ) : (
        <FacilityList facilities={facilities} onSelect={setSelected} />
      )}
    </main>
  );
}

function FacilityList({ facilities, onSelect }: { facilities: Facility[] | null; onSelect: (id: string) => void }) {
  if (!facilities) return <p className="muted">Loading monitored facilities…</p>;
  return (
    <ul className="facilities">
      {facilities.map((f) => (
        <li key={f.facility_id}>
          <button onClick={() => onSelect(f.facility_id)}>
            <strong>{f.name}</strong>
            {f.is_simulated && <span className="badge">Virtual environment — not a real car park</span>}
            <Counts counts={f.counts} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Counts({ counts }: { counts: Facility['counts'] }) {
  return (
    <span className="counts">
      <span className="open">{counts.open} open</span>
      <span className="occupied">{counts.occupied} occupied</span>
      <span className="uncertain">{counts.uncertain} uncertain</span>
    </span>
  );
}

interface Health {
  perception: { provider: string; version: string };
  inference: { phase?: string; inference_ready?: boolean; artifact_error?: string | null; thresholds?: { allow_open?: boolean } };
}

const DETECTOR_NAME: Record<string, string> = {
  'a2-fasterrcnn': 'A2 Faster R-CNN',
  'a0-nvidia-ssd300': 'A0 NVIDIA SSD300',
  'a0-test-stub': 'test stub',
  none: 'none (everything UNCERTAIN)',
};

/** Which detector the API runs and whether it is ready. Demo/debug information only. */
function DetectorStatus() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    const load = () => fetch('/api/v1/health').then((r) => (r.ok ? r.json() : null)).then(setHealth).catch(() => setHealth(null));
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, []);
  if (!health) return <p className="muted small" data-testid="detector-status">detector: status unavailable</p>;
  const i = health.inference;
  return (
    <p className="muted small" data-testid="detector-status">
      detector: {DETECTOR_NAME[health.perception.provider] ?? 'unknown'} · {i.inference_ready ? 'ready' : i.phase ?? 'unavailable'}
      {i.artifact_error ? ` (${i.artifact_error})` : ''}
      {i.thresholds ? ` · OPEN ${i.thresholds.allow_open ? 'enabled' : 'disabled'}` : ''}
    </p>
  );
}

const STATE_LABEL: Record<ParkingSpace['current_state'], string> = {
  OPEN: 'Open',
  OCCUPIED: 'Occupied',
  UNCERTAIN: 'Uncertain — not confirmed available',
};

/** A space a driver may be offered: confirmed open, fresh, and legal for a standard permit. */
const offerable = (s: ParkingSpace) => isConfirmedAvailable(s) && s.designation === 'standard';

function FacilityView({ facilityId, onBack }: { facilityId: string; onBack: () => void }) {
  const live = useLiveFacility(facilityId);
  const [choice, setChoice] = useState<string | null>(null);
  const chosen = live.spaces.find((s) => s.space_id === choice) ?? null;

  useEffect(() => {
    // A chosen space that stops being confirmed OPEN is withdrawn, not silently kept.
    if (chosen && !offerable(chosen)) setChoice(null);
  }, [chosen]);

  if (!live.facility) return <p className="muted">Connecting…</p>;
  const f = live.facility;
  const camera = f.cameras[0];
  const model = live.spaces.find((s) => s.model)?.model;

  return (
    <section>
      <button className="link" onClick={onBack}>← All facilities</button>
      <h2>{f.name}</h2>
      {f.is_simulated && <p className="badge">Virtual environment — not a real car park</p>}
      <div className="status">
        <Counts counts={f.counts} />
        <span className={`conn ${live.connection}`}>{live.connection === 'live' ? 'Live' : live.connection === 'connecting' ? 'Connecting…' : 'Reconnecting — showing nothing as available'}</span>
      </div>
      <p className="muted small">
        {camera?.camera_id}: {live.lastFrame ? `frame ${live.lastFrame.seq} received ${new Date(live.lastFrame.received_at).toLocaleTimeString()}` : 'no frames yet'}
        {' · '}perception: {model ? (model.provider === 'none' ? 'no detector connected (everything UNCERTAIN)' : `${model.provider}@${model.version}`) : '—'}
      </p>
      <DetectorStatus />

      {f.levels.map((level) => (
        <div key={level.level_id} className="level">
          <h3>{level.name}</h3>
          <svg viewBox="0 0 100 100" className="plan" role="img" aria-label={`${level.name} plan`}>
            {live.spaces
              .filter((s) => s.level_id === level.level_id)
              .map((s) => (
                <g
                  key={s.space_id}
                  className={`space ${s.current_state.toLowerCase()}${offerable(s) ? ' selectable' : ''}${choice === s.space_id ? ' chosen' : ''}`}
                  onClick={() => offerable(s) && setChoice(s.space_id)}
                >
                  <title>{`${s.space_id}: ${STATE_LABEL[s.current_state]}${s.stale ? ' (stale)' : ''}`}</title>
                  <rect x={s.plan.x * 100} y={s.plan.y * 100} width={s.plan.w * 100} height={s.plan.h * 100} rx={1.5} />
                  <text x={(s.plan.x + s.plan.w / 2) * 100} y={(s.plan.y + s.plan.h / 2) * 100}>
                    {s.space_id}
                  </text>
                  {s.current_state === 'UNCERTAIN' && (
                    <text className="q" x={(s.plan.x + s.plan.w / 2) * 100} y={(s.plan.y + s.plan.h / 2) * 100 + 6}>?</text>
                  )}
                </g>
              ))}
          </svg>
        </div>
      ))}

      <div className="choice">
        {chosen ? (
          <>
            <strong>Space {chosen.space_id}</strong> on {f.levels.find((l) => l.level_id === chosen.level_id)?.name} is open.
            <button disabled title="Navigation is not built yet">Navigate</button>
          </>
        ) : f.counts.open > 0 ? (
          'Choose a green space.'
        ) : (
          'No space is confirmed available right now. Uncertain spaces are not offered.'
        )}
      </div>
      <RecommendationPanel facility={f} spaces={live.spaces} connection={live.connection}
        observedAt={live.lastFrame?.received_at ?? null} />
    </section>
  );
}
