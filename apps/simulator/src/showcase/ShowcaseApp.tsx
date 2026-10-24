/**
 * The 34-space garage showcase (?showcase=1&sim=garage). Four fixed CCTV cameras stream real
 * rendered frames into ParkRight; the facility state shown here comes back from the API over the
 * WebSocket. The observer camera, overlays and ground truth are presentation and debug only and
 * never enter a perception frame.
 *
 * URL: ?showcase=1&sim=garage&scenario=live&env=night&view=cam-02&present=1&stream=0
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ACESFilmicToneMapping, PCFShadowMap, PerspectiveCamera, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GARAGE_PRESET_IDS, GARAGE_PRESETS, parseGaragePreset, type GaragePresetId } from '../garage/presets.ts';
import { OPERATOR_LAYER } from '../scene/layers.ts';
import { OWNER_COLORS, type ShowcaseLab } from './lab.ts';
import { SHOWCASE_BAYS, SHOWCASE_CAMERAS, type ShowcaseCameraId } from './layout.ts';
import type { ShowcaseStreamer } from './streamer.ts';
import { isShowcaseScenario, SHOWCASE_SCENARIO_IDS, SHOWCASE_SCENARIOS, type ShowcaseScenarioId } from './traffic.ts';
import './showcase.css';

type View = 'observer' | 'cctv-grid' | ShowcaseCameraId;
type BayState = 'OPEN' | 'OCCUPIED' | 'UNCERTAIN';
interface Space { space_id: string; current_state: BayState; source_camera_id: string | null; last_observed_at: string | null }
interface PerceptionEvent { id: number; at: string; camera_id: string; seq: number; vehicles: number; a2_ms: number; changes: { space_id: string; from: string | null; to: string }[] }

interface Versioned { version: number; subscribe(fn: () => void): () => void }
const useVersion = (s: Versioned) => useSyncExternalStore((fn) => s.subscribe(fn), () => s.version);
const q = () => new URLSearchParams(location.search);

/** Live facility state from the API's WebSocket. Disconnected → every bay UNCERTAIN, never kept OPEN. */
function useFacility(facilityId = 'garage-01') {
  const [spaces, setSpaces] = useState<Record<string, Space>>({});
  const [changed, setChanged] = useState<Record<string, number>>({});
  const [live, setLive] = useState(false);
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/realtime?facility_id=${facilityId}`);
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data));
        setLive(true);
        setSpaces(Object.fromEntries((m.spaces as Space[]).map((s) => [s.space_id, s])));
        if (m.type === 'occupancy_update' && m.changes?.length) {
          const now = Date.now();
          setChanged((c) => ({ ...c, ...Object.fromEntries(m.changes.map((x: { space_id: string }) => [x.space_id, now])) }));
        }
      };
      ws.onclose = () => {
        setLive(false);
        setSpaces((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v, current_state: 'UNCERTAIN' as BayState }])));
        if (!closed) retry = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [facilityId]);
  return { spaces, changed, live };
}

/** Real perception events from the demo API (one per processed frame). */
function useEvents(onEpoch: () => void) {
  const [events, setEvents] = useState<PerceptionEvent[]>([]);
  const last = useRef(0);
  const epoch = useRef<number | null>(null);
  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetch(`/api/v1/demo/events?after=${last.current}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (!r) return;
      if (epoch.current !== null && r.epoch !== epoch.current) {
        last.current = 0;
        setEvents([]);
        onEpoch();
      }
      epoch.current = r.epoch;
      if (r.events.length) {
        last.current = r.events.at(-1).id;
        setEvents((e) => [...e, ...r.events].slice(-20));
      }
    }, 1000);
    return () => clearInterval(t);
  }, [onEpoch]);
  return events;
}

const QUICK_VIEWS: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  Overview: { pos: [42, 30, 52], target: [12, 0, 19] },
  Entrance: { pos: [-16, 6, 4], target: [6, 0, 10] },
  'Row A': { pos: [13, 9, 13], target: [13, 0, 2.5] },
  'Row B': { pos: [13, 9, 4], target: [11, 0, 15.5] },
  'Row C': { pos: [13, 9, 32], target: [11, 0, 21] },
  'Row D': { pos: [13, 9, 22], target: [13, 0, 33.5] },
  'CCTV overview': { pos: [13, 48, 19.5], target: [13, 0, 19.2] },
};

export function ShowcaseApp({ lab, streamer }: { lab: ShowcaseLab; streamer: ShowcaseStreamer }) {
  useVersion(lab.world);
  useVersion(streamer);
  const [present, setPresent] = useState(q().get('present') === '1');
  const initialView = (q().get('view') as View) ?? 'observer';
  const [view, setView] = useState<View>(['observer', 'cctv-grid', ...SHOWCASE_CAMERAS.map((c) => c.id)].includes(initialView) ? initialView : 'observer');
  const [boxes, setBoxes] = useState(true);
  const [polys, setPolys] = useState(true);
  const [owners, setOwners] = useState(false);
  const [truth, setTruth] = useState(false);
  const facility = useFacility();
  const onEpoch = useMemo(() => () => streamer.newSessions(), [streamer]);
  const events = useEvents(onEpoch);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  // Animation loop: world time; CCTV previews are drawn by <CctvView>/<Thumb> on their own schedule.
  useEffect(() => {
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      lab.tick(now - last, now);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    document.body.dataset.labReady = '1';
    return () => cancelAnimationFrame(raf);
  }, [lab]);

  // Keep the URL reproducible.
  useEffect(() => {
    const u = q();
    u.set('showcase', '1');
    u.set('sim', 'garage');
    u.set('scenario', lab.world.spec.scenario);
    u.set('env', lab.world.spec.preset === 'clear_day' ? 'day' : lab.world.spec.preset);
    u.set('view', view);
    if (present) u.set('present', '1');
    else u.delete('present');
    const url = `${location.pathname}?${u}`;
    if (url !== `${location.pathname}${location.search}`) history.replaceState(null, '', url);
  });

  const spaces = Object.values(facility.spaces);
  const counts = {
    total: SHOWCASE_BAYS.length,
    occupied: spaces.filter((s) => s.current_state === 'OCCUPIED').length,
    uncertain: spaces.filter((s) => s.current_state === 'UNCERTAIN').length,
    open: spaces.filter((s) => s.current_state === 'OPEN').length,
  };
  if (spaces.length < SHOWCASE_BAYS.length) counts.uncertain += SHOWCASE_BAYS.length - spaces.length;
  const truthNow = truth ? new Set(lab.world.truth().spaces.filter((s) => s.truth === 'occupied').map((s) => s.space_id)) : null;
  const w = lab.world;
  const loadScenario = (id: ShowcaseScenarioId) => {
    lab.load(id);
    streamer.newSessions();
  };

  return (
    <div className={`sc-app ${present ? 'present' : 'engineering'}`} data-mode={present ? 'present' : 'engineering'}>
      <header className="sc-top">
        <div className="sc-brand">
          <span className="sc-mark">P</span>
          <div>
            <h1>ParkRight · Live garage</h1>
            <p>Simulated 34-space garage · 4 CCTV cameras · live A2 perception</p>
          </div>
        </div>
        <div className="sc-top-right">
          <span className={`sc-pill ${streamer.api === 'connected' ? 'ok' : 'bad'}`} data-testid="api-status">{streamer.api === 'connected' ? 'API connected' : 'API not connected'}</span>
          <span className={`sc-pill ${streamer.ready ? 'ok' : ''}`}>A2 {streamer.ready ? 'ready' : streamer.health?.inference?.phase ?? '…'}</span>
          <span className="sc-pill">OPEN disabled</span>
          <button className="sc-btn" onClick={() => setPresent(!present)} data-testid="mode-toggle">{present ? 'Engineering view' : 'Presentation view'}</button>
        </div>
      </header>

      <main className="sc-main">
        <section className="sc-stage">
          <nav className="sc-tabs" aria-label="Camera">
            {(['observer', ...SHOWCASE_CAMERAS.map((c) => c.id), ...(present ? [] : ['cctv-grid'])] as View[]).map((v) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)} data-testid={`view-${v}`}>
                {v === 'observer' ? 'Observer' : v === 'cctv-grid' ? 'All CCTV' : v.toUpperCase()}
              </button>
            ))}
          </nav>
          {view === 'observer' && <Observer lab={lab} owners={owners} />}
          {view === 'cctv-grid' && (
            <div className="sc-grid">
              {SHOWCASE_CAMERAS.map((c) => <CctvView key={c.id} lab={lab} streamer={streamer} id={c.id} spaces={facility.spaces} boxes={boxes} polys={polys} truth={truthNow} small />)}
            </div>
          )}
          {view !== 'observer' && view !== 'cctv-grid' && (
            <CctvView lab={lab} streamer={streamer} id={view} spaces={facility.spaces} boxes={boxes || present} polys={polys || present} truth={truthNow} />
          )}
          <div className="sc-thumbs">
            {SHOWCASE_CAMERAS.map((c) => <Thumb key={c.id} lab={lab} streamer={streamer} id={c.id} active={view === c.id} onClick={() => setView(c.id)} />)}
          </div>
        </section>

        <aside className="sc-side">
          <section className="sc-card sc-counts" data-testid="facility-counts">
            <div><b className="tnum">{counts.total}</b><span>spaces</span></div>
            <div className="occ"><b className="tnum" data-testid="count-occupied">{counts.occupied}</b><span>occupied</span></div>
            <div className="unc"><b className="tnum" data-testid="count-uncertain">{counts.uncertain}</b><span>uncertain</span></div>
            <div className="opn"><b className="tnum">{counts.open}</b><span>open</span></div>
            <p className="sc-note">{facility.live ? 'Live from ParkRight over WebSocket' : 'Reconnecting: showing everything uncertain'}{truthNow ? ` · truth: ${truthNow.size} occupied` : ''}</p>
          </section>

          <section className="sc-card">
            <GarageMap spaces={facility.spaces} changed={facility.changed} truth={truthNow} debug={!present} />
          </section>

          <section className="sc-card sc-controls">
            <label>
              <span>Scenario</span>
              <select value={w.spec.scenario} onChange={(e) => isShowcaseScenario(e.target.value) && loadScenario(e.target.value)} data-testid="scenario-select">
                {SHOWCASE_SCENARIO_IDS.map((id) => <option key={id} value={id}>{SHOWCASE_SCENARIOS[id].title}</option>)}
              </select>
            </label>
            <label>
              <span>Lighting</span>
              <select value={w.spec.preset} onChange={(e) => w.setPreset(e.target.value as GaragePresetId)} data-testid="preset-select">
                {GARAGE_PRESET_IDS.map((id) => <option key={id} value={id}>{GARAGE_PRESETS[id].label}</option>)}
              </select>
            </label>
            <div className="sc-row">
              <button className="sc-btn" onClick={() => (w.playing ? w.pause() : w.play())} data-testid="play">{w.playing ? 'Pause traffic' : 'Play traffic'}</button>
              <button className="sc-btn" onClick={() => { w.reset(); streamer.newSessions(); }} data-testid="reset">Restart</button>
              <button className={`sc-btn ${streamer.running ? 'on' : ''}`} onClick={() => streamer.setRunning(!streamer.running)} data-testid="stream-toggle">
                {streamer.running ? 'Perception on' : 'Perception off'}
              </button>
            </div>
            <p className="sc-note tnum">T+{fmt(w.simTimeMs)} · {w.vehicles().filter((v) => v.moving).length} moving · {w.vehicles().length} vehicles</p>
          </section>

          <CameraStatus streamer={streamer} compact={present} />

          <section className="sc-card sc-events" data-testid="event-feed">
            <h2>Live events</h2>
            <ol>
              {[...events].reverse().slice(0, present ? 8 : 20).map((e) => (
                <li key={e.id}>
                  <time>{new Date(e.at).toLocaleTimeString()}</time>
                  <span>{e.camera_id.toUpperCase()} · {e.vehicles} vehicle{e.vehicles === 1 ? '' : 's'}{present ? '' : ` · ${e.a2_ms} ms`}</span>
                  {e.changes.map((c) => <em key={c.space_id} className={c.to.toLowerCase()}>{c.space_id} → {c.to}</em>)}
                </li>
              ))}
              {!events.length && <li className="sc-note">Waiting for the first processed frame…</li>}
            </ol>
          </section>

          {!present && (
            <section className="sc-card sc-debug" data-testid="engineering-panel">
              <h2>Engineering</h2>
              <label><input type="checkbox" checked={boxes} onChange={(e) => setBoxes(e.target.checked)} />A2 boxes</label>
              <label><input type="checkbox" checked={polys} onChange={(e) => setPolys(e.target.checked)} />Calibration polygons</label>
              <label><input type="checkbox" checked={owners} onChange={(e) => setOwners(e.target.checked)} />Camera owner regions (observer)</label>
              <label><input type="checkbox" checked={truth} onChange={(e) => setTruth(e.target.checked)} data-testid="truth-toggle" />Ground truth (development only)</label>
              <p className="sc-note tnum">Simulation {lab.fps} fps · perception {streamer.running ? 'on' : 'off'} · {streamer.health?.perception.provider ?? '—'}</p>
              <p className="sc-note">Ground truth is drawn here only. It is never uploaded and cannot change ParkRight's state.</p>
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms / 1000) % 60)).padStart(2, '0')}`;

function CameraStatus({ streamer, compact }: { streamer: ShowcaseStreamer; compact: boolean }) {
  return (
    <section className="sc-card sc-cams" data-testid="camera-status">
      <h2>CCTV</h2>
      <table>
        <tbody>
          {SHOWCASE_CAMERAS.map((c) => {
            const s = streamer.streams.get(c.id)!;
            const age = s.last ? (Date.now() - s.last.at) / 1000 : null;
            return (
              <tr key={c.id} data-testid={`cam-row-${c.id}`}>
                <th><i style={{ background: OWNER_COLORS[c.id] }} />{c.label}</th>
                <td>row {c.row}</td>
                <td className="tnum">{s.last ? `${s.last.detections.filter((d) => d.confidence >= 0.65).length} veh` : '—'}</td>
                <td className="tnum">{s.last?.a2Ms != null ? `${s.last.a2Ms} ms` : '—'}</td>
                {!compact && <td className="tnum">#{s.last?.seq ?? '—'} {s.last?.status ?? ''}</td>}
                <td className={`tnum ${age !== null && age < 10 ? 'fresh' : 'stale'}`}>{age === null ? 'no frame' : `${age.toFixed(0)} s ago`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** One CCTV camera: its rendered feed (the same pixels that are uploaded), with DOM overlays. */
function CctvView({ lab, streamer, id, spaces, boxes, polys, truth, small }: {
  lab: ShowcaseLab; streamer: ShowcaseStreamer; id: ShowcaseCameraId; spaces: Record<string, Space>; boxes: boolean; polys: boolean; truth: Set<string> | null; small?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = SHOWCASE_CAMERAS.find((c) => c.id === id)!;
  useEffect(() => {
    const ctx = canvas.current!.getContext('2d')!;
    const t = setInterval(() => {
      lab.render(id);
      ctx.drawImage(lab.canvas(id), 0, 0, canvas.current!.width, canvas.current!.height);
    }, small ? 250 : 66);
    return () => clearInterval(t);
  }, [lab, id, small]);
  const s = streamer.streams.get(id)!;
  const cal = streamer.health?.calibration?.cameras?.[id];
  return (
    <figure className={`sc-cctv${small ? ' small' : ''}`} data-testid={`cctv-${id}`}>
      <canvas ref={canvas} width={small ? 640 : 1280} height={small ? 360 : 720} />
      <svg viewBox="0 0 1280 720" aria-hidden="true">
        {polys && cal && Object.entries(cal.polygons).map(([bay, pts]) => {
          const st = spaces[bay]?.current_state ?? 'UNCERTAIN';
          return (
            <g key={bay} className={`sc-poly ${st.toLowerCase()}${truth?.has(bay) ? ' truth' : ''}`}>
              <polygon points={pts.map((p) => `${p.x * 1280},${p.y * 720}`).join(' ')} />
              <text x={(pts.reduce((a, p) => a + p.x, 0) / pts.length) * 1280} y={(pts.reduce((a, p) => a + p.y, 0) / pts.length) * 720}>{bay}</text>
            </g>
          );
        })}
        {boxes && s.last?.detections.filter((d) => d.confidence >= 0.3).map((d, i) => (
          <g key={i} className={`sc-box${d.confidence >= 0.65 ? '' : ' weak'}`}>
            <rect x={d.box[0]! * 1280} y={d.box[1]! * 720} width={(d.box[2]! - d.box[0]!) * 1280} height={(d.box[3]! - d.box[1]!) * 720} />
            <text x={d.box[0]! * 1280 + 4} y={d.box[1]! * 720 - 6}>{d.label} {d.confidence.toFixed(2)}</text>
          </g>
        ))}
      </svg>
      <figcaption>
        <b>{cam.label}</b>
        <span>row {cam.row} · {SHOWCASE_BAYS.filter((b) => b.owner === id).map((b) => b.id).join(' ')}</span>
        <span className="tnum">{s.last ? `#${s.last.seq} ${s.last.status} · A2 ${s.last.a2Ms ?? '—'} ms · ingest ${s.last.ingestMs} ms` : 'no frame yet'}</span>
      </figcaption>
    </figure>
  );
}

function Thumb({ lab, streamer, id, active, onClick }: { lab: ShowcaseLab; streamer: ShowcaseStreamer; id: ShowcaseCameraId; active: boolean; onClick: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = canvas.current!.getContext('2d')!;
    // Thumbnails mostly reuse the camera's last rendered pixels (its frames are rendered when captured).
    let n = 0;
    const t = setInterval(() => {
      if (n++ % 4 === 0) lab.render(id);
      ctx.drawImage(lab.canvas(id), 0, 0, 256, 144);
    }, 750);
    return () => clearInterval(t);
  }, [lab, id]);
  const s = streamer.streams.get(id)!;
  return (
    <button className={`sc-thumb${active ? ' on' : ''}`} onClick={onClick} data-testid={`thumb-${id}`}>
      <canvas ref={canvas} width={256} height={144} />
      <span>{id.toUpperCase()} · {s.last ? `${s.last.occupied.length} occ` : '—'}</span>
    </button>
  );
}

/** Free orbit camera with quick views. Never captured, never uploaded. */
function Observer({ lab, owners }: { lab: ShowcaseLab; owners: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ go(name: string): void; owners(on: boolean): void } | null>(null);
  useEffect(() => {
    const el = host.current!;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    el.prepend(renderer.domElement);
    const cam = new PerspectiveCamera(50, 16 / 9, 0.1, 500);
    const controls = new OrbitControls(cam, renderer.domElement);
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.enableDamping = true;
    const first = QUICK_VIEWS.Overview!;
    cam.position.set(...first.pos);
    controls.target.set(...first.target);
    let tween: { from: Vector3; to: Vector3; tf: Vector3; tt: Vector3; start: number } | null = null;
    api.current = {
      go(name) {
        const v = QUICK_VIEWS[name]!;
        tween = { from: cam.position.clone(), to: new Vector3(...v.pos), tf: controls.target.clone(), tt: new Vector3(...v.target), start: performance.now() };
      },
      owners(on) {
        if (on) cam.layers.enable(OPERATOR_LAYER);
        else cam.layers.disable(OPERATOR_LAYER);
      },
    };
    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight, false);
      cam.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      cam.updateProjectionMatrix();
    };
    let raf = 0;
    let lastFrame = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      // 30 fps is plenty for the observer and leaves CPU/GPU for A2 on the same machine.
      if (now - lastFrame < 1000 / 31) return;
      lastFrame = now;
      if (tween) {
        const u = Math.min(1, (now - tween.start) / 900);
        const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
        cam.position.lerpVectors(tween.from, tween.to, e);
        controls.target.lerpVectors(tween.tf, tween.tt, e);
        if (u >= 1) tween = null;
      }
      controls.update();
      renderer.toneMappingExposure = lab.exposure;
      renderer.render(lab.scene, cam);
    };
    resize();
    raf = requestAnimationFrame(loop);
    addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [lab]);
  useEffect(() => api.current?.owners(owners), [owners]);
  return (
    <div className="sc-observer" ref={host} data-testid="observer-view">
      <span className="sc-label">Observer · not sent to ParkRight</span>
      <div className="sc-quick">
        {Object.keys(QUICK_VIEWS).map((n) => <button key={n} onClick={() => api.current?.go(n)} data-testid={`quick-${n}`}>{n}</button>)}
      </div>
    </div>
  );
}

/** Compact 34-bay map of the live facility state; changed bays flash briefly. */
export function GarageMap({ spaces, changed, truth, debug }: { spaces: Record<string, Space>; changed: Record<string, number>; truth: Set<string> | null; debug: boolean }) {
  const now = Date.now();
  return (
    <div className="sc-map" data-testid="garage-map">
      {(['A', 'B', 'C', 'D'] as const).map((row) => (
        <div key={row} className={`sc-maprow row-${row}`}>
          {SHOWCASE_BAYS.filter((b) => b.row === row).map((b) => {
            const s = spaces[b.id];
            const st = (s?.current_state ?? 'UNCERTAIN').toLowerCase();
            const flash = changed[b.id] && now - changed[b.id]! < 2500;
            return (
              <span key={b.id} className={`sc-bay ${st}${flash ? ' flash' : ''}${truth?.has(b.id) ? ' truth' : ''}`} title={`${b.id}: ${s?.current_state ?? 'UNCERTAIN'}${s?.source_camera_id ? ` · ${s.source_camera_id}` : ''}`} data-bay={b.id} data-state={st}>
                {b.id}
                {debug && <small>{(s?.source_camera_id ?? b.owner).replace('cam-0', 'C')}</small>}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function parseShowcaseUrl() {
  const u = q();
  const scenario = isShowcaseScenario(u.get('scenario') ?? '') ? (u.get('scenario') as ShowcaseScenarioId) : 'live';
  const preset = parseGaragePreset(u.get('env')) ?? 'clear_day';
  return { scenario, preset, stream: u.get('stream') !== '0' };
}
