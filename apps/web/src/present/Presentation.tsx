/**
 * Hackathon presentation: what the student sees (the real V5 app, embedded unchanged from /app/)
 * beside what ParkRight's AI sees (camera, A2 detections, bay ownership, space state).
 *
 *   /present/               split demo (default): 60% student app, 40% live AI
 *   /present/?mode=student  the student app on its own, with a short tour
 *   /present/?mode=ai       the live AI pipeline on its own
 *
 * Both halves read the same API: the embedded app opens its own WebSocket to the same facility, and
 * this page reads the same facility's WebSocket, demo status and perception events. Nothing here
 * sets a space state; an OPEN space appears only if the API reports one.
 */
import type { ParkingSpace } from '@parkright/contracts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PipelineFlow } from '../demo/Flow.tsx';
import { type DemoStatus, type PerceptionEvent, useDemoStatus, useEvents } from '../demo/api.ts';
import { summarize } from '../driver/lib/evidence.ts';
import { DETECTOR_LABEL, detectorKind, type DetectorKind } from '../driver/lib/names.ts';
import { ago, useNow } from '../driver/lib/time.ts';
import { useFacilities, useScenario } from '../driver/net/api.ts';
import { type LiveView, useLiveFacility } from '../driver/net/live.ts';
import { cameraTone, median, type Mode, modeFrom, ownedRange, seconds, siteHeadline, STATE_WORD, tally, type Tally } from './model.ts';

const MODES: { id: Mode; label: string }[] = [
  { id: 'student', label: 'Student' },
  { id: 'split', label: 'Split demo' },
  { id: 'ai', label: 'Live AI' },
];

export function Presentation() {
  const [mode, setModeState] = useState<Mode>(() => modeFrom(location.search));
  const setMode = (m: Mode) => {
    setModeState(m);
    const q = new URLSearchParams(location.search);
    if (m === 'split') q.delete('mode'); else q.set('mode', m);
    history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
  };
  // Presenter shortcuts: 1 student, 2 split, 3 live AI.
  useEffect(() => {
    const on = (e: KeyboardEvent) => { const m = ({ '1': 'student', '2': 'split', '3': 'ai' } as const)[e.key as '1']; if (m) setMode(m); };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  });

  const [facilities] = useFacilities();
  const scenario = useScenario();
  const facilityId = useMemo(() => {
    if (facilities.state !== 'ok' || !facilities.value.length) return null;
    return facilities.value.find((f) => f.facility_id === scenario?.simulator.facility_id)?.facility_id ?? facilities.value[0]!.facility_id;
  }, [facilities, scenario]);
  const live = useLiveFacility(facilityId);
  const statusRaw = useDemoStatus(1000);
  const status = statusRaw && statusRaw !== 'down' ? statusRaw : null;
  const events = useEvents(40);
  const facility = live.facility ?? (facilities.state === 'ok' ? facilities.value.find((f) => f.facility_id === facilityId) ?? null : null);
  const head = siteHeadline(status?.site?.title, facility?.name, !!facility?.is_simulated);
  // Frames that changed a space, kept after they scroll out of the event window (most frames change nothing).
  const [changeLog, setChangeLog] = useState<PerceptionEvent[]>([]);
  useEffect(() => {
    setChangeLog((log) => {
      if (!events.length) return log.length ? [] : log; // a demo reset empties the event stream
      const seen = new Set(log.map((e) => `${e.id}@${e.at}`));
      const fresh = events.filter((e) => e.changes.length && !seen.has(`${e.id}@${e.at}`));
      return fresh.length ? [...log, ...fresh].sort((x, y) => x.at.localeCompare(y.at)).slice(-12) : log;
    });
  }, [events]);
  const lastChange = changeLog.length ? changeLog[changeLog.length - 1]! : null;

  return (
    <div className={`pz pz-mode-${mode}`} data-testid="presentation" data-mode={mode}>
      <header className="pz-top">
        <div className="pz-brand"><span className="pz-mark" aria-hidden>M</span><span>Meri<b>dian</b></span></div>
        <div className="pz-site" data-testid="pz-site">
          <div className="pz-site-line">
            <b data-testid="pz-site-title">{head.title}</b>
            {head.simulation && <span className="pz-sim" data-testid="pz-simulation">Simulation</span>}
          </div>
          {status?.site?.disclaimer && <span className="pz-disc" data-testid="pz-disclaimer">{status.site.disclaimer}</span>}
        </div>
        <nav className="pz-modes" aria-label="Presentation mode">
          {MODES.map((m) => (
            <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)} data-testid={`pz-mode-${m.id}`}>{m.label}</button>
          ))}
        </nav>
      </header>

      {statusRaw === 'down' && scenario === null && (
        <p className="pz-alert" role="status">The live AI view needs the API in demo mode, e.g. <code>npm run demo:ohio</code>. The student app still runs.</p>
      )}

      <main className="pz-main">
        {mode !== 'ai' && <StudentStage tour={mode === 'student'} lastChange={lastChange} />}
        {mode !== 'student' && <AiPanel full={mode === 'ai'} status={status} live={live} events={events} changeLog={changeLog} lastChange={lastChange} simulated={!!facility?.is_simulated} />}
      </main>

      <footer className="pz-foot" data-testid="pz-legend">
        <span><i className="k-live" />Live: space states from the API, as the app sees them</span>
        <span><i className="k-sim" />Simulated: garage, cameras and traffic</span>
        <span><i className="k-demo" />Demo: class schedule, travel times, route</span>
      </footer>
    </div>
  );
}

// ------------------------------------------------------------------ student

const TOUR: { id: string; label: string; query: string; note: string }[] = [
  { id: 'explore', label: 'Explore', query: '', note: 'Where can I park near class?' },
  { id: 'garage', label: 'Garage details', query: '&sheet=garage', note: 'What the cameras confirm, and the site disclaimer' },
  { id: 'space', label: 'Space selection', query: '&sheet=space', note: 'Only fresh, camera-confirmed open spaces can be chosen' },
  { id: 'trip', label: 'Trip', query: '&sheet=space', note: 'Choose a green space and press Go: it is rechecked and watched' },
  { id: 'plan', label: 'Plan', query: '&tab=plan', note: 'When to leave: Arrival Intelligence (demo schedule)' },
  { id: 'you', label: 'You', query: '&tab=you', note: 'Vehicle, placard and alert settings' },
];

function StudentStage({ tour, lastChange }: { tour: boolean; lastChange: PerceptionEvent | null }) {
  const [step, setStep] = useState('explore');
  const [nonce, setNonce] = useState(0);
  const q = TOUR.find((t) => t.id === step)?.query ?? '';
  // Replay the real ParkRight intro on every presentation page load or refresh.
  // Tour navigation skips it so changing screens stays fast.
  const splash = nonce === 0 && step === 'explore' ? 'full' : 'off';
  const src = `/app/?device=iphone15&splash=${splash}${q}`;
  return (
    <section className="pz-stu" aria-label="What the student sees" data-testid="pz-student">
      <div className="pz-stu-copy">
        <span className="pz-eyebrow">What the student sees</span>
        <h1 className="pz-h1">Parking you can trust, before you leave.</h1>
        <p className="pz-lede">The real Meridian app, running live. It only offers a space a camera has confirmed open and fresh.</p>
        <ol className="pz-tour" aria-label="App tour">
          {TOUR.map((t) => (
            <li key={t.id}>
              <button type="button" aria-pressed={step === t.id} onClick={() => { setStep(t.id); setNonce((n) => n + 1); }} data-testid={`pz-tour-${t.id}`}>
                <b>{t.label}</b>
                {(tour || step === t.id) && <small>{t.note}</small>}
              </button>
            </li>
          ))}
        </ol>
        {lastChange && !tour && <SyncNote change={lastChange} />}
      </div>
      <Phone key={`${src}#${nonce}`} src={src} />
    </section>
  );
}

/** One coherent sentence for the latest change: camera → A2 → space state → the app on the left. */
function SyncNote({ change }: { change: PerceptionEvent }) {
  const c = change.changes[0]!;
  return (
    <p className="pz-sync" data-testid="pz-sync" aria-live="polite">
      <span className="pz-pulse" aria-hidden />
      <span>{change.camera_id.toUpperCase()} saw <b>{c.space_id} → {STATE_WORD[c.to as keyof typeof STATE_WORD] ?? c.to}</b>. The app updates from the same live state.</span>
    </p>
  );
}

/** The real app at iPhone 15 size (393 × 852), scaled to fit: at most ~750 px tall, like /app/ on a desktop. */
function Phone({ src }: { src: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.8);
  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setScale(Math.max(0.45, Math.min(752 / 880, (el.clientHeight - 8) / 880, (el.clientWidth - 8) / 421))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="pz-phonebox" ref={box}>
      <div className="pz-phone" style={{ width: 421 * scale, height: 880 * scale }}>
        <div className="pz-phone-in" style={{ transform: `scale(${scale})` }}>
          <iframe src={src} title="Meridian student app" data-testid="pz-app" width={393} height={852} />
          <span className="pz-island" aria-hidden />
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ live AI

function AiPanel({ full, status, live, events, changeLog, lastChange, simulated }: {
  full: boolean; status: DemoStatus | null; live: LiveView; events: PerceptionEvent[]; changeLog: PerceptionEvent[]; lastChange: PerceptionEvent | null; simulated: boolean;
}) {
  const now = useNow(1000);
  const spaces = live.safeSpaces;
  const t = useMemo(() => tally(spaces), [spaces]);
  const detector = detectorKind(status?.perception.provider);
  const allowOpen = status?.perception.allow_open === true;
  const cams = status?.cameras ?? [];
  const staleS = status?.stale_after_s ?? 12;

  // Camera → app latency: API receipt of a frame → this browser receiving the resulting update.
  const [samples, setSamples] = useState<number[]>([]);
  useEffect(() => {
    if (!live.lastFrame || !live.lastFrameAt) return;
    const d = live.lastFrameAt - Date.parse(live.lastFrame.received_at);
    if (d >= 0 && d < 60_000) setSamples((s) => [...s, d].slice(-20));
  }, [live.lastFrame?.seq, live.lastFrame?.camera_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const latency = median(samples);

  // The camera shown follows the latest processed frame unless the presenter picks one.
  const [pinned, setPinned] = useState<string | null>(null);
  const latestCam = events.length ? events[events.length - 1]!.camera_id : null;
  const camId = pinned ?? latestCam ?? cams[0]?.camera_id ?? null;
  const cam = cams.find((c) => c.camera_id === camId) ?? null;

  // Bays that changed in the last few seconds glow on the map.
  const prev = useRef(new Map<string, string>());
  const changedAt = useRef(new Map<string, number>());
  for (const s of spaces) {
    const was = prev.current.get(s.space_id);
    if (was && was !== s.current_state) changedAt.current.set(s.space_id, Date.now());
    prev.current.set(s.space_id, s.current_state);
  }

  const lastEv = events.length ? events[events.length - 1]! : null;
  const evidence = summarize(spaces, now, live.clockOffsetMs);
  const frameAge = lastEv ? Math.max(0, (now - Date.parse(lastEv.at)) / 1000) : null;
  const notes = [
    lastEv ? `${lastEv.camera_id.toUpperCase()} · ${Math.round(frameAge ?? 0)} s` : 'waiting',
    detector === 'a2' ? (lastEv ? `${lastEv.vehicles} cars · ${seconds(lastEv.a2_ms)}` : status?.perception.phase ?? 'starting') : detector === 'scripted' ? 'not running' : detector === 'none' ? 'not connected' : 'unknown',
    lastChange ? `${lastChange.changes[0]!.space_id} → ${STATE_WORD[lastChange.changes[0]!.to as keyof typeof STATE_WORD] ?? lastChange.changes[0]!.to}` : `${t.occupied} occupied`,
    live.trusted ? 'app updated' : 'paused',
  ];
  const active = !lastEv ? 0 : detector !== 'a2' && detector !== 'scripted' ? 0 : live.trusted ? 3 : 2;

  return (
    <section className={`pz-ai${full ? ' full' : ''}`} aria-label="What Meridian's AI sees" data-testid="pz-ai">
      <div className="pz-ai-head">
        <span className="pz-eyebrow dark">What Meridian’s AI sees</span>
        <DetectorChip kind={detector} status={status} />
      </div>
      <PipelineFlow active={active} notes={notes} warn={[false, detector !== 'a2', false, !live.trusted]} />

      <div className="pz-ai-body">
        <Cctv cams={cams} camId={camId} pinned={pinned} onPick={(id) => setPinned(id === pinned ? null : id)} spaces={spaces} detector={detector} staleS={staleS} now={now} />
        <div className="pz-ai-side">
          <Metrics t={t} cameras={cams.length} simulated={simulated} latency={latency} allowOpen={allowOpen} />
          {!allowOpen && status && (
            <p className="pz-openoff" data-testid="pz-open-disabled"><b>Open-space confirmation not enabled</b><span>Occupied spaces are detected; empty spaces remain unconfirmed.</span></p>
          )}
          <OwnershipMap spaces={spaces} owned={cam?.owned ?? []} camId={camId} changedAt={changedAt.current} now={now} />
          <Events events={events} changes={changeLog} max={full ? 6 : 2} chips={full ? 3 : 2} />
        </div>
      </div>

      <details className="pz-details" data-testid="pz-details">
        <summary>Engineering details</summary>
        <dl>
          <div><dt>Detector</dt><dd>{status ? `${status.perception.provider} ${status.perception.version ?? ''} · ${status.perception.phase ?? '—'}` : '—'}</dd></div>
          <div><dt>Last frame</dt><dd>{lastEv ? `${lastEv.camera_id} · seq ${lastEv.seq} · A2 ${seconds(lastEv.a2_ms)}` : '—'}</dd></div>
          <div><dt>OPEN detection</dt><dd>{status ? (allowOpen ? 'enabled (allow_open true)' : 'disabled (allow_open false)') : '—'}</dd></div>
          <div><dt>Stale after</dt><dd>{status?.stale_after_s ? `${status.stale_after_s} s · recommendation needs < 12 s` : '—'}</dd></div>
          <div><dt>Oldest current view</dt><dd>{evidence.oldestMs !== null ? `${ago(evidence.oldestMs)} · ${evidence.stale} stale` : '—'}</dd></div>
          <div><dt>WebSocket</dt><dd>{live.connection}{live.silent ? ' · silent' : ''}</dd></div>
          <div><dt>Latency samples</dt><dd>{samples.length} · API receipt → this browser (camera upload not included)</dd></div>
        </dl>
        <p>Accuracy figures for this simulation are measured on simulated imagery (docs/ohio-union-garage.md). They are not real-world accuracy.</p>
      </details>
    </section>
  );
}

function DetectorChip({ kind, status }: { kind: DetectorKind; status: DemoStatus | null }) {
  const ready = kind === 'a2' && status?.perception.loaded;
  const text = kind === 'a2' ? (ready ? 'NVIDIA A2 · running' : `NVIDIA A2 · ${status?.perception.phase ?? 'starting'}`) : DETECTOR_LABEL[kind];
  return <span className={`pz-chip ${ready ? 'ok' : 'warn'}`} data-testid="pz-detector" data-kind={kind}>{text}</span>;
}

function Cctv({ cams, camId, pinned, onPick, spaces, detector, staleS, now }: {
  cams: NonNullable<DemoStatus['cameras']>; camId: string | null; pinned: string | null; onPick: (id: string) => void;
  spaces: ParkingSpace[]; detector: DetectorKind; staleS: number; now: number;
}) {
  const cam = cams.find((c) => c.camera_id === camId) ?? null;
  const f = cam?.last_frame ?? null;
  const ageS = f ? Math.max(0, (now - Date.parse(f.received_at)) / 1000) : null;
  const stateOf = (id: string) => spaces.find((x) => x.space_id === id)?.current_state ?? 'UNCERTAIN';
  const imagery = detector === 'a2' || detector === 'other';
  const boxes = f?.detections.filter((d) => d.confidence >= 0.65) ?? [];
  return (
    <div className="pz-cctv" data-testid="pz-cctv">
      <div className="pz-camtabs" role="group" aria-label="Cameras">
        <span className="pz-camlbl">CAM</span>
        {cams.map((c) => {
          const a = c.last_frame ? Math.max(0, (now - Date.parse(c.last_frame.received_at)) / 1000) : null;
          return (
            <button key={c.camera_id} type="button" aria-label={c.camera_id.toUpperCase()} aria-pressed={c.camera_id === camId} className={pinned === c.camera_id ? 'pin' : ''} onClick={() => onPick(c.camera_id)} data-tone={cameraTone(a, staleS)} title={a === null ? 'no frame yet' : `last frame ${Math.round(a)} s ago`}>
              <i aria-hidden />{c.camera_id.replace('cam-', '')}
            </button>
          );
        })}
      </div>
      <div className="pz-frame">
        {imagery && cam && f ? (
          <>
            <img src={`/api/v1/demo/camera/latest.jpg?camera_id=${cam.camera_id}&seq=${f.seq}`} alt={`Latest frame from ${cam.camera_id}`} width={1280} height={720} />
            <svg viewBox="0 0 1280 720" aria-hidden>
              {cam.polygons && Object.entries(cam.polygons).map(([id, pts]) => (
                <polygon key={id} className={`pz-poly ${stateOf(id).toLowerCase()}`} points={pts.map((q) => `${q.x * 1280},${q.y * 720}`).join(' ')} />
              ))}
              {boxes.map((d, i) => <rect key={i} className="pz-box" x={d.box[0]! * 1280} y={d.box[1]! * 720} width={(d.box[2]! - d.box[0]!) * 1280} height={(d.box[3]! - d.box[1]!) * 720} />)}
            </svg>
          </>
        ) : (
          <div className="pz-noframe" data-testid="pz-noframe">
            <b>{detector === 'scripted' ? 'No CCTV imagery in this run' : cam ? `Waiting for ${cam.camera_id.toUpperCase()}…` : 'Waiting for the cameras…'}</b>
            {detector === 'scripted' && <span>Space states come from a scripted test source, not NVIDIA A2. Run <code>npm run demo:ohio</code> for live camera frames and detections.</span>}
          </div>
        )}
      </div>
      <p className="pz-caption" data-testid="pz-cam-caption">
        {cam ? <>
          <b>{cam.camera_id.toUpperCase()}</b> owns {ownedRange(cam.owned)}
          {ageS !== null && <> · frame {Math.round(ageS)} s old</>}
          {imagery && f && <> · {boxes.length} vehicle{boxes.length === 1 ? '' : 's'}</>}
          {!pinned && <span className="pz-follow"> · following the latest frame</span>}
        </> : 'No camera reported yet'}
      </p>
    </div>
  );
}

function Metrics({ t, cameras, simulated, latency, allowOpen }: { t: Tally; cameras: number; simulated: boolean; latency: number | null; allowOpen: boolean }) {
  const tiles: [string, string, string][] = [
    ['cameras', String(cameras || '—'), 'cameras'],
    ['spaces', String(t.total || '—'), simulated ? 'simulated spaces' : 'spaces'],
    ['occ', String(t.occupied), 'occupied detected'],
    ['unc', String(t.uncertain), "can't confirm"],
    ['lat', seconds(latency), 'camera → app'],
  ];
  if (allowOpen) tiles.splice(4, 0, ['open', String(t.open), 'confirmed open']);
  return (
    <div className={`pz-metrics${tiles.length === 6 ? ' six' : ''}`} data-testid="pz-metrics">
      {tiles.map(([k, v, l]) => <div key={k} className={`m-${k}`} data-testid={`pz-m-${k}`}><b>{v}</b><span>{l}</span></div>)}
    </div>
  );
}

/** Every bay at its plan position, coloured by live state; the shown camera's bays are outlined. */
function OwnershipMap({ spaces, owned, camId, changedAt, now }: { spaces: ParkingSpace[]; owned: string[]; camId: string | null; changedAt: Map<string, number>; now: number }) {
  if (!spaces.length) return null;
  const xs = spaces.map((s) => s.plan.x), ys = spaces.map((s) => s.plan.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const x1 = Math.max(...spaces.map((s) => s.plan.x + s.plan.w)), y1 = Math.max(...spaces.map((s) => s.plan.y + s.plan.h));
  const own = new Set(owned);
  return (
    <figure className="pz-map" data-testid="pz-map">
      <svg viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} preserveAspectRatio="none" role="img" aria-label={`Space states; ${camId ?? 'no camera'} bays outlined`}>
        {spaces.map((s) => {
          const st = s.stale ? 'uncertain' : s.current_state.toLowerCase();
          const flash = (changedAt.get(s.space_id) ?? 0) > now - 3000;
          return <rect key={s.space_id} x={s.plan.x + s.plan.w * 0.08} y={s.plan.y + s.plan.h * 0.06} width={s.plan.w * 0.84} height={s.plan.h * 0.88} rx={s.plan.w * 0.12} className={`b ${st}${own.has(s.space_id) ? ' own' : ''}${flash ? ' flash' : ''}`} data-bay={s.space_id} data-state={st} />;
        })}
      </svg>
      <figcaption><span><i className="occupied" />Occupied</span><span><i className="uncertain" />Can’t confirm</span><span><i className="open" />Open</span><span><i className="own" />{camId ? camId.toUpperCase() : 'Camera'} owns</span></figcaption>
    </figure>
  );
}

/** Frames that changed a space, newest first; the latest frame is summarised on one line. */
function Events({ events, changes, max, chips }: { events: PerceptionEvent[]; changes: PerceptionEvent[]; max: number; chips: number }) {
  const shown = [...changes].reverse().slice(0, max);
  const last = events.length ? events[events.length - 1]! : null;
  return (
    <div className="pz-events" data-testid="pz-events">
      <span className="pz-eyebrow dark sm">Live events</span>
      <ol>
        {shown.map((e) => (
          <li key={e.id}>
            <time>{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
            <span>{e.camera_id.toUpperCase()}</span>
            {e.changes.slice(0, chips).map((c) => <em key={c.space_id} className={c.to.toLowerCase()}>{c.space_id} → {STATE_WORD[c.to as keyof typeof STATE_WORD] ?? c.to}</em>)}
            {e.changes.length > chips && <em className="none">+{e.changes.length - chips}</em>}
          </li>
        ))}
        {!last && <li className="none">Waiting for the first processed frame…</li>}
        {last && !shown.length && <li className="none">No space has changed since this page opened.</li>}
      </ol>
      {last && <p className="pz-lastframe">Latest frame: {last.camera_id.toUpperCase()} · {last.changes.length ? `${last.changes.length} change${last.changes.length === 1 ? '' : 's'}` : 'no change'} · {events.length} frames in the last {Math.max(1, Math.round((Date.parse(last.at) - Date.parse(events[0]!.at)) / 1000))} s</p>}
    </div>
  );
}
