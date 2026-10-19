import { useEffect, useRef } from 'react';
import { STREAM_RATES } from '../stream/streamer.ts';
import { formatSimTime, useLab, useTicker, useVersion } from './context.ts';
import { Panel, Stat } from './Panel.tsx';

export function CameraFeedPanel() {
  const { lab, streamer } = useLab();
  useVersion(streamer);
  useTicker(200);
  const host = useRef<HTMLDivElement>(null);
  const last = streamer.log[0];

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.appendChild(lab.camera.canvas);
    return () => {
      lab.camera.canvas.remove();
    };
  }, [lab]);

  const [w, h] = lab.camera.resolution;
  return (
    <Panel
      title="CAMERA FEED"
      className="feed"
      tag={<span className={`rec ${streamer.rate > 0 ? 'on' : ''}`}>{streamer.rate > 0 ? `● STREAMING ${streamer.rate} FPS` : 'STREAM OFF'}</span>}
    >
      <div className="feed-frame" ref={host}>
        <div className="feed-hud">
          <span>cam-01</span>
          <span>
            {w}×{h} · JPEG
          </span>
        </div>
      </div>
      <p className="caption">Live cam-01 render. Frames are JPEG-encoded from exactly these pixels — no overlays, no labels.</p>

      <div className="stats">
        <Stat label="SESSION" value={streamer.sessionId} testid="session-id" />
        <Stat label="NEXT SEQ" value={streamer.nextSeq} testid="next-seq" />
        <Stat label="SIM TIME" value={formatSimTime(lab.world.simTimeMs)} />
        <Stat label="LAST RESULT" value={last ? <span className={`status ${last.status}`} data-testid="last-status">{last.status}</span> : '—'} />
      </div>

      <div className="row">
        <div className="segmented" role="group" aria-label="Stream rate">
          {STREAM_RATES.map((r) => (
            <button key={r} className={streamer.rate === r ? 'active' : ''} onClick={() => streamer.setRate(r)} data-testid={`rate-${r}`}>
              {r === 0 ? 'OFF' : `${r} FPS`}
            </button>
          ))}
        </div>
        <button className="primary" onClick={() => void streamer.captureAndSend()} disabled={streamer.inFlight || (!!streamer.health?.calibration && !streamer.health?.inference?.inference_ready)} data-testid="send-frame">
          Capture &amp; send
        </button>
      </div>
      <div className="row subtle">
        <label className="check">
          <input type="checkbox" checked={streamer.sendGroundTruth} onChange={(e) => streamer.setGroundTruth(e.target.checked)} data-testid="gt-toggle" />
          Send ground truth to evaluation (separate request)
        </label>
        <button className="ghost" onClick={() => streamer.newSession()} data-testid="new-session">
          New session
        </button>
      </div>
    </Panel>
  );
}
