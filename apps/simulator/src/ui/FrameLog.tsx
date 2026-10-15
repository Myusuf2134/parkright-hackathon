import { useLab, useVersion } from './context.ts';

export function FrameLog() {
  const { streamer } = useLab();
  useVersion(streamer);
  const counts = streamer.log.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.status]: (acc[e.status] ?? 0) + 1 }), {});
  return (
    <div className="framelog" data-testid="frame-log">
      <div className="framelog-head">
        <h2>FRAME LOG</h2>
        <span className="muted">
          POST /api/v1/cameras/cam-01/frames · last {streamer.log.length}
          {Object.entries(counts).map(([k, v]) => (
            <span key={k} className={`status ${k}`}>
              {k} {v}
            </span>
          ))}
          {streamer.skippedTicks > 0 && <span className="status skipped">skipped ticks {streamer.skippedTicks}</span>}
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>SEQ</th>
            <th>SIM TIME</th>
            <th>CAPTURED</th>
            <th>JPEG</th>
            <th>RESULT</th>
            <th>LATENCY</th>
            <th>GROUND TRUTH</th>
            <th>DETAIL</th>
          </tr>
        </thead>
        <tbody>
          {streamer.log.slice(0, 7).map((e, i) => (
            <tr key={`${e.sessionId}-${e.seq}-${i}`}>
              <td className="mono">{e.seq}</td>
              <td className="mono">{(e.simTimeMs / 1000).toFixed(2)} s</td>
              <td className="mono">{e.capturedAt.slice(11, 23)}</td>
              <td className="mono">{(e.bytes / 1024).toFixed(0)} KB</td>
              <td>
                <span className={`status ${e.status}`}>{e.status}</span>
                {e.httpStatus !== null && <span className="muted"> {e.httpStatus}</span>}
              </td>
              <td className="mono">{e.latencyMs} ms</td>
              <td className={`gt ${e.groundTruth}`}>{e.groundTruth}</td>
              <td className="detail">{e.detail ?? ''}</td>
            </tr>
          ))}
          {streamer.log.length === 0 && (
            <tr>
              <td colSpan={8} className="muted">
                No frames yet. Choose a stream rate or press “Capture &amp; send”.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
