import {useLab,useVersion} from './context.ts';
import {Panel} from './Panel.tsx';

export function PerceptionPanel() {
  const {streamer}=useLab();useVersion(streamer);
  const h=streamer.health, info=h?.inference, calibration=h?.calibration;
  const matches=info && info.frame_seq === streamer.log[0]?.seq && info.session_id === streamer.log[0]?.sessionId;
  return <Panel title="INFERENCE DIAGNOSTICS" tag={<span>PIXELS ONLY</span>}>
    <p data-testid="inference-readiness">{info?.phase ?? 'unavailable'} · {info?.inference_ready ? 'ready' : 'not ready'}</p>
    <p className="mono">{h?.perception.provider ?? '—'}@{h?.perception.version ?? '—'}</p>
    <p>Calibration: {calibration?.version ?? 'none'}</p>
    <p>Last frame: {info?.last_frame_at ?? '—'}<br/>Last inference: {info?.last_inference_at ?? '—'}</p>
    <p>{info?.detection_count ?? 0} detections · {info?.uncertain_count ?? 12} uncertain spaces · {info?.timings?.total_ms?.toFixed(1) ?? '—'} ms</p>
    {streamer.lastFrameUrl && calibration && <svg viewBox="0 0 1280 720" style={{width:'100%'}} aria-label="Debug copy with calibration and detections">
      <image href={streamer.lastFrameUrl} width="1280" height="720"/>
      {Object.entries(calibration.polygons).map(([id,points])=><g key={id}>
        <polygon points={points.map(p=>`${p.x*1280},${p.y*720}`).join(' ')} fill="none" stroke="cyan" strokeWidth="3"/>
        <text x={points[0]!.x*1280} y={points[0]!.y*720+15} fill="white" fontSize="18">{id}</text>
      </g>)}
      {matches && info?.detections?.filter(d=>['car','truck','bus'].includes(d.label)).map((d,i)=><g key={i}>
        <rect x={d.box[0]!*1280} y={d.box[1]!*720} width={(d.box[2]!-d.box[0]!)*1280} height={(d.box[3]!-d.box[1]!)*720} fill="none" stroke="yellow" strokeWidth="3"/>
        <text x={d.box[0]!*1280} y={d.box[1]!*720} fill="yellow" fontSize="18">{d.label} {d.confidence.toFixed(2)}</text>
      </g>)}
    </svg>}
    <p className="caption">Debug copy only. Outlines and labels are never uploaded.</p>
    <button onClick={()=>streamer.dataset.download()} data-testid="export-evaluation">Export evaluation dataset ({streamer.dataset.records.length} frames)</button>
    <p className="caption">Evaluation export includes separate ground truth. Maximum 200 frames; omitted: {streamer.dataset.omitted}.</p>
  </Panel>;
}
