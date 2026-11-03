/**
 * Foreground guidance over the map. Every instruction, distance and time comes from the directions
 * response and real GPS; when GPS goes quiet or the route is lost, the screen says so instead of guessing.
 * It needs Meridian open and on screen: a browser can't navigate in the background.
 */
import { motion } from 'motion/react';
import { useState } from 'react';
import { clockAt, formatDistance, formatDuration } from '../maps/nav/geo.ts';
import { walkEndNote, walkStartNote } from '../maps/nav/plan.ts';
import { GPS_STALE_MS, type JourneyApi } from '../maps/nav/useJourney.ts';
import type { Fix } from '../maps/nav/engine.ts';
import type { Geo } from '../maps/nav/useGeolocation.ts';
import type { DirectionsProvider } from '../maps/routing/types.ts';
import { Close, Locate } from '../ui/icons.tsx';

function ManeuverIcon({ type, modifier }: { type: string; modifier: string | null }) {
  const m = modifier ?? 'straight';
  const paths: Record<string, string> = {
    straight: 'M12 21V4M6 10l6-6 6 6',
    left: 'M18 21v-7a4 4 0 0 0-4-4H5M10 4l-6 6 6 6',
    right: 'M6 21v-7a4 4 0 0 1 4-4h9M14 4l6 6-6 6',
    'slight left': 'M15 21v-6L7 7M7 13V7h6',
    'slight right': 'M9 21v-6l8-8M17 13V7h-6',
    'sharp left': 'M18 3v9a3 3 0 0 1-3 3H6M11 21l-6-6 6-6',
    'sharp right': 'M6 3v9a3 3 0 0 0 3 3h9M13 21l6-6-6-6',
    uturn: 'M7 21V9a5 5 0 0 1 10 0v5M12 9l5 6 5-6',
  };
  const d = type === 'arrive' ? 'M12 21s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z' : paths[m] ?? paths.straight;
  return <svg viewBox="0 0 24 24" width={38} height={38} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

export function Navigate({ j, fix, geo, now, provider, following, onRecenter, parkingLine, parkingSource, online, onEnd }: {
  j: JourneyApi; fix: Fix | null; geo: Geo; now: number; provider: DirectionsProvider;
  following: boolean; onRecenter: () => void;
  parkingLine: string | null; parkingSource: string | null; online: boolean; onEnd: () => void;
}) {
  const s = j.journey;
  const [confirm, setConfirm] = useState(false);
  const [steps, setSteps] = useState(false);
  const nav = j.nav;

  if (s.phase === 'at-garage') {
    return (
      <div className="nav-bottom">
        <div className="nav-tray" data-testid="at-garage">
          <div className="ey">You've reached</div>
          <h2 className="title">{s.target.garage?.name}</h2>
          {parkingLine && <p className="body" style={{ fontSize: 14 }}>{parkingLine}{parkingSource ? ` · ${parkingSource}` : ''}</p>}
          <p className="body" style={{ fontSize: 15 }}>Find a space, then continue on foot to {s.target.destination?.name}.</p>
          {s.ends.walkFrom && <p className="fine" style={{ padding: 0 }} data-testid="exit-note">{walkStartNote(s.ends.walkFrom)}</p>}
          {s.walkFailed && <p className="fine" role="alert" data-testid="walk-failed">Couldn't get walking directions. Check your connection and try again.</p>}
          <div className="acts">
            <button type="button" className="btn green press" disabled={s.loadingWalk} onClick={j.startWalk} data-testid="start-walk">{s.loadingWalk ? 'Finding the way…' : "I've parked, start walking"}</button>
            <button type="button" className="circ flat lg press" aria-label="End navigation" onClick={onEnd}><Close /></button>
          </div>
        </div>
      </div>
    );
  }
  if (s.phase === 'arrived') {
    return (
      <div className="nav-bottom">
        <div className="nav-tray" data-testid="arrived">
          <div className="ey">You've arrived</div>
          <h2 className="title">{s.target.destination?.name ?? s.target.garage?.name}</h2>
          <div className="acts"><button type="button" className="btn ink press" onClick={onEnd} data-testid="nav-done">Done</button></div>
        </div>
      </div>
    );
  }
  if (s.phase !== 'navigating') return null;

  const list = s.route.steps;
  const idx = nav?.stepIndex ?? 0;
  const step = list[idx + 1] ?? list[idx] ?? null;
  const then = list[idx + 2] ?? null;
  const stale = !fix || now - fix.at > GPS_STALE_MS;
  const banner = geo.status === 'denied' ? 'Location was turned off. Guidance has stopped following you.'
    : stale ? 'Waiting for GPS. Your position and times below may be out of date.'
    : s.rerouting ? 'Off route. Finding a new route…'
    : s.rerouteFailed ? (online ? "Off route, and a new route couldn't be found. Trying again." : "Off route and offline. A new route can't be fetched.")
    : nav?.offRoute ? 'Off route.'
    : nav?.weak ? `Weak GPS, ±${Math.round(fix?.accuracy ?? 0)} m. Progress is paused until it improves.`
    : !online ? "You're offline. The current route still works, but it can't change." : null;
  const remaining = nav?.remaining ?? s.route.distance;
  const seconds = nav?.remainingSeconds ?? s.route.duration;

  return (
    <>
      <div className="nav-top">
        <motion.div className={`nav-card ${s.leg}`} initial={{ y: -24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} data-testid="nav-card" data-step={idx}>
          <span className="nav-ic"><ManeuverIcon type={step?.type ?? 'depart'} modifier={step?.modifier ?? null} /></span>
          <div className="nav-text">
            <b className="nav-dist" data-testid="nav-distance">{formatDistance(nav?.toManeuver ?? list[0]?.distance ?? 0)}</b>
            <div className="nav-ins" data-testid="nav-instruction" aria-live="polite">{step?.instruction ?? ''}</div>
            {then && then.type !== 'arrive' && <div className="nav-then" data-testid="nav-then">Then: {then.instruction}</div>}
          </div>
        </motion.div>
        {banner && <div className="nav-banner" role="status" data-testid="nav-banner">{banner}</div>}
      </div>
      <div className="nav-bottom">
        {!following && <button type="button" className="btn ink press nav-recenter" onClick={onRecenter} data-testid="nav-recenter"><Locate width={18} height={18} />Recenter</button>}
        <motion.div className="nav-tray" initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} data-testid="nav-tray">
          <div className="row" style={{ alignItems: 'center' }}>
            <div style={{ display: 'grid', gap: 3 }}>
              <b className="nav-eta" data-testid="nav-eta">{formatDuration(seconds)}</b>
              <span className="body nav-sub"><span data-testid="nav-remaining">{formatDistance(remaining)}</span> · arrive {clockAt(now + seconds * 1000)}{s.route.trafficAware ? ' · with traffic' : ''}</span>
            </div>
            <button type="button" className="circ flat lg press" aria-label="End navigation" onClick={() => setConfirm(true)} data-testid="nav-end"><Close /></button>
          </div>
          {s.leg === 'drive' && s.target.garage && (
            <div className="nav-park" data-testid="nav-parking"><b>{s.target.garage.name}</b><span>{parkingLine ?? 'No availability data'}{parkingSource ? ` · ${parkingSource}` : ''}</span></div>
          )}
          {s.leg === 'walk' && s.target.destination && <p className="fine" style={{ padding: 0 }} data-testid="walk-end-note">{walkEndNote(s.ends.walkTo, s.route, s.target.destination.name)}</p>}
          {nav === null || s.reroutes === 0 ? null : <span className="fine" style={{ padding: 0 }} data-testid="nav-reroutes">Rerouted {s.reroutes} time{s.reroutes === 1 ? '' : 's'}</span>}
          <div className="nav-links">
            <button type="button" className="alink" onClick={() => setSteps((v) => !v)} aria-expanded={steps} data-testid="nav-steps-toggle">{steps ? 'Hide steps' : 'All steps'}</button>
            {(remaining < 150 || stale) && <button type="button" className="alink" onClick={j.finishLeg} data-testid="finish-leg">{s.leg === 'drive' ? "I'm at the garage" : "I've arrived"}</button>}
          </div>
          {steps && <ol className="rsteps nav-steps" data-testid="nav-steps">{list.slice(idx + 1).map((st, i) => <li key={i}><span>{st.instruction}</span>{st.distance > 0 && <small>{formatDistance(st.distance)}</small>}</li>)}</ol>}
          <p className="fine" style={{ padding: 0 }}>Keep Meridian open and on screen. {provider.attribution}</p>
          {confirm && (
            <div className="acts"><button type="button" className="btn press" onClick={() => setConfirm(false)}>Keep going</button><button type="button" className="btn ink press" onClick={onEnd} data-testid="nav-end-confirm">End</button></div>
          )}
        </motion.div>
      </div>
    </>
  );
}
