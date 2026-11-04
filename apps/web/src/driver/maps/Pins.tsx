/** What a garage pin says: a number only with a source to back it, and simulated or demo numbers marked as such. */
import type { Ranked } from '../lib/directory.ts';

export function pinLabel(r: Ranked): { text: string; note: string | null; tone: 'open' | 'demo' | 'none'; say: string } {
  const e = r.entry;
  if (e.source === 'demo') return { text: String(r.spaces ?? 0), note: 'demo', tone: 'demo', say: `${r.spaces ?? 0} in the demo feed, not live` };
  if (e.facility && e.source !== 'unavailable' && r.trusted && r.counts && !r.openDisabled) {
    const sim = e.source === 'simulated';
    return { text: String(r.counts.open), note: sim ? 'sim' : e.source === 'live' ? 'live' : null, tone: r.counts.open > 0 ? 'open' : 'none', say: `${r.counts.open} confirmed open${sim ? ' in simulation, not real availability' : ''}` };
  }
  if (e.facility && r.openDisabled && r.trusted) return { text: '–', note: null, tone: 'none', say: 'open spaces can’t be confirmed yet' };
  return { text: 'P', note: null, tone: 'none', say: e.facility ? 'availability unknown' : 'no availability data' };
}

export function GarageMapPin({ r, active, onOpen, flat = false }: { r: Ranked; active: boolean; onOpen: () => void; flat?: boolean }) {
  const l = pinLabel(r);
  return (
    <button type="button" className={`mpin ${l.tone}${active ? ' active' : ''}`} data-testid={`pin-${r.entry.id}`} data-tone={l.tone} aria-label={`${r.entry.name}: ${l.say}. Show garage details`} onClick={(e) => { e.stopPropagation(); onOpen(); }}>
      <span className="mpin-tag">{l.text}{l.note && <small className={l.note}>{l.note}</small>}</span>
      {!flat && <span className="mpin-stem" />}
    </button>
  );
}

export function DestinationMapPin({ name, onOpen }: { name: string; onOpen?: () => void }) {
  if (!onOpen) return <div className="mdest" data-testid="pin-destination"><i /><b>{name}</b></div>;
  return <button type="button" className="mdest open" data-testid="pin-destination" aria-label={`${name}. Show place details`} onClick={(e) => { e.stopPropagation(); onOpen(); }}><i /><b>{name}</b></button>;
}

/** A leg's real end on the map: where the car goes in, where you leave on foot. */
export function RouteMark({ kind, label }: { kind: 'entrance' | 'exit' | 'start'; label: string }) {
  return <div className={`mmark ${kind}`} data-testid={`mark-${kind}`} role="img" aria-label={label}>{kind === 'entrance' ? 'P' : ''}</div>;
}
