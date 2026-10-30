/**
 * The hackathon demo screen (shown when the API runs in demo mode).
 *
 *   1 class context → 2 camera → 3 A2 detections → 4 bay states → 5 garage comparison
 *   → 6 Nemotron (or labelled local fallback) → 7 the result: garage, level, space, walk.
 * Shown as the compact flow Camera → NVIDIA A2 → Space state → ParkRight (data-step keeps 1–7).
 *
 * Camera, detections and bay states are live (latest frame + WebSocket). Garage
 * candidates, walking times and availability are the demo fixture and are labelled
 * simulated. Flags: ?record=1 hides debug detail, ?autoplay=1 asks for the
 * recommendation once the camera has fresh evidence, ?tech=1 opens "How it works".
 */
import type { ParkingSpace } from '@parkright/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveFacility } from '../live.ts';
import { type DemoRecommendation, type DemoStatus, type Scenario, flags, requestRecommendation, useDemoStatus, useEvents } from './api.ts';
import { PipelineFlow } from './Flow.tsx';
import { EventFeed, LiveGarageCard, liveCounts, ShowcaseCameraCard } from './Showcase.tsx';
import './demo.css';

type Phase = 'idle' | 'loading' | 'done' | 'error';

export function DemoApp({ scenario }: { scenario: Scenario }) {
  const opts = useMemo(() => flags(), []);
  const status = useDemoStatus();
  const live = useLiveFacility(scenario.simulator.facility_id);
  const [phase, setPhase] = useState<Phase>('idle');
  const [rec, setRec] = useState<DemoRecommendation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tech, setTech] = useState(opts.tech);
  const epoch = useRef<number | null>(null);
  const wsUpdates = useRef(0);

  const s = status && status !== 'down' ? status : null;
  const showcase = !!s?.showcase;
  const events = useEvents(20);

  // A demo reset (new epoch) clears the result so the next take starts clean.
  useEffect(() => {
    if (!s) return;
    if (epoch.current !== null && epoch.current !== s.epoch) {
      setPhase('idle');
      setRec(null);
      setError(null);
    }
    epoch.current = s.epoch;
  }, [s?.epoch]);

  useEffect(() => {
    if (live.lastFrame) wsUpdates.current += 1;
  }, [live.lastFrame?.seq, live.lastFrame?.received_at]);

  const ask = async () => {
    setPhase('loading');
    setError(null);
    try {
      const r = await requestRecommendation();
      setRec(r);
      setPhase('done');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  };

  const cameraReady = !!s?.camera.fresh && !!s.camera.last_frame && s.perception.loaded;
  useEffect(() => {
    if (opts.autoplay && phase === 'idle' && cameraReady && (s?.frames_since_reset ?? 0) >= 2) void ask();
  }, [opts.autoplay, phase, cameraReady, s?.frames_since_reset]);

  const detections = s?.camera.last_frame?.detections ?? [];
  const occupied = live.spaces.filter((x) => x.current_state === 'OCCUPIED');
  const step =
    phase === 'done' ? 7 : phase === 'loading' ? 6 : cameraReady && occupied.length ? 5 : occupied.length ? 4 : detections.length ? 3 : s?.camera.last_frame ? 2 : 1;

  return (
    <div className={`demo${opts.record ? ' record' : ''}${showcase ? ' showcase' : ''}`} data-step={step} data-phase={phase} data-ws={live.connection} data-updates={live.updates}>
      <header className="d-top">
        <div className="d-brand">
          <span className="d-mark" aria-hidden="true">M</span>
          <span className="d-word">Meri<b>dian</b></span>
          <span className="d-badge" data-testid="demo-badge">Demo mode · simulated data</span>
        </div>
        <div className="d-top-right">
          <ModeChip status={s} />
          <button className={`d-ghost${tech ? ' on' : ''}`} onClick={() => setTech(!tech)} aria-pressed={tech} data-testid="tech-toggle">
            How it works
          </button>
        </div>
      </header>

      <div className="d-flow">
        {/* Camera (frame) → A2 (detections) → space state (bays, comparison) → ParkRight (recommendation). */}
        <PipelineFlow active={step <= 2 ? 0 : step === 3 ? 1 : step <= 5 ? 2 : 3} />
      </div>

      {status === 'down' && <p className="d-alert" role="alert">The Meridian API is not answering. Run <code>npm run demo:check</code>.</p>}

      {tech && <TechView status={s} rec={rec} live={live.connection} wsUpdates={wsUpdates.current} record={opts.record} />}

      <main className="d-grid">
        <section className="d-col">
          <article className="d-card d-class" data-testid="class-card">
            <p className="d-label">Next class</p>
            <h1>
              <span className="tnum">{scenario.next_class.time}</span> · {scenario.next_class.destination}
            </h1>
            <p className="d-sub">
              Good morning, {scenario.student.name} · {scenario.next_class.course}
            </p>
          </article>

          {showcase && <LiveGarageCard spaces={live.spaces} changedAt={live.changedAt} connection={live.connection} status={s} debug={!opts.record} />}

          <article className="d-card" data-testid="comparison">
            <div className="d-card-head">
              <h2>Comparing garages near {scenario.next_class.destination_short}</h2>
              <span className="d-tag">Demo feed · simulated</span>
            </div>
            <ul className="d-garages">
              {(rec?.presentation.comparison ?? scenario.candidates.map((c) => ({
                facility_id: c.facility_id, name: c.name, walking_minutes: c.walking_minutes,
                available_spaces: c.demo_available_spaces, traffic: c.traffic, chosen: false,
              }))).map((g) => (
                <li key={g.facility_id} className={g.chosen ? 'chosen' : ''} data-testid={`garage-${g.facility_id}`}>
                  <strong>
                    {g.name}
                    {/* The live count belongs to Tuttle only when the live garage IS the Tuttle stand-in (34-space site). */}
                    {showcase && !s?.site && g.facility_id === scenario.camera_garage && (
                      <small className="d-live-label" data-testid="tuttle-live">
                        Simulated garage · live perception · {liveCounts(live.spaces).occupied}/{live.spaces.length} occupied
                      </small>
                    )}
                  </strong>
                  <span><b className="tnum">{g.walking_minutes}</b> min walk</span>
                  <span><b className="tnum">{g.available_spaces}</b> spaces confirmed</span>
                  <span className={`d-traffic ${g.traffic}`}>{g.traffic} traffic</span>
                </li>
              ))}
            </ul>
            <button className="d-primary" onClick={() => void ask()} disabled={!cameraReady || phase === 'loading'} data-testid="find-parking">
              {phase === 'loading'
                ? s?.nemotron.will_call_nemotron ? 'Asking NVIDIA Nemotron…' : 'Applying local fallback…'
                : !cameraReady ? 'Waiting for the live camera…' : phase === 'done' ? 'Ask again' : 'Find my parking'}
            </button>
          </article>

          <Result phase={phase} rec={rec} error={error} />
        </section>

        <section className="d-col">
          {showcase ? (
            <>
              <ShowcaseCameraCard status={s} spaces={live.spaces} />
              <EventFeed events={events} />
            </>
          ) : (
            <CameraCard status={s} spaces={live.spaces} />
          )}
        </section>
      </main>

      <footer className="d-foot">
        {scenario.disclaimer} Camera, detections and bay states are live from the simulator; OPEN detection stays disabled.
        {s?.site && ` The live garage is the ${s.site.title}: not an official or exact digital twin. The garage comparison and recommendation use the demo feed.`}
      </footer>
    </div>
  );
}

function ModeChip({ status }: { status: DemoStatus | null }) {
  if (!status) return <span className="d-chip">Connecting…</span>;
  const n = status.nemotron;
  if (n.will_call_nemotron) return <span className="d-chip live" data-testid="mode-chip">NVIDIA Nemotron · live</span>;
  if (n.mode === 'live') return <span className="d-chip warn" data-testid="mode-chip">Live requested · key missing · fallback</span>;
  return <span className="d-chip" data-testid="mode-chip">Local fallback mode</span>;
}

function Result({ phase, rec, error }: { phase: Phase; rec: DemoRecommendation | null; error: string | null }) {
  if (phase === 'error') return <article className="d-card d-result error" role="alert">Could not get a recommendation: {error}</article>;
  if (!rec) return null;
  const p = rec.presentation;
  if (!p.recommended)
    return (
      <article className="d-card d-result" data-testid="result">
        <h2>{p.headline}</h2>
        <p>{p.explanation}</p>
      </article>
    );
  return (
    <article className="d-card d-result" data-testid="result" aria-live="polite">
      <p className="d-label">Best parking</p>
      <h2 data-testid="result-garage">{p.garage}</h2>
      <p className="d-space" data-testid="result-space">
        {p.level} · Space {p.space_id}
      </p>
      <p className="d-walk" data-testid="result-walk">
        {p.walking_minutes}-minute walk to {p.destination}
      </p>
      <p className="d-why" data-testid="result-why">{p.explanation}</p>
      <p className={`d-source ${p.source}`} data-testid="result-source">{p.source_label}</p>
    </article>
  );
}

function CameraCard({ status, spaces }: { status: DemoStatus | null; spaces: ParkingSpace[] }) {
  const frame = status?.camera.last_frame ?? null;
  const polygons = status?.calibration ?? null;
  const stateOf = (id: string) => spaces.find((x) => x.space_id === id)?.current_state ?? 'UNCERTAIN';
  const p = status?.perception;
  return (
    <article className="d-card d-camera" data-testid="camera-card">
      <div className="d-card-head">
        <h2>Tuttle Garage camera</h2>
        <span className="d-tag">Simulated camera</span>
      </div>
      <div className="d-frame">
        {frame ? (
          <>
            <img src={`/api/v1/demo/camera/latest.jpg?seq=${frame.seq}`} alt="Latest frame from the simulated garage camera" width={1280} height={720} />
            <svg viewBox="0 0 1280 720" aria-hidden="true">
              {polygons &&
                Object.entries(polygons).map(([id, pts]) => (
                  <g key={id} className={`d-bay ${stateOf(id).toLowerCase()}`}>
                    <polygon points={pts.map((q) => `${q.x * 1280},${q.y * 720}`).join(' ')} />
                    <text x={pts.reduce((a, q) => a + q.x, 0) / pts.length * 1280} y={pts.reduce((a, q) => a + q.y, 0) / pts.length * 720}>{id}</text>
                  </g>
                ))}
              {frame.detections.map((d, i) => (
                <rect key={i} className="d-box" x={d.box[0]! * 1280} y={d.box[1]! * 720} width={(d.box[2]! - d.box[0]!) * 1280} height={(d.box[3]! - d.box[1]!) * 720} />
              ))}
            </svg>
          </>
        ) : (
          <p className="d-wait">Waiting for the first camera frame…</p>
        )}
      </div>
      <p className="d-detector" data-testid="detector-line">
        <span className={`d-dot ${p?.loaded ? 'ok' : ''}`} />
        {p ? (p.loaded ? 'A2 detector ready' : `A2 detector ${p.phase ?? 'unavailable'}`) : 'Detector status unavailable'}
        {frame && ` · ${frame.detections.length} vehicles detected · frame ${frame.seq}`}
        {p && ` · OPEN detection ${p.allow_open ? 'ENABLED' : 'disabled'}`}
      </p>
      <ul className="d-bays" data-testid="bay-states">
        {spaces.map((x) => (
          <li key={x.space_id} className={x.current_state.toLowerCase()} title={`${x.space_id}: ${x.current_state}`}>
            {x.space_id}
            <small>{x.current_state === 'OCCUPIED' ? 'Occupied' : x.current_state === 'OPEN' ? 'Open' : 'Uncertain'}</small>
          </li>
        ))}
      </ul>
      <p className="d-note">Bays that look empty stay Uncertain: Meridian never treats a missing detection as an open space.</p>
    </article>
  );
}

function TechView({ status, rec, live, wsUpdates, record }: { status: DemoStatus | null; rec: DemoRecommendation | null; live: string; wsUpdates: number; record: boolean }) {
  const f = status?.camera.last_frame;
  const nodes: [string, string][] = [
    ['Simulator camera', f ? `frame ${f.seq}` : 'waiting'],
    ['A2 perception', f ? `${f.detections.length} vehicles · ${Math.round(f.timings.total_ms ?? 0)} ms` : status?.perception.phase ?? '—'],
    ['Bay mapping', status ? `${status.camera.occupied.length} occupied · ${status.camera.uncertain.length} uncertain` : '—'],
    ['Live state', `WebSocket ${live} · ${wsUpdates} updates`],
    ['Grounded facts', '3 garages · demo feed (simulated)'],
    ['Nebius Token Factory', status?.nemotron.will_call_nemotron ? 'live' : 'not called'],
    ['NVIDIA Nemotron', rec ? (rec.result.provenance.status === 'success' ? `chose ${rec.presentation.garage}` : 'fallback used') : '—'],
    ['Validated result', rec?.presentation.recommended ? `${rec.presentation.level} · ${rec.presentation.space_id}` : '—'],
  ];
  return (
    <section className="d-tech" data-testid="tech-view" aria-label="How it works">
      <ol>
        {nodes.map(([k, v]) => (
          <li key={k}>
            <strong>{k}</strong>
            <span>{v}</span>
          </li>
        ))}
      </ol>
      {!record && rec && (
        <details>
          <summary>Facts sent to the recommender</summary>
          <pre>{JSON.stringify(rec.facts, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
