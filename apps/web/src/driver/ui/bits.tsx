import type { ParkingSpace } from '@parkright/contracts';
import { bayState } from '../lib/parking.ts';
import { ago } from '../lib/time.ts';
import type { LiveView } from '../net/live.ts';

/** Past this, the label stops saying Live: the backend marks spaces stale at 12 s (30 s at the Ohio site). */
const QUIET_MS = 12_000;

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

/** "● Live · 2 s · Simulated garage", or the paused/connecting equivalent. */
export function Provenance({ live, now, simulated, extra }: { live: LiveView; now: number; simulated: boolean; extra?: string }) {
  let status;
  const frameAge = live.lastFrameAt ? now - live.lastFrameAt : null;
  if (live.trusted && frameAge !== null && frameAge <= QUIET_MS) status = <span className="live" data-testid="prov-live">Live · {ago(frameAge)}</span>;
  else if (live.trusted) status = <span className="paused" data-testid="prov-quiet">{frameAge === null ? 'Connected · no camera frames yet' : `Camera quiet · ${ago(frameAge)}`}</span>;
  else if (live.connection === 'reconnecting' || live.silent) status = <span className="paused" data-testid="prov-paused">{live.silent ? 'No recent update' : 'Reconnecting'}</span>;
  else status = <span data-testid="prov-connecting">Connecting…</span>;
  return (
    <div className="prov">
      {status}
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
