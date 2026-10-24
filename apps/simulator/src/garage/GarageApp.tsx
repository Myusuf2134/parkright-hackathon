/**
 * The 3D garage Vision Lab (?sim=garage). CAM-01 is the only image that reaches the API;
 * the observer view, calibration polygons, detections and ground-truth tints are DOM or
 * operator-layer overlays and never enter a perception JPEG.
 *
 * URL: ?sim=garage&scenario=entering&env=night&play=1&calib=1&record=1&demo=1
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ACESFilmicToneMapping, PCFShadowMap, PerspectiveCamera, SRGBColorSpace, WebGLRenderer } from 'three';
import { OPERATOR_LAYER } from '../scene/layers.ts';
import { STREAM_RATES, type FrameStreamer } from '../stream/streamer.ts';
import { GARAGE_BAYS } from './layout.ts';
import type { GarageLab } from './lab.ts';
import { GARAGE_PRESETS, GARAGE_PRESET_IDS, type GaragePresetId } from './presets.ts';
import { isScenarioId, SCENARIO_IDS, type ScenarioId } from './scenarios.ts';
import './garage.css';

interface Versioned { version: number; subscribe(fn: () => void): () => void }
const useVersion = (s: Versioned) => useSyncExternalStore((fn) => s.subscribe(fn), () => s.version);
function useTicker(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

const flag = (k: string) => new URLSearchParams(location.search).get(k) === '1';

export function GarageApp({ lab, streamer }: { lab: GarageLab; streamer: FrameStreamer }) {
  useVersion(lab.world);
  useVersion(streamer);
  useTicker(250);
  const record = useMemo(() => flag('record'), []);
  const demo = useMemo(() => flag('demo'), []);
  const [calib, setCalib] = useState(flag('calib'));
  const [dets, setDets] = useState(!record);
  const [truth, setTruth] = useState(false);
  const [observer, setObserver] = useState(!record && !demo);
  const feed = useRef<HTMLDivElement>(null);

  // Render loop: world time + CAM-01 preview.
  useEffect(() => {
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      lab.tick(now - last, now);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    feed.current?.prepend(lab.camera.canvas);
    document.body.dataset.labReady = '1';
    return () => cancelAnimationFrame(raf);
  }, [lab]);

  // Keep the URL in step so any view can be reproduced from its link.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    q.set('sim', 'garage');
    q.set('scenario', lab.world.spec.scenario);
    q.set('env', lab.world.spec.preset === 'clear_day' ? 'day' : lab.world.spec.preset);
    const url = `${location.pathname}?${q}`;
    if (url !== `${location.pathname}${location.search}`) history.replaceState(null, '', url);
  });

  const w = lab.world;
  const s = w.spec;
  const last = streamer.log[0];
  const info = streamer.health?.inference;
  const truthNow = truth ? w.truth() : null;
  const occupiedTruth = new Set(truthNow?.spaces.filter((x) => x.truth === 'occupied').map((x) => x.space_id));
  const polygons = streamer.health?.calibration?.polygons ?? null;
  const freshDets = info && last && info.frame_seq === last.seq && info.session_id === last.sessionId ? info.detections ?? [] : [];

  const loadScenario = (id: ScenarioId) => {
    lab.load(id);
    streamer.newSession();
  };

  return (
    <div className={`app garage-app${record ? ' record' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="logo">◩</span>
          <div>
            <h1>PARKRIGHT VISION LAB · 3D GARAGE</h1>
            <p>Simulated covered garage · Level L1 · 12 bays · CAM-01 corner CCTV</p>
          </div>
        </div>
        <div className="top-status">
          {demo && <span className="pill connected" data-testid="demo-badge"><i />DEMO MODE · FIXED SCENE</span>}
          <span className={`pill ${streamer.api}`} data-testid="api-status"><i />{streamer.api === 'connected' ? 'API CONNECTED' : streamer.api === 'disconnected' ? 'API DISCONNECTED' : 'API …'}</span>
          <span className="pill neutral">PERCEPTION&nbsp;<b>{streamer.health ? `${streamer.health.perception.provider}` : '—'}</b></span>
        </div>
      </header>

      <main className="g-work">
        <section className="g-stage">
          <div className="g-feed" ref={feed} data-testid="garage-feed">
            <svg className="g-overlay" viewBox="0 0 1280 720" aria-hidden="true">
              {calib && polygons && Object.entries(polygons).map(([id, pts]) => (
                <g key={id} className={`g-bay${occupiedTruth.has(id) ? ' truth' : ''}`}>
                  <polygon points={pts.map((p) => `${p.x * 1280},${p.y * 720}`).join(' ')} />
                  <text x={(pts.reduce((a, p) => a + p.x, 0) / pts.length) * 1280} y={(pts.reduce((a, p) => a + p.y, 0) / pts.length) * 720}>{id}</text>
                </g>
              ))}
              {!calib && truth && polygons && Object.entries(polygons).filter(([id]) => occupiedTruth.has(id)).map(([id, pts]) => (
                <polygon key={id} className="g-truth" points={pts.map((p) => `${p.x * 1280},${p.y * 720}`).join(' ')} />
              ))}
              {dets && freshDets.filter((d) => ['car', 'truck', 'bus'].includes(d.label)).map((d, i) => (
                <g key={i} className="g-det">
                  <rect x={d.box[0]! * 1280} y={d.box[1]! * 720} width={(d.box[2]! - d.box[0]!) * 1280} height={(d.box[3]! - d.box[1]!) * 720} />
                  <text x={d.box[0]! * 1280 + 4} y={d.box[1]! * 720 - 6}>{d.label} {d.confidence.toFixed(2)}</text>
                </g>
              ))}
            </svg>
            <div className="g-hud">
              <span>CAM-01</span>
              <span>{s.camera.width}×{s.camera.height} · JPEG</span>
              <span>{GARAGE_PRESETS[s.preset].label.toUpperCase()}</span>
              <span className="tnum">T+{(w.simTimeMs / 1000).toFixed(1)}s</span>
              {streamer.rate > 0 && <span className="rec">● {streamer.rate} FPS</span>}
            </div>
            {calib && <div className="g-calib-note">Calibration: {polygons ? `${Object.keys(polygons).length} bays projected from 3D corners` : 'API has no calibration'} · image 1280×720</div>}
          </div>
          {observer && <ObserverView lab={lab} />}
        </section>

        <aside className="g-side">
          <Panel title="SCENARIO">
            <label className="g-field">
              <span>Scenario</span>
              <select value={s.scenario} onChange={(e) => isScenarioId(e.target.value) && loadScenario(e.target.value)} data-testid="scenario-select">
                {SCENARIO_IDS.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </label>
            <p className="g-muted">{w.scenario.title}</p>
            <label className="g-field">
              <span>Lighting</span>
              <select value={s.preset} onChange={(e) => lab.world.setPreset(e.target.value as GaragePresetId)} data-testid="preset-select">
                {GARAGE_PRESET_IDS.map((id) => <option key={id} value={id}>{GARAGE_PRESETS[id].label}</option>)}
              </select>
            </label>
            <div className="g-row">
              <button onClick={() => (w.playing ? w.pause() : w.play())} data-testid="play">{w.playing ? 'Pause' : 'Play'}</button>
              <button onClick={() => { w.reset(); w.pause(); streamer.newSession(); }} data-testid="reset">Reset</button>
            </div>
            <input type="range" min={0} max={w.scenario.durationMs} step={100} value={w.simTimeMs} onChange={(e) => w.setTime(Number(e.target.value))} aria-label="Scenario time" data-testid="timeline" />
          </Panel>

          <Panel title="CAM-01 STREAM">
            <div className="g-row">
              {STREAM_RATES.map((r) => (
                <button key={r} className={streamer.rate === r ? 'on' : ''} onClick={() => streamer.setRate(r)} data-testid={`rate-${r}`}>{r === 0 ? 'OFF' : `${r} FPS`}</button>
              ))}
            </div>
            <button className="g-primary" onClick={() => void streamer.captureAndSend()} disabled={streamer.inFlight || !info?.inference_ready} data-testid="send-frame">Capture &amp; send</button>
            <dl className="g-stats">
              <dt>Session</dt><dd className="mono" data-testid="session-id">{streamer.sessionId}</dd>
              <dt>Last frame</dt><dd data-testid="last-status">{last ? `#${last.seq} ${last.status}` : '—'}</dd>
              <dt>Ingest</dt><dd>{last ? `${last.latencyMs} ms` : '—'}</dd>
              <dt>A2</dt><dd>{info?.timings?.total_ms ? `${Math.round(info.timings.total_ms)} ms · ${info.detection_count ?? 0} det` : info?.phase ?? '—'}</dd>
              <dt>Render</dt><dd>{lab.fps} fps preview</dd>
            </dl>
          </Panel>

          {!record && (
            <Panel title="OVERLAYS (DEBUG ONLY)">
              <label className="g-check"><input type="checkbox" checked={calib} onChange={(e) => setCalib(e.target.checked)} data-testid="calib-toggle" />Calibration polygons</label>
              <label className="g-check"><input type="checkbox" checked={dets} onChange={(e) => setDets(e.target.checked)} />A2 detections</label>
              <label className="g-check"><input type="checkbox" checked={truth} onChange={(e) => setTruth(e.target.checked)} data-testid="truth-toggle" />Ground truth (development)</label>
              <label className="g-check"><input type="checkbox" checked={observer} onChange={(e) => setObserver(e.target.checked)} />Observer view</label>
              <p className="g-muted">Overlays are drawn over the page, never into CAM-01's pixels.</p>
            </Panel>
          )}

          {truth && truthNow && (
            <Panel title="GROUND TRUTH · NOT SENT TO PERCEPTION">
              <ul className="g-truth-list" data-testid="truth-list">
                {GARAGE_BAYS.map((b) => <li key={b.id} className={occupiedTruth.has(b.id) ? 'occ' : ''}>{b.id}</li>)}
              </ul>
              <p className="g-muted">{truthNow.vehicles.length} vehicles · {truthNow.vehicles.filter((v) => v.moving).length} moving</p>
            </Panel>
          )}
        </aside>
      </main>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="g-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Free orbit camera over the same scene, with bay outlines (operator layer). Never ingested. */
function ObserverView({ lab }: { lab: GarageLab }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current!;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    el.appendChild(renderer.domElement);
    const cam = new PerspectiveCamera(50, 16 / 9, 0.1, 400);
    cam.position.set(27, 17, 31);
    cam.layers.enable(OPERATOR_LAYER);
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.target.set(9.8, 0, 10);
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.update();
    let raf = 0;
    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    const loop = () => {
      renderer.toneMappingExposure = lab.exposure;
      controls.update();
      renderer.render(lab.scene, cam);
      raf = requestAnimationFrame(loop);
    };
    resize();
    loop();
    addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [lab]);
  return (
    <div className="g-observer" ref={host} data-testid="observer-view">
      <span className="g-observer-label">OBSERVER VIEW · free camera · ceiling cut away · not sent to ParkRight</span>
    </div>
  );
}
