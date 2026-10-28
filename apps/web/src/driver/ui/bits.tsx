import type { Counts } from '../lib/parking.ts';
import { groupLabel, type Evidence } from '../lib/evidence.ts';
import type { LiveView } from '../net/live.ts';

/**
 * "Parking observations": one proportional bar of what the cameras report, with counts and a legend.
 * Occupied and can't-confirm are always shown; a green confirmed-open segment appears only when the
 * detector can report OPEN and some space actually is fresh OPEN. With open detection off it says so
 * instead, so unconfirmed spaces never read as available.
 */
export function ObservationBar({ counts, openEnabled, title = false, legend = true, note = true }: {
  counts: Pick<Counts, 'total' | 'open' | 'occupied' | 'uncertain'>; openEnabled: boolean; title?: boolean; legend?: boolean; note?: boolean;
}) {
  const open = openEnabled ? counts.open : 0;
  const segs = ([['occupied', counts.occupied], ['uncertain', counts.uncertain], ['open', open]] as const).filter(([, n]) => n > 0);
  const label = `${counts.occupied} occupied, ${counts.uncertain} can't confirm${openEnabled ? `, ${open} confirmed open` : ''}, of ${counts.total} spaces`;
  return (
    <div className="obs" data-testid="obs" data-open={open} data-open-enabled={openEnabled}>
      {title && <div className="obs-head"><span className="ey">Parking observations</span><span className="obs-total">{counts.total} spaces</span></div>}
      <div className="obs-bar" role="img" aria-label={`Parking observations: ${label}`}>
        {segs.map(([k, n]) => <i key={k} className={k} data-seg={k} style={{ flexGrow: n }} />)}
        {!segs.length && <i className="empty" />}
      </div>
      {(legend || (!openEnabled && note)) && (
        <div className="obs-legend">
          {legend && <span><i className="occupied" /><b>{counts.occupied}</b> Occupied</span>}
          {legend && <span><i className="uncertain" /><b>{counts.uncertain}</b> Can’t confirm</span>}
          {legend && openEnabled && <span><i className="open" /><b>{open}</b> Confirmed open</span>}
          {!openEnabled && note && <span className="obs-note" data-testid="open-disabled-line">Open-space confirmation isn’t enabled in this demo yet.</span>}
        </div>
      )}
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
