/**
 * Route preview: how to travel, the routes the provider returned, and the journey as drive, park, walk.
 * The start control lives in RouteStartBar, always at the bottom of the screen within thumb reach.
 */
import { useState } from 'react';
import { activeCampus } from '../maps/campus/index.ts';
import { clockAt, formatDistance, formatDuration } from '../maps/nav/geo.ts';
import { driveEndNote, startNote, walkEndNote, walkStartNote } from '../maps/nav/plan.ts';
import type { StartGate } from '../maps/nav/startGate.ts';
import type { Geo } from '../maps/nav/useGeolocation.ts';
import type { JourneyApi } from '../maps/nav/useJourney.ts';
import { failureText, type DirectionsProvider, type Route } from '../maps/routing/types.ts';
import { Back, Car, Locate } from '../ui/icons.tsx';

export const WalkIcon = ({ size = 18 }: { size?: number }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="13" cy="4.5" r="1.8" /><path d="M9 21l2.5-6.5L9 11l1.5-3.5L14 8.5l2 3.5 3 1M11.5 14.5l3 2 1 4.5M10.5 7.5L7 10l-1 3.5" /></svg>;

function trafficLine(r: Route, p: DirectionsProvider): string | null {
  if (r.profile !== 'driving') return null;
  if (!r.trafficAware) return p.supportsTraffic ? 'Without live traffic' : 'Live traffic not included';
  if (r.durationTypical === null) return 'Includes live traffic';
  const d = Math.round((r.duration - r.durationTypical) / 60);
  return d > 0 ? `Includes live traffic · ${d} min slower than usual` : 'Includes live traffic · usual for now';
}

export function RoutePanel({ j, geo, provider, now, parkingLine, parkingSource, onClose }: {
  j: JourneyApi; geo: Geo; provider: DirectionsProvider; now: number;
  /** What's known about the garage's spaces, exactly as the rest of the app words it. */
  parkingLine: string | null; parkingSource: string | null;
  onClose: () => void;
}) {
  const [steps, setSteps] = useState(false);
  const s = j.journey;
  if (s.phase !== 'preview') return null;
  const { target, mode, routes, selected, load, ends, walkLeg } = s;
  const picked: Route | undefined = routes[selected];
  const campus = activeCampus();
  const toName = mode === 'drive' ? target.garage?.name ?? target.destination?.name : target.destination?.name ?? target.garage?.name;
  const totalS = picked ? picked.duration + (mode === 'drive' ? walkLeg?.duration ?? 0 : 0) : 0;
  const start = startNote(picked ?? null, j.manualOrigin?.name ?? null);
  return (
    <div className="panel rpanel" data-testid="route-panel">
      <div className="row" style={{ alignItems: 'center' }}>
        <button type="button" className="circ flat press" aria-label="Close route preview" onClick={onClose} data-testid="route-close"><Back /></button>
        <div className="seg rmode" role="group" aria-label="Travel mode">
          <button type="button" aria-pressed={mode === 'drive'} onClick={() => j.setMode('drive')} data-testid="mode-drive"><Car width={18} height={18} />Drive</button>
          <button type="button" aria-pressed={mode === 'walk'} onClick={() => j.setMode('walk')} data-testid="mode-walk"><WalkIcon />Walk</button>
        </div>
      </div>

      {load.state === 'loading' && (
        <div style={{ display: 'grid', gap: 10 }} data-testid="routes-loading" role="status" aria-label="Finding routes">
          <div className="skel" style={{ height: 76, borderRadius: 22 }} />
        </div>
      )}
      {load.state === 'no-origin' && <p className="body" data-testid="routes-no-origin">Share your location or choose a start point above to see routes.</p>}
      {load.state === 'error' && (
        <div className="card" data-testid="routes-error" role="alert">
          <b className="strong">No route to show</b>
          <span className="body">{failureText(load.kind)}</span>
          {load.kind !== 'too-close' && <button type="button" className="btn ink press" onClick={j.retry} style={{ marginTop: 6 }} data-testid="routes-retry">Try again</button>}
        </div>
      )}

      {routes.length > 0 && (
        <div className="rlist" role="radiogroup" aria-label="Routes">
          {routes.map((r, i) => (
            <button key={r.id} type="button" role="radio" aria-checked={i === selected} className={`rcard press${i === selected ? ' on' : ''}`} onClick={() => j.select(i)} data-testid="route-option">
              <span className="rtime" data-testid="route-time">{formatDuration(r.duration)}</span>
              <span className="rmeta">
                <b>{formatDistance(r.distance)}{r.summary ? ` · via ${r.summary}` : ''}</b>
                <small data-testid="route-traffic">{trafficLine(r, provider) ?? 'Walking'}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="rends" data-testid="route-ends">
        <div className="rend">
          <span className="rdot" />
          <label className="rfrom">
            <small>From</small>
            <select
              data-testid="origin-select"
              aria-label="Start point"
              value={j.manualOrigin?.name ?? ''}
              onChange={(e) => {
                const b = campus.buildings.find((x) => x.name === e.target.value);
                j.setManualOrigin(b ? { name: b.name, at: b } : null);
                if (!b && !geo.fix) geo.request();
              }}
            >
              <option value="">{geo.fix ? 'Your location' : geo.status === 'requesting' ? 'Finding your location…' : 'Your location (not available)'}</option>
              {campus.buildings.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </select>
          </label>
          {!geo.fix && geo.status !== 'requesting' && geo.status !== 'insecure' && geo.status !== 'unsupported' && <button type="button" className="circ flat press" aria-label="Use my location" onClick={geo.request} data-testid="use-location"><Locate /></button>}
        </div>
        <div className="rend"><span className="rdot to" /><span className="rto"><small>To</small><b data-testid="route-to">{toName}</b></span></div>
      </div>

      {start && <p className="fine" data-testid="start-gap">{start}</p>}

      {picked && (
        <ol className="rjourney" data-testid="journey">
          {mode === 'drive' ? (
            <>
              <li className="leg drive" data-testid="drive-leg">
                <span className="legic"><Car width={16} height={16} /></span>
                <div><b>Drive {formatDuration(picked.duration)}</b><span>{formatDistance(picked.distance)} to {target.garage?.name ?? target.destination?.name}</span>
                  {target.garage && <small data-testid="drive-end">{driveEndNote(ends.driveTo, picked)}</small>}
                  {!target.garage && <small>This route ends at the building. Parking isn't included.</small>}
                </div>
              </li>
              {target.garage && (
                <li className="leg park" data-testid="garage-leg">
                  <span className="legic">P</span>
                  <div><b>Park</b>
                    <span data-testid="route-parking">{parkingLine ?? 'No availability data for this garage'}</span>
                    {parkingSource && <small className="rsrc" data-testid="route-parking-source">{parkingSource}</small>}
                  </div>
                </li>
              )}
              {walkLeg && target.destination && (
                <li className="leg walk" data-testid="walk-leg">
                  <span className="legic"><WalkIcon size={16} /></span>
                  <div><b>Walk {formatDuration(walkLeg.duration)}</b><span>{formatDistance(walkLeg.distance)} to {target.destination.name}</span>
                    <small data-testid="walk-start">{walkStartNote(ends.walkFrom)}</small>
                    <small data-testid="walk-end">{walkEndNote(ends.walkTo, walkLeg, target.destination.name)}</small>
                  </div>
                </li>
              )}
              {s.walkLegFailed && <li className="leg walk"><span className="legic"><WalkIcon size={16} /></span><div><small data-testid="walk-leg-failed">Couldn't get the walk from the garage. It will be tried again when you park.</small></div></li>}
            </>
          ) : (
            <li className="leg walk" data-testid="walk-only">
              <span className="legic"><WalkIcon size={16} /></span>
              <div><b>Walk {formatDuration(picked.duration)}</b><span>{formatDistance(picked.distance)} to {toName}</span>
                {target.destination && <small data-testid="walk-end">{walkEndNote(ends.walkTo, picked, target.destination.name)}</small>}
              </div>
            </li>
          )}
        </ol>
      )}
      {picked && mode === 'drive' && walkLeg && <p className="rtotal" data-testid="route-total">{formatDuration(totalS)} in all · arrive about {clockAt(now + totalS * 1000)}, before finding a space</p>}

      {picked && (
        <>
          <button type="button" className="alink" onClick={() => setSteps((v) => !v)} aria-expanded={steps} data-testid="toggle-steps">{steps ? 'Hide steps' : 'Show every step'}</button>
          {steps && (
            <div data-testid="steps">
              <ol className="rsteps" data-testid="steps-main">{picked.steps.map((st, i) => <li key={i}><span>{st.instruction}</span>{st.distance > 0 && <small>{formatDistance(st.distance)}</small>}</li>)}</ol>
              {mode === 'drive' && walkLeg && <><div className="sec">Then on foot</div><ol className="rsteps" data-testid="steps-walk">{walkLeg.steps.map((st, i) => <li key={i}><span>{st.instruction}</span>{st.distance > 0 && <small>{formatDistance(st.distance)}</small>}</li>)}</ol></>}
            </div>
          )}
        </>
      )}
      <p className="fine" data-testid="route-attribution">{provider.attribution}. Garage doors and entrances: OpenStreetMap, not checked on site.</p>
    </div>
  );
}

/** Always on screen: Start, or exactly why not and what to do about it. */
export function RouteStartBar({ j, geo, gate }: { j: JourneyApi; geo: Geo; gate: StartGate }) {
  const s = j.journey;
  if (s.phase !== 'preview') return null;
  const accuracy = geo.fix && gate.ok ? `GPS ±${Math.round(geo.fix.accuracy)} m` : null;
  const act = () => {
    if (gate.action === 'use-location') j.setManualOrigin(null);
    else if (gate.action === 'request') geo.request();
  };
  return (
    <div className="rstartbar" data-testid="start-bar" data-gate={gate.code ?? 'ok'}>
      {!gate.ok && gate.code !== 'no-route' && (
        <div className="rreason" role="status" data-testid="start-reason">
          <div className="t">
            <b>{gate.code === 'acquiring' && <span className="spin" aria-hidden />}{gate.title}</b>
            <small>{gate.detail}</small>
          </div>
          {gate.action && <button type="button" className="btn press rreason-act" onClick={act} data-testid="start-action">{gate.action === 'use-location' ? 'Use my location' : 'Try again'}</button>}
        </div>
      )}
      <button type="button" className="btn green press" onClick={j.start} disabled={!gate.ok} data-testid="start-nav">{s.mode === 'drive' ? 'Start driving' : 'Start walking'}{accuracy && <small className="rgps" data-testid="gps-accuracy">{accuracy}</small>}</button>
    </div>
  );
}
