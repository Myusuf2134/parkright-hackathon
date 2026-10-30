/**
 * The one-line story of the pipeline: Camera → NVIDIA A2 → Space state → ParkRight.
 * Replaces the seven-stage bar; detail lives behind "How it works" / "Engineering details".
 */
import './flow.css';

export const FLOW = ['Camera', 'NVIDIA A2', 'Space state', 'Meridian'] as const;

export function PipelineFlow({ active, notes = [], warn = [] }: { active: number; notes?: (string | null)[]; warn?: boolean[] }) {
  return (
    <ol className="pflow" aria-label="How Meridian works" data-testid="pipeline-flow" data-active={active}>
      {FLOW.map((name, i) => (
        <li key={name} className={`${i <= active ? 'on' : ''}${warn[i] ? ' warn' : ''}`} data-node={name}>
          <b>{name}</b>
          {notes[i] && <small>{notes[i]}</small>}
        </li>
      ))}
    </ol>
  );
}
