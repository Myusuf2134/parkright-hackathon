import type { ParkingSpace } from '@parkright/contracts';
import { bayState } from '../lib/parking.ts';
import { groupLabel, type Evidence } from '../lib/evidence.ts';
import type { LiveView } from '../net/live.ts';

/** One tick per space, in reading order. Thin ticks for big garages. */
export function TickStrip({ spaces, label }: { spaces: ParkingSpace[]; label: string }) {
  const dense = spaces.length > 24;
  return (
    <div className={`ticks${dense ? ' dense' : ''}`} role="img" aria-label={label} data-testid="ticks">
      {spaces.map((s) => {
        const st = bayState(s);
        return <i key={s.space_id} className={st === 'open' ? '' : st === 'occupied' ? 'o' : 'u'} />;
      })}
    </div>
  );
}

/**
 * "● Live · 2–9 s · Simulated garage", or the aging/paused/connecting equivalent. The age is the
 * group's oldest current view (lib/evidence.ts), never the newest frame from any one camera.
 */
export function Provenance({ live, evidence, simulated, extra }: { live: LiveView; evidence: Evidence; simulated: boolean; extra?: string }) {
  let status;
  if (live.trusted) {
    const g = groupLabel(evidence);
    status = g.tone === 'live'
      ? <span className="live" data-testid="prov-live">{g.text}</span>
      : <span className="paused" data-testid={g.tone === 'aging' ? 'prov-aging' : 'prov-quiet'}>{g.text}</span>;
  } else if (live.connection === 'reconnecting' || live.silent) status = <span className="paused" data-testid="prov-paused">{live.silent ? 'No recent update' : 'Reconnecting'}</span>;
  else status = <span data-testid="prov-connecting">Connecting…</span>;
  const staleNote = live.trusted && evidence.fresh > 0 && evidence.stale > 0 ? `${evidence.stale} without a recent view` : null;
  return (
    <div className="prov" data-testid="prov">
      {status}
      {staleNote && <><span aria-hidden>·</span><span data-testid="prov-stale">{staleNote}</span></>}
      {extra && <><span aria-hidden>·</span><span>{extra}</span></>}
      {simulated && <><span aria-hidden>·</span><span className="simw">Simulated garage</span></>}
    </div>
  );
}

export function DemoMark({ children = 'Demo' }: { children?: string }) {
  return <span className="dm" data-demo>{children}</span>;
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="tog" onClick={() => onChange(!on)} />;
}
