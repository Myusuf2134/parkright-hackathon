import { useLab, useTicker, useVersion } from './context.ts';
import { Panel } from './Panel.tsx';

export function GroundTruthPanel() {
  const { lab, streamer, backend } = useLab();
  useVersion(lab.world);
  useVersion(streamer);
  useVersion(backend);
  useTicker(250);
  const truth = lab.world.truth().spaces;
  const backendState = new Map(backend.spaces.map((s) => [s.space_id, s]));
  const last = streamer.log[0];
  const model = backend.spaces.find((s) => s.model)?.model;

  return (
    <Panel title="GROUND TRUTH" className="truth" tag={<span className="warn-tag">EVALUATION ONLY</span>}>
      <p className="banner" data-testid="truth-banner">SIMULATOR GROUND TRUTH — NOT PROVIDED TO PERCEPTION</p>
      <table className="truth-table">
        <thead>
          <tr>
            <th>BAY</th>
            <th>SIMULATOR TRUTH</th>
            <th>BACKEND (DRIVERS SEE)</th>
          </tr>
        </thead>
        <tbody>
          {truth.map((s) => {
            const b = backendState.get(s.space_id);
            return (
              <tr key={s.space_id}>
                <td>{s.space_id}</td>
                <td className={`t-${s.truth}`} data-testid={`truth-${s.space_id}`}>{s.truth}</td>
                <td className={`b-${b?.current_state.toLowerCase() ?? 'none'}`}>{b ? `${b.current_state}${b.stale ? ' · stale' : ''}` : backend.connected ? '—' : 'no connection'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="caption">
        Last ground-truth post: <b>{last ? last.groundTruth : '—'}</b>
        {last?.groundTruthDetail ? ` (${last.groundTruthDetail})` : ''}. Backend perception: <b>{model ? `${model.provider}@${model.version}` : '—'}</b>
        {model?.provider === 'none' && ' — no detector connected, so UNCERTAIN everywhere is the correct answer.'}
      </p>
    </Panel>
  );
}
