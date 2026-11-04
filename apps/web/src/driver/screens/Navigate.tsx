/**
 * Foreground guidance over the map. Every instruction, distance and time comes from the directions
 * response and real GPS; when GPS goes quiet or the route is lost, the screen says so instead of guessing.
 * It needs Meridian open and on screen: a browser can't navigate in the background.
 */
import { animate, motion, useMotionValue } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { clockAt, formatDistance, formatDuration } from '../maps/nav/geo.ts';
import { walkEndNote, walkStartNote } from '../maps/nav/plan.ts';
import { upcomingSteps, type Upcoming } from '../maps/nav/steps.ts';
import { GPS_STALE_MS, type JourneyApi } from '../maps/nav/useJourney.ts';
import type { Fix } from '../maps/nav/engine.ts';
import type { Geo } from '../maps/nav/useGeolocation.ts';
import type { DirectionsProvider } from '../maps/routing/types.ts';
import { prefersReducedMotion } from '../lib/time.ts';
import { Back, Chevron, Close, Locate } from '../ui/icons.tsx';
import { WalkIcon } from './RoutePanel.tsx';

const ARROWS: Record<string, string> = {
  straight: 'M12 21V4M6 10l6-6 6 6',
  left: 'M18 21v-7a4 4 0 0 0-4-4H5M10 4l-6 6 6 6',
  right: 'M6 21v-7a4 4 0 0 1 4-4h9M14 4l6 6-6 6',
  'slight left': 'M15 21v-6L7 7M7 13V7h6',
  'slight right': 'M9 21v-6l8-8M17 13V7h-6',
  'sharp left': 'M18 3v9a3 3 0 0 1-3 3H6M11 21l-6-6 6-6',
  'sharp right': 'M6 3v9a3 3 0 0 0 3 3h9M13 21l6-6-6-6',
  uturn: 'M7 21V9a5 5 0 0 1 10 0v5M12 9l5 6 5-6',
};
const PIN = 'M12 21s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z';
const ROUNDABOUT = 'M12 21v-6M12 15a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zM15.2 9.3 19 5.5M19 9.5v-4h-4';

export function ManeuverIcon({ type, modifier, size = 38 }: { type: string; modifier: string | null; size?: number }) {
  const d = type === 'arrive' ? PIN : type === 'roundabout' || type === 'rotary' ? ROUNDABOUT : ARROWS[modifier ?? 'straight'] ?? ARROWS.straight;
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

/** After looking ahead, the banner comes back to the next maneuver on its own. */
const RETURN_AFTER_MS = 10_000;

/**
 * The next maneuver, and every one after it a swipe away. Looking ahead never changes the route or the
 * progress along it: the card for the next maneuver is always one tap ("Now") or a short wait away.
 */
export function StepBanner({ upcoming, leg, view, onView }: {
  upcoming: Upcoming[]; leg: 'drive' | 'walk';
  /** Step index on show, or null to follow the next maneuver. */
  view: number | null; onView: (index: number | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const x = useMotionValue(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const at = Math.max(0, view === null ? 0 : upcoming.findIndex((u) => u.index === view));
  const last = upcoming.length - 1;
  const go = (k: number) => { const n = Math.min(last, Math.max(0, k)); onView(n === 0 ? null : upcoming[n].index); };
  const settle = () => { const to = -at * width; if (prefersReducedMotion()) x.set(to); else animate(x, to, { type: 'spring', visualDuration: 0.32, bounce: 0.08 }); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(settle, [at, width]);
  useEffect(() => {
    if (view === null) return;
    const t = setTimeout(() => onView(null), RETURN_AFTER_MS);
    return () => clearTimeout(t);
  }, [view, onView]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); }
    if (e.key === 'Home') { e.preventDefault(); go(0); }
  };
  if (!upcoming.length) return null;
  const now = upcoming[0];
  const after = upcoming[1];
  return (
    <div className={`nav-steps-banner ${leg}`} data-testid="nav-card" data-step={now.index} data-view={upcoming[at].index}>
      <div className="nsb-window" ref={box} tabIndex={0} role="group" aria-roledescription="carousel" aria-label={`Instructions, ${at + 1} of ${upcoming.length}. Swipe or use the arrow keys to look ahead.`} onKeyDown={onKey}>
        <motion.div
          className="nsb-track" style={{ x }}
          drag={upcoming.length > 1 ? 'x' : false} dragConstraints={{ left: -last * width, right: 0 }} dragElastic={0.18} dragMomentum={false}
          onDragEnd={(_, info) => {
            const dx = info.offset.x, v = info.velocity.x;
            const step = Math.abs(v) > 400 || Math.abs(dx) > width * 0.22 ? (dx < 0 ? 1 : -1) : 0;
            if (step && at + step >= 0 && at + step <= last) go(at + step); else settle();
          }}
        >
          {upcoming.map((u, k) => {
            const current = k === 0;
            return (
              <div key={u.index} className={`nsb-card${current ? ' now' : ''}`} aria-hidden={k !== at} data-testid={current ? 'nav-card-now' : 'nav-card-later'}>
                <span className="nav-ic"><ManeuverIcon type={u.step.type} modifier={u.step.modifier} size={44} /></span>
                <div className="nav-text">
                  <b className="nav-dist" data-testid={current ? 'nav-distance' : undefined}>{formatDistance(u.distance)}</b>
                  <div className="nav-ins" data-testid={current ? 'nav-instruction' : 'nav-instruction-later'} aria-live={current ? 'polite' : undefined}>{u.step.instruction}</div>
                  {current && after && after.step.type !== 'arrive' && <div className="nav-then" data-testid="nav-then"><ManeuverIcon type={after.step.type} modifier={after.step.modifier} size={15} />Then {after.step.instruction}</div>}
                  {!current && <div className="nav-then nav-later">Step {k + 1} of {upcoming.length} · looking ahead</div>}
                </div>
              </div>
            );
          })}
        </motion.div>
      </div>
      {upcoming.length > 1 && (
        <div className="nsb-row">
          <div className="nsb-pager">
            <button type="button" aria-label="Previous instruction" disabled={at === 0} onClick={() => go(at - 1)} data-testid="nav-step-prev"><Back /></button>
            <span className="nsb-dots" aria-hidden>
              {upcoming.slice(0, 7).map((u, k) => <i key={u.index} className={k === Math.min(at, 6) ? 'on' : ''} />)}
            </span>
            <span className="nsb-count" data-testid="nav-step-count">{at + 1}/{upcoming.length}</span>
            <button type="button" aria-label="Next instruction" disabled={at === last} onClick={() => go(at + 1)} data-testid="nav-step-next"><Chevron /></button>
          </div>
          {at > 0 && <button type="button" className="nsb-return press" onClick={() => go(0)} data-testid="nav-step-return">Back to next turn</button>}
        </div>
      )}
    </div>
  );
}

export function Navigate({ j, fix, geo, now, provider, following, onRecenter, overview, onOverview, pitched, onTogglePitch, parkingLine, parkingSource, online, onEnd, onInsets }: {
  j: JourneyApi; fix: Fix | null; geo: Geo; now: number; provider: DirectionsProvider;
  following: boolean; onRecenter: () => void;
  /** The whole remaining route in view, instead of following. */
  overview: boolean; onOverview: () => void;
  /** Perspective camera while following. */
  pitched: boolean; onTogglePitch: () => void;
  parkingLine: string | null; parkingSource: string | null; online: boolean; onEnd: () => void;
  /** How much of the screen the banner and the bottom bar cover, so the camera frames the map between them. */
  onInsets: (i: { top: number; bottom: number }) => void;
}) {
  const s = j.journey;
  const [confirm, setConfirm] = useState(false);
  const [steps, setSteps] = useState(false);
  const [view, setView] = useState<number | null>(null);
  const nav = j.nav;
  const route = s.phase === 'navigating' ? s.route : null;
  const upcoming = route ? upcomingSteps(route, nav) : [];
  // A card looked at that's now behind the driver (or on a replaced route) goes back to following.
  const viewGone = view !== null && !upcoming.some((u) => u.index === view);
  useEffect(() => { if (viewGone) setView(null); }, [viewGone]);
  useEffect(() => { setView(null); setSteps(false); }, [route]);
  const topRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const top = topRef.current, tray = trayRef.current;
    const frame = (top ?? tray)?.closest('.app');
    if (!frame) return;
    const read = () => {
      const f = frame.getBoundingClientRect();
      onInsets({ top: top ? Math.round(top.getBoundingClientRect().bottom - f.top) : 0, bottom: tray ? Math.round(f.bottom - tray.getBoundingClientRect().top) : 0 });
    };
    read();
    const ro = new ResizeObserver(read);
    if (top) ro.observe(top);
    if (tray) ro.observe(tray);
    return () => ro.disconnect();
  }, [s.phase, onInsets]);

  if (s.phase === 'at-garage') {
    const walk = s.walkLeg;
    return (
      <div className="nav-bottom">
        <motion.div ref={trayRef} className="nav-tray arrive-tray" data-testid="at-garage" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <div className="arr-head">
            <span className="arr-badge" aria-hidden>P</span>
            <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
              <div className="ey">{s.target.garage ? "You've reached" : 'Time to park'}</div>
              <h2 className="title arr-title">{s.target.garage?.name ?? `Near ${s.target.destination?.name ?? 'your destination'}`}</h2>
            </div>
          </div>
          {(parkingLine || parkingSource) && (
            <div className="nav-park" data-testid="arrive-parking"><b>{parkingLine ?? 'No availability data'}</b>{parkingSource && <span className="nav-src">{parkingSource}</span>}</div>
          )}
          <div className="arr-next" data-testid="arrive-next">
            <span className="arr-walk"><WalkIcon size={18} /></span>
            <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
              <b>Then walk to {s.target.destination?.name}</b>
              <span>{walk ? `${formatDuration(walk.duration)} · ${formatDistance(walk.distance)} on foot` : 'Walking directions are fetched when you start'}</span>
              {s.ends.walkFrom && <small data-testid="exit-note">{walkStartNote(s.ends.walkFrom)}</small>}
            </div>
          </div>
          <p className="fine" style={{ padding: 0 }}>Meridian doesn't assume you've parked. Start the walk once you're out of the car.</p>
          {s.walkFailed && <p className="fine" role="alert" data-testid="walk-failed">Couldn't get walking directions. Check your connection and try again.</p>}
          <div className="acts">
            <button type="button" className="btn green press" disabled={s.loadingWalk} onClick={j.startWalk} data-testid="start-walk">{s.loadingWalk ? 'Finding the way…' : "I've parked — start walking"}</button>
            <button type="button" className="circ flat lg press" aria-label="End navigation" onClick={onEnd}><Close /></button>
          </div>
        </motion.div>
      </div>
    );
  }
  if (s.phase === 'arrived') {
    return (
      <div className="nav-bottom">
        <motion.div ref={trayRef} className="nav-tray arrive-tray" data-testid="arrived" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <div className="arr-head">
            <span className="arr-badge done" aria-hidden><ManeuverIcon type="arrive" modifier={null} size={20} /></span>
            <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
              <div className="ey">You've arrived</div>
              <h2 className="title arr-title">{s.target.destination?.name ?? s.target.garage?.name}</h2>
            </div>
          </div>
          <div className="acts"><button type="button" className="btn ink press" onClick={onEnd} data-testid="nav-done">Done</button></div>
        </motion.div>
      </div>
    );
  }
  if (s.phase !== 'navigating') return null;

  const list = s.route.steps;
  const idx = nav?.stepIndex ?? 0;
  const stale = !fix || now - fix.at > GPS_STALE_MS;
  const banner = geo.status === 'denied' ? 'Location was turned off. Guidance has stopped following you.'
    : stale ? 'Waiting for GPS. Your position and times below may be out of date.'
    : s.rerouting ? 'Off route. Finding a new route…'
    : s.rerouteFailed ? (online ? "Off route, and a new route couldn't be found. Trying again." : "Off route and offline. A new route can't be fetched.")
    : nav?.offRoute ? 'Off route.'
    : nav?.weak ? `Weak GPS, ±${Math.round(fix?.accuracy ?? 0)} m. Progress is paused until it improves.`
    : !online ? "You're offline. The current route still works, but it can't change." : null;
  const offRoute = !!(s.rerouting || s.rerouteFailed || nav?.offRoute);
  const remaining = nav?.remaining ?? s.route.distance;
  const seconds = nav?.remainingSeconds ?? s.route.duration;
  const to = s.leg === 'drive' ? s.target.garage?.name ?? s.target.destination?.name : s.target.destination?.name ?? s.target.garage?.name;

  return (
    <>
      <div className="nav-top" ref={topRef}>
        <motion.div initial={{ y: -24, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <StepBanner upcoming={upcoming} leg={s.leg} view={view} onView={setView} />
        </motion.div>
        {banner && <div className={`nav-banner${offRoute ? ' off' : ''}`} role="status" data-testid="nav-banner">{banner}</div>}
      </div>
      <div className="nav-bottom">
        <div className="nav-fabs">
          {(!following || overview) && <button type="button" className="btn ink press nav-recenter" onClick={onRecenter} data-testid="nav-recenter"><Locate width={18} height={18} />Recenter</button>}
        </div>
        <motion.div ref={trayRef} className="nav-tray nav-bar" initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} data-testid="nav-tray">
          <div className="nb-summary">
            <div className="nb-stat main"><b className="nav-eta" data-testid="nav-eta">{clockAt(now + seconds * 1000)}</b><small>arrival</small></div>
            <div className="nb-stat"><b data-testid="nav-minutes">{formatDuration(seconds).replace(' min', '')}</b><small>{seconds >= 3600 ? 'left' : 'min'}</small></div>
            <div className="nb-stat"><b data-testid="nav-remaining">{formatDistance(remaining)}</b><small>left</small></div>
            <button type="button" className="nb-end press" aria-label="End navigation" onClick={() => setConfirm(true)} data-testid="nav-end">End</button>
          </div>
          {confirm && (
            <div className="acts nb-confirm"><button type="button" className="btn press" onClick={() => setConfirm(false)}>Keep going</button><button type="button" className="btn ink press" onClick={onEnd} data-testid="nav-end-confirm">End route</button></div>
          )}
          <div className="nb-dest" data-testid="nav-destination">
            <span className={`nb-leg ${s.leg}`}>{s.leg === 'drive' ? 'Driving to' : 'Walking to'}</span>
            <b>{to}</b>
            {s.leg === 'drive' && s.target.garage && s.target.destination && <span className="nb-then">then walk to {s.target.destination.name}</span>}
          </div>
          {s.leg === 'drive' && s.target.garage && (
            <div className="nav-park" data-testid="nav-parking"><b>{parkingLine ?? 'No availability data'}</b>{parkingSource && <span className="nav-src">{parkingSource}</span>}</div>
          )}
          {s.leg === 'walk' && s.target.destination && <p className="fine" style={{ padding: 0 }} data-testid="walk-end-note">{walkEndNote(s.ends.walkTo, s.route, s.target.destination.name)}</p>}
          {nav === null || s.reroutes === 0 ? null : <span className="fine" style={{ padding: 0 }} data-testid="nav-reroutes">Rerouted {s.reroutes} time{s.reroutes === 1 ? '' : 's'}</span>}
          <div className="nb-actions" role="toolbar" aria-label="Navigation controls">
            <button type="button" className={`nb-btn press${overview ? ' on' : ''}`} aria-pressed={overview} onClick={onOverview} data-testid="nav-overview">Overview</button>
            <button type="button" className={`nb-btn press${steps ? ' on' : ''}`} aria-expanded={steps} onClick={() => setSteps((v) => !v)} data-testid="nav-steps-toggle">Steps</button>
            <button type="button" className={`nb-btn press${pitched ? ' on' : ''}`} aria-pressed={pitched} onClick={onTogglePitch} data-testid="nav-3d">3D</button>
            {(remaining < 150 || stale) && <button type="button" className="nb-btn press" onClick={j.finishLeg} data-testid="finish-leg">{s.leg === 'drive' ? "I'm at the garage" : "I've arrived"}</button>}
          </div>
          {steps && (
            <ol className="nav-steps" data-testid="nav-steps">
              {list.map((st, i) => {
                const done = i <= idx;
                const looked = view === i;
                return (
                  <li key={i} className={`${done ? 'done' : ''}${i === idx + 1 ? ' next' : ''}${looked ? ' looked' : ''}`}>
                    <button type="button" disabled={done} onClick={() => setView(i === idx + 1 ? null : i)} aria-label={`${st.instruction}${done ? ', done' : ', show in the banner'}`}>
                      <span className="ns-ic"><ManeuverIcon type={st.type} modifier={st.modifier} size={20} /></span>
                      <span className="ns-t">{st.instruction}</span>
                      {st.distance > 0 && <small>{formatDistance(st.distance)}</small>}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="fine nb-fine" data-testid="nav-traffic">{s.leg === 'drive' ? (s.route.trafficAware ? 'Includes live traffic · ' : 'No live traffic · ') : ''}No voice guidance · Keep this screen on · {provider.attribution}</p>
        </motion.div>
      </div>
    </>
  );
}
