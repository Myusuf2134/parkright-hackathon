/** Connects the journey state machine to the directions provider and to GPS. */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { LatLng } from '../campus/types.ts';
import { RoutingError, type DirectionsProvider, type Route, type RoutingFailure } from '../routing/types.ts';
import { advance, canReroute, prepare, type Fix, type NavState } from './engine.ts';
import { metres } from './geo.ts';
import { JOURNEY_IDLE, journeyReducer, legEnd, NO_ENDS, type Journey, type JourneyTarget, type LegEnds, type TravelMode } from './journey.ts';
import { bestRoute, type PlanPoint } from './plan.ts';

const failure = (e: unknown): RoutingFailure => (e instanceof RoutingError ? e.kind : 'network');
export { GPS_STALE_MS } from './constants.ts';

export interface JourneyApi {
  journey: Journey;
  nav: NavState | null;
  /** A chosen start point, used when GPS isn't. Previews only: guidance needs real GPS. */
  manualOrigin: { name: string; at: LatLng } | null;
  setManualOrigin: (o: { name: string; at: LatLng } | null) => void;
  open: (target: JourneyTarget, mode: TravelMode) => void;
  setMode: (m: TravelMode) => void;
  select: (i: number) => void;
  retry: () => void;
  start: () => void;
  startWalk: () => void;
  finishLeg: () => void;
  close: () => void;
}

export function useJourney(provider: DirectionsProvider, fix: Fix | null): JourneyApi {
  const [journey, dispatch] = useReducer(journeyReducer, JOURNEY_IDLE);
  const [manualOrigin, setManualOrigin] = useState<{ name: string; at: LatLng } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [nav, setNav] = useState<NavState | null>(null);
  const fixRef = useRef(fix);
  fixRef.current = fix;
  const hasFix = fix !== null;

  // ---- preview: fetch routes for the current target, mode and origin
  const previewKey = journey.phase === 'preview' ? `${journey.mode}|${journey.target.garage?.id}|${journey.target.destination?.name}` : null;
  const originKey = manualOrigin ? `m:${manualOrigin.at.lat},${manualOrigin.at.lng}` : hasFix ? 'gps' : 'none';
  useEffect(() => {
    if (journey.phase !== 'preview') return;
    const { target, mode } = journey;
    const from = manualOrigin?.at ?? fixRef.current ?? null;
    const ctl = new AbortController();
    const signal = ctl.signal;
    (async () => {
      if (!from) { dispatch({ type: 'no-origin' }); return; }
      dispatch({ type: 'loading' });
      const origin: PlanPoint = { ...from, kind: 'building-centre', side: null };
      const dest = target.destination, garage = target.garage;
      try {
        let ends: LegEnds = NO_ENDS, walkLeg: Route | null = null, walkLegFailed = false;
        let routes: Route[];
        if (mode === 'drive') {
          const tos: PlanPoint[] = garage ? garage.drive : dest ? [{ lat: dest.lat, lng: dest.lng, kind: 'building-centre', side: null }] : [];
          if (!tos.length) { dispatch({ type: 'no-origin' }); return; }
          const drive = await bestRoute(provider, 'driving', [origin], tos, { alternatives: true, signal });
          routes = drive.routes;
          ends = { ...ends, driveTo: drive.to };
          if (garage && dest) {
            try {
              const walk = await bestRoute(provider, 'walking', garage.walkFrom(dest), dest.walkTo(drive.to), { signal });
              walkLeg = walk.routes[0] ?? null;
              ends = { ...ends, walkFrom: walk.from, walkTo: walk.to };
            } catch (e) {
              if (failure(e) === 'aborted') return;
              walkLegFailed = true;
            }
          }
        } else {
          const tos = dest ? dest.walkTo(from) : garage ? garage.walkFrom(from) : [];
          if (!tos.length) { dispatch({ type: 'no-origin' }); return; }
          const walk = await bestRoute(provider, 'walking', [origin], tos, { alternatives: true, signal });
          routes = walk.routes;
          ends = { ...ends, walkTo: walk.to };
        }
        // A provider snaps both ends to the same point when they're on one stretch of road.
        if (routes[0].distance < 15) { dispatch({ type: 'routes-failed', kind: 'too-close' }); return; }
        dispatch({ type: 'routes', routes, walkLeg, walkLegFailed, ends });
      } catch (e) {
        if (failure(e) !== 'aborted') dispatch({ type: 'routes-failed', kind: failure(e) });
      }
    })();
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, originKey, attempt, provider]);

  // ---- navigation: every fix advances the engine; leaving the route asks for a new one
  const route = journey.phase === 'navigating' ? journey.route : null;
  const prepared = useMemo(() => (route ? prepare(route) : null), [route]);
  const lastReroute = useRef(0);
  const navRef = useRef<NavState | null>(null);
  useEffect(() => { navRef.current = null; setNav(null); }, [prepared]);
  useEffect(() => {
    if (!prepared || !fix || journey.phase !== 'navigating') return;
    const next = advance(navRef.current, prepared, fix);
    navRef.current = next;
    setNav(next);
    if (next.arrived) { dispatch({ type: 'reached' }); return; }
    if (journey.rerouting || !canReroute(next, lastReroute.current, Date.now())) return;
    const end = legEnd(journey.target, journey.leg, journey.ends);
    if (!end) return;
    lastReroute.current = Date.now();
    dispatch({ type: 'reroute-start' });
    provider.route({ profile: journey.leg === 'drive' ? 'driving' : 'walking', from: fix, to: end })
      .then((r) => dispatch(r[0] ? { type: 'reroute-done', route: r[0] } : { type: 'reroute-failed' }))
      .catch(() => dispatch({ type: 'reroute-failed' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix, prepared]);

  // ---- the screen stays on during guidance, where the browser allows it
  const navigating = journey.phase === 'navigating';
  useEffect(() => {
    if (!navigating || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null, live = true;
    const take = () => { void navigator.wakeLock.request('screen').then((l) => { if (live) lock = l; else void l.release(); }).catch(() => {}); };
    const onVisible = () => { if (document.visibilityState === 'visible') take(); };
    take();
    document.addEventListener('visibilitychange', onVisible);
    return () => { live = false; document.removeEventListener('visibilitychange', onVisible); void lock?.release(); };
  }, [navigating]);

  const open = useCallback((target: JourneyTarget, mode: TravelMode) => { dispatch({ type: 'open', target, mode }); }, []);
  const setMode = useCallback((mode: TravelMode) => dispatch({ type: 'mode', mode }), []);
  const select = useCallback((index: number) => dispatch({ type: 'select', index }), []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const start = useCallback(() => dispatch({ type: 'start' }), []);
  const finishLeg = useCallback(() => dispatch({ type: 'reached' }), []);
  const close = useCallback(() => dispatch({ type: 'close' }), []);
  const startWalk = useCallback(() => {
    if (journey.phase !== 'at-garage' || !journey.target.destination) return;
    const here = fixRef.current;
    const planned = journey.walkLeg;
    const goWith = (r: Route) => dispatch({ type: 'start-walk', route: r });
    // Near the planned door, or with GPS too poor inside a garage to place you, the planned walk is the right one.
    const start = planned ? { lat: planned.geometry[0][1], lng: planned.geometry[0][0] } : null;
    if (planned && (!here || here.accuracy > 40 || (start && metres(here, start) < 60))) { goWith(planned); return; }
    if (!here) { dispatch({ type: 'walk-failed' }); return; }
    dispatch({ type: 'walk-loading' });
    provider.route({ profile: 'walking', from: here, to: journey.ends.walkTo ?? journey.target.destination })
      .then((r) => { if (r[0]) goWith(r[0]); else if (planned) goWith(planned); else dispatch({ type: 'walk-failed' }); })
      .catch(() => { if (planned) goWith(planned); else dispatch({ type: 'walk-failed' }); });
  }, [journey, provider]);

  return { journey, nav, manualOrigin, setManualOrigin, open, setMode, select, retry, start, startWalk, finishLeg, close };
}
