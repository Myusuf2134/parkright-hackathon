/** The garage list on Home, and the pieces every garage view shares: source tag, favorite, directions. */
import { useState } from 'react';
import { directionsUrl, resolveMapsApp, type MapsApp } from '../lib/directions.ts';
import type { DataSource, GarageEntry, Ranked } from '../lib/directory.ts';
import type { Saved } from '../lib/saved.ts';
import { SourceTag } from '../ui/SourceTag.tsx';
import { Chevron, Close, Star } from '../ui/icons.tsx';

const SOURCE_LABEL: Record<DataSource, string> = { simulated: 'Simulated', live: 'Live', demo: 'Demo feed', unavailable: 'Unavailable' };
export const GarageSource = ({ source }: { source: DataSource }) => <SourceTag source={source}>{SOURCE_LABEL[source]}</SourceTag>;

export function FavoriteButton({ id, name, on, onToggle, flat = true }: { id: string; name: string; on: boolean; onToggle: (id: string) => void; flat?: boolean }) {
  return (
    <button type="button" className={`circ${flat ? ' flat' : ''} fav press${on ? ' on' : ''}`} aria-pressed={on} aria-label={on ? `Remove ${name} from saved` : `Save ${name}`} onClick={(e) => { e.stopPropagation(); onToggle(id); }} data-testid={`fav-${id}`}>
      <Star fill={on ? 'currentColor' : 'none'} />
    </button>
  );
}

const appName = (app: MapsApp) => (resolveMapsApp(app) === 'apple' ? 'Apple Maps' : 'Google Maps');

/** A real link into a maps app, keeping the garage and destination together. No routing happens here. */
export function DirectionsBlock({ entry, destination, destinationPlace, app, onRoute }: { entry: GarageEntry; destination: string | null; destinationPlace: string | null; app: MapsApp; onRoute?: () => void }) {
  const maps = resolveMapsApp(app);
  const to = entry.place ?? destinationPlace;
  const note = entry.place
    ? entry.standsInFor ? `Opens ${appName(app)} to the real ${entry.standsInFor}. Meridian's availability for it here is simulated.`
      : entry.source === 'demo' ? `Opens ${appName(app)} to the real garage. The availability shown is a demo example.`
      : `Opens ${appName(app)}, which also works with the screen off.`
    : destination ? `This virtual garage has no real address, so directions go to ${destination}.`
    : 'This virtual garage has no real address. Choose a destination to get directions there.';
  return (
    <div className="dirs" data-testid="directions-block">
      {onRoute && entry.geo && <button type="button" className="btn ink press" onClick={onRoute} data-testid="route-to-garage">Route to this garage</button>}
      {to ? (
        <a className={`${onRoute && entry.geo ? 'alink' : 'btn dir'} press`} href={directionsUrl(maps, to)} target="_blank" rel="noopener noreferrer" data-testid="directions">
          {entry.place ? (onRoute && entry.geo ? `Open in ${appName(app)}` : 'Directions to garage') : `Directions to ${destination}`}
        </a>
      ) : <button type="button" className="btn" disabled data-testid="directions-none">No address to navigate to</button>}
      {entry.place && destinationPlace && (
        <a className="alink" href={directionsUrl(maps, destinationPlace, { from: entry.place, mode: 'walking' })} target="_blank" rel="noopener noreferrer" data-testid="directions-walk">Walking directions from garage to {destination}</a>
      )}
      <p className="fine" data-testid="directions-note">{note}</p>
    </div>
  );
}

function rowLine(r: Ranked): { num: string; text: string } {
  const e = r.entry;
  if (e.source === 'demo') return { num: String(r.spaces ?? 0), text: 'in the demo feed' };
  if (e.source === 'unavailable') return { num: '—', text: 'Availability not available' };
  if (!r.counts) return { num: '—', text: 'Connecting…' };
  if (!r.trusted) return { num: '—', text: 'Live data paused' };
  if (r.openDisabled) return { num: String(r.counts.occupied), text: 'seen occupied · open can’t be confirmed' };
  return { num: String(r.counts.open), text: 'confirmed open' };
}

export function GarageRow({ r, on, onOpen, onToggle }: { r: Ranked; on: boolean; onOpen: () => void; onToggle: (id: string) => void }) {
  const l = rowLine(r);
  const green = r.trusted && !r.openDisabled && r.entry.facility && (r.counts?.open ?? 0) > 0;
  return (
    <div className="grow" data-testid={`garage-row-${r.entry.id}`} data-tier={r.tier}>
      <button type="button" className="grow-main press" onClick={onOpen}>
        <span className={`grow-num${green ? ' on' : ''}`} data-testid="row-count">{l.num}</span>
        <span className="t">
          <b>{r.entry.name}</b>
          <small>{l.text}</small>
          <span className="grow-tags"><GarageSource source={r.entry.source} />{r.walkMinutes !== null && (r.walkSource === 'routed' ? <span className="walkt" data-testid="row-walk">{r.walkMinutes} min walk</span> : <SourceTag source="demo">{`${r.walkMinutes} min walk · estimate`}</SourceTag>)}</span>
        </span>
      </button>
      <FavoriteButton id={r.entry.id} name={r.entry.name} on={on} onToggle={onToggle} />
    </div>
  );
}

type Filter = 'all' | 'saved' | 'open' | 'map';
const FILTERS: [Filter, string][] = [['all', 'All'], ['saved', 'Saved'], ['open', 'Confirmed open'], ['map', 'Space map']];

export function GarageList({ ranked, saved, loading, failed, destination, destinationIsClass, onOpen, onToggle, onRetry, onClose, onDestination, onClearRecents }: {
  ranked: Ranked[]; saved: Saved; loading: boolean; failed: boolean; destination: string | null; destinationIsClass: boolean;
  onOpen: (id: string) => void; onToggle: (id: string) => void; onRetry: () => void; onClose: () => void; onDestination: (d: string) => void; onClearRecents: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const best = ranked.find((r) => r.tier === 0) ?? null;
  const shown = ranked.filter((r) => (filter === 'saved' ? saved.favorites.includes(r.entry.id) : filter === 'open' ? r.tier === 0 : filter === 'map' ? !!r.entry.facility && r.entry.source !== 'unavailable' : true));
  const recent = saved.recentGarages.map((id) => ranked.find((r) => r.entry.id === id)).filter((r): r is Ranked => !!r);
  const sub = destination
    ? ranked.some((r) => r.walkSource === 'routed') || destinationIsClass ? `Ranked for ${destination}` : `Walking time to ${destination} isn't available, so these are ranked by confirmed spaces`
    : 'Choose a destination to compare by walk.';
  return (
    <div className="panel" style={{ gap: 16, paddingBottom: 36 }} data-testid="garage-list">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
          <h2 className="title">Garages</h2>
          <p className="body" style={{ fontSize: 14 }} data-testid="list-sub">{sub}</p>
        </div>
        <button type="button" className="circ flat press" aria-label="Close garage list" onClick={onClose}><Close /></button>
      </div>
      {failed ? (
        <div className="card" data-testid="list-error">
          <b className="strong">Can't reach Meridian</b>
          <span className="body">Garages will load when the server answers. Nothing is shown as available.</span>
          <button type="button" className="btn ink press" onClick={onRetry} style={{ marginTop: 6 }}>Try again</button>
        </div>
      ) : loading ? (
        <div style={{ display: 'grid', gap: 10 }} data-testid="list-loading" aria-label="Loading garages">
          {[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 84, borderRadius: 24 }} />)}
        </div>
      ) : (
        <>
          <div className="fchips" role="group" aria-label="Filter garages">
            {FILTERS.map(([f, label]) => <button key={f} type="button" className="fchip press" aria-pressed={filter === f} onClick={() => setFilter(f)} data-testid={`filter-${f}`}>{label}</button>)}
          </div>
          {shown.length ? (
            <div className="grows" aria-live="polite">
              {shown.map((r) => (
                <div key={r.entry.id}>
                  {best?.entry.id === r.entry.id && <div className="reco" data-testid="recommended"><span className="ey">Recommended</span><span>{r.reasons.join(' · ')}</span></div>}
                  <GarageRow r={r} on={saved.favorites.includes(r.entry.id)} onOpen={() => onOpen(r.entry.id)} onToggle={onToggle} />
                </div>
              ))}
            </div>
          ) : (
            <p className="body empty" data-testid="list-empty">
              {filter === 'saved' ? 'No saved garages yet. Tap a star to keep one here.' : filter === 'open' ? 'No garage has a space you can use confirmed open right now. Uncertain spaces aren’t offered.' : 'No garage has a space map right now.'}
            </p>
          )}
          {(recent.length > 0 || saved.recentDestinations.length > 0) && (
            <div className="recents" data-testid="recents">
              <div className="row"><span className="sec" style={{ padding: 0 }}>Recent</span><button type="button" className="alink" onClick={onClearRecents} data-testid="clear-recents">Clear</button></div>
              <div className="qchips">
                {saved.recentDestinations.map((d) => <button key={d} type="button" className="rchip press" onClick={() => onDestination(d)} data-testid="recent-destination"><span className="sq" />{d}</button>)}
                {recent.map((r) => <button key={r.entry.id} type="button" className="rchip press" onClick={() => onOpen(r.entry.id)} data-testid="recent-garage">{r.entry.name}<Chevron width={13} height={13} /></button>)}
              </div>
            </div>
          )}
          <p className="fine">Spaces aren't reserved. Uncertain spaces are never counted as available.</p>
        </>
      )}
    </div>
  );
}
