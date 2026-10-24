/**
 * Driver-screen parts for the 34-space showcase garage. Everything here is live: bay states and
 * counts from the WebSocket, camera frames and detections from the API, events from the API's
 * perception log. Nothing is computed from simulator ground truth.
 */
import type { ParkingSpace } from '@parkright/contracts';
import { useState } from 'react';
import type { DemoStatus, PerceptionEvent } from './api.ts';

const ROWS = ['A', 'B', 'C', 'D'] as const;

export function liveCounts(spaces: ParkingSpace[]) {
  return {
    total: spaces.length,
    occupied: spaces.filter((s) => s.current_state === 'OCCUPIED').length,
    uncertain: spaces.filter((s) => s.current_state === 'UNCERTAIN').length,
    open: spaces.filter((s) => s.current_state === 'OPEN').length,
  };
}

export function LiveGarageCard({ spaces, changedAt, connection, status, debug }: {
  spaces: ParkingSpace[]; changedAt: Record<string, number>; connection: string; status: DemoStatus | null; debug: boolean;
}) {
  const c = liveCounts(spaces);
  const now = Date.now();
  const cams = status?.cameras ?? [];
  return (
    <article className="d-card d-live" data-testid="live-garage">
      <div className="d-card-head">
        <h2>Tuttle Garage · live</h2>
        <span className="d-tag">Simulated garage · live perception</span>
      </div>
      <div className="d-live-counts" data-testid="live-counts">
        <div><b className="tnum" data-testid="live-total">{c.total}</b><span>spaces</span></div>
        <div className="occ"><b className="tnum" data-testid="live-occupied">{c.occupied}</b><span>occupied</span></div>
        <div className="unc"><b className="tnum" data-testid="live-uncertain">{c.uncertain}</b><span>uncertain</span></div>
        <div className="opn"><b className="tnum" data-testid="live-open">{c.open}</b><span>confirmed open</span></div>
      </div>
      <div className="d-live-map" data-testid="live-map">
        {ROWS.map((row) => (
          <div key={row} className={`d-live-row row-${row}`}>
            {spaces.filter((s) => s.space_id.startsWith(row)).map((s) => {
              const st = s.current_state.toLowerCase();
              const flash = changedAt[s.space_id] && now - changedAt[s.space_id]! < 2500;
              return (
                <span key={s.space_id} className={`d-live-bay ${st}${flash ? ' flash' : ''}`} data-bay={s.space_id} data-state={st} title={`${s.space_id}: ${s.current_state}${s.source_camera_id ? ` · ${s.source_camera_id}` : ''}`}>
                  {s.space_id}
                  {debug && s.source_camera_id && <small>{s.source_camera_id.replace('cam-0', 'C')}</small>}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <p className="d-note">
        {connection === 'live' ? 'Updating live over WebSocket' : 'Reconnecting: nothing is shown as available'} · {cams.filter((x) => x.last_frame && x.last_frame.age_s < 15).length}/{cams.length} cameras reporting · OPEN detection disabled, so empty bays stay uncertain.
      </p>
    </article>
  );
}

export function ShowcaseCameraCard({ status, spaces }: { status: DemoStatus | null; spaces: ParkingSpace[] }) {
  const cams = status?.cameras ?? [];
  const [sel, setSel] = useState('cam-02');
  const cam = cams.find((c) => c.camera_id === sel) ?? cams[0];
  const f = cam?.last_frame ?? null;
  const stateOf = (id: string) => spaces.find((x) => x.space_id === id)?.current_state ?? 'UNCERTAIN';
  return (
    <article className="d-card d-camera" data-testid="camera-card">
      <div className="d-card-head">
        <h2>CCTV</h2>
        <div className="d-cam-tabs">
          {cams.map((c) => (
            <button key={c.camera_id} className={c.camera_id === cam?.camera_id ? 'on' : ''} onClick={() => setSel(c.camera_id)} data-testid={`driver-cam-${c.camera_id}`}>
              {c.camera_id.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="d-frame">
        {cam && f ? (
          <>
            <img src={`/api/v1/demo/camera/latest.jpg?camera_id=${cam.camera_id}&seq=${f.seq}`} alt={`Latest frame from ${cam.camera_id}`} width={1280} height={720} />
            <svg viewBox="0 0 1280 720" aria-hidden="true">
              {cam.polygons && Object.entries(cam.polygons).map(([id, pts]) => (
                <g key={id} className={`d-bay ${stateOf(id).toLowerCase()}`}>
                  <polygon points={pts.map((q) => `${q.x * 1280},${q.y * 720}`).join(' ')} />
                  <text x={(pts.reduce((a, q) => a + q.x, 0) / pts.length) * 1280} y={(pts.reduce((a, q) => a + q.y, 0) / pts.length) * 720}>{id}</text>
                </g>
              ))}
              {f.detections.filter((d) => d.confidence >= 0.65).map((d, i) => (
                <rect key={i} className="d-box" x={d.box[0]! * 1280} y={d.box[1]! * 720} width={(d.box[2]! - d.box[0]!) * 1280} height={(d.box[3]! - d.box[1]!) * 720} />
              ))}
            </svg>
          </>
        ) : (
          <p className="d-wait">Waiting for {cam?.camera_id.toUpperCase() ?? 'the cameras'}…</p>
        )}
      </div>
      <p className="d-detector" data-testid="detector-line">
        <span className={`d-dot ${status?.perception.loaded ? 'ok' : ''}`} />
        {status?.perception.loaded ? 'A2 detector ready' : 'A2 detector starting'}
        {cam && f && ` · ${cam.camera_id.toUpperCase()} owns ${cam.owned[0]}–${cam.owned[cam.owned.length - 1]} · ${f.detections.filter((d) => d.confidence >= 0.65).length} vehicles · ${Math.round(f.timings.total_ms ?? 0)} ms · frame ${f.seq}`}
        {status && ` · OPEN detection ${status.perception.allow_open ? 'ENABLED' : 'disabled'}`}
      </p>
    </article>
  );
}

export function EventFeed({ events }: { events: PerceptionEvent[] }) {
  return (
    <article className="d-card d-events" data-testid="event-feed">
      <div className="d-card-head">
        <h2>Live events</h2>
        <span className="d-tag-plain">camera → detection → bay state</span>
      </div>
      <ol>
        {[...events].reverse().map((e) => (
          <li key={e.id}>
            <time className="tnum">{new Date(e.at).toLocaleTimeString()}</time>
            <span>{e.camera_id.toUpperCase()} · {e.vehicles} vehicle{e.vehicles === 1 ? '' : 's'} detected</span>
            {e.changes.map((c) => <em key={c.space_id} className={c.to.toLowerCase()}>{c.space_id} → {c.to}</em>)}
          </li>
        ))}
        {!events.length && <li className="d-note">Waiting for the first processed frame…</li>}
      </ol>
    </article>
  );
}
