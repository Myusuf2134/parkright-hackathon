import { AnimatePresence, MotionConfig, motion, useMotionValue } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchSpace, useAdvice, useDemoInfo, useFacilities, useHealth, useScenario } from './net/api.ts';
import { IDLE_VIEW, useLiveFleet } from './net/live.ts';
import { buildDirectory, campusPlace, entranceOf, knownDestinations, rankGarages, type GarageStatus } from './lib/directory.ts';
import { garageTitle } from './lib/names.ts';
import { useSaved } from './lib/saved.ts';
import { summarize } from './lib/evidence.ts';
import { countSpaces, offerable, readingOrder, suggestSpace } from './lib/parking.ts';
import { flags, usePrefs } from './lib/prefs.ts';
import { prefersReducedMotion, useNow } from './lib/time.ts';
import { Explore, type Mode, type ParkingCtx, type PlaceInfo } from './screens/Explore.tsx';
import { useDriveEstimate } from './maps/nav/useDriveEstimate.ts';
import { AboutData, SearchSheet } from './screens/Modals.tsx';
import { Plan } from './screens/Plan.tsx';
import { Splash, type SplashVariant } from './screens/Splash.tsx';
import { Trip, tripStatus, type TripWatch } from './screens/Trip.tsx';
import { You } from './screens/You.tsx';
import { RoutePanel, RouteStartBar } from './screens/RoutePanel.tsx';
import { Navigate } from './screens/Navigate.tsx';
import { activeCampus, findBuilding } from './maps/campus/index.ts';
import { MeridianMap, type MapHandle, type MapLoad, type MapPin, type RouteLine } from './maps/MeridianMap.tsx';
import { GarageMapPin, DestinationMapPin, RouteMark } from './maps/Pins.tsx';
import { driveTargets, walkEnds, walkStarts } from './maps/nav/plan.ts';
import { startGate } from './maps/nav/startGate.ts';
import { resolveTheme } from './maps/mapStyle.ts';
import { prepare, remainingGeometry } from './maps/nav/engine.ts';
import type { JourneyTarget } from './maps/nav/journey.ts';
import { useGeolocation } from './maps/nav/useGeolocation.ts';
import { useJourney } from './maps/nav/useJourney.ts';
import { useWalkTimes } from './maps/nav/useWalkTimes.ts';
import { createProvider } from './maps/routing/index.ts';
import { haptic, useFrameHeight, useSafeArea } from './ui/layout.ts';
import { FloatingTabs, type FloatingAction } from './ui/FloatingTabs.tsx';
import { useArrival, type LiveParking } from './arrival/useArrival.ts';

type Tab = 'explore' | 'plan' | 'you';
/** Floating tab bar, bottom offset and breathing room above the device safe area. */
const TABS_H = 94;
interface Toast { id: number; text: string; tone: 'warn' | 'good' }

function initialSplash(): SplashVariant | null {
  const q = new URLSearchParams(location.search).get('splash');
  if (q === 'off') return null;
  if (q === 'full' || q === 'short' || q === 'reduced') return q;
  if (flags.session('splashShown')) return null;
  if (prefersReducedMotion()) return 'reduced';
  return flags.get('introSeen') ? 'short' : 'full';
}

/** Optional deep links used by the presentation tour: ?tab=plan|you, ?sheet=garage|space. */
function initialView(): { tab: Tab; mode: Mode; garage: string | null } {
  const q = new URLSearchParams(location.search);
  const t = q.get('tab'), m = q.get('sheet');
  const sheet = m === 'half' || m === 'place' || m === 'garage' || m === 'space' || m === 'list' ? m : q.get('dest') ? 'place' : 'peek';
  return { tab: t === 'plan' || t === 'you' ? t : 'explore', mode: sheet, garage: q.get('garage') };
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function DriverApp() {
  const frame = useRef<HTMLDivElement>(null);
  const viewport = useFrameHeight(frame);
  const safe = useSafeArea();
  const now = useNow(1000);
  const [prefs, updatePrefs] = usePrefs();

  // ---- data
  const [facilities, retryFacilities] = useFacilities();
  const scenario = useScenario();
  const health = useHealth();
  const demo = useDemoInfo();
  const { saved, toggleFavorite, togglePlace, viewedGarage, usedDestination, clearRecents } = useSaved();
  const facilityList = useMemo(() => (facilities.state === 'ok' ? facilities.value : []), [facilities]);
  const fleet = useLiveFleet(useMemo(() => facilityList.map((f) => f.facility_id), [facilityList]));
  const campus = useMemo(activeCampus, []);
  const provider = useMemo(() => createProvider(), []);
  const entries = useMemo(() => buildDirectory(facilityList, scenario, campus), [facilityList, scenario, campus]);
  // ---- destination (from the demo schedule until the driver changes it)
  // A shared link (?dest=) opens that place; otherwise the demo schedule's class, until the driver changes it.
  const [dest, setDest] = useState<string | null | undefined>(() => new URLSearchParams(location.search).get('dest') ?? undefined);
  const destination = dest ?? null;
  const classDestination = scenario?.next_class.destination_short ?? null;
  const destinationIsClass = destination !== null && destination === classDestination;
  const destinations = useMemo(() => knownDestinations(scenario, campus), [scenario, campus]);
  const known = destinations.find((d) => d.short === destination);
  const destinationPlace = destination ? (known ? campusPlace(known.name) : destination) : null;
  const destinationGeo = useMemo(() => findBuilding(campus, known?.name ?? destination) ?? findBuilding(campus, destination), [campus, known?.name, destination]);
  const walkGarages = useMemo(() => entries.flatMap((e) => { const g = e.geo; return g ? [{ id: e.id, at: (toward: { lat: number; lng: number }) => walkStarts(g, toward)[0], always: !!e.facility }] : []; }), [entries]);
  const routedWalk = useWalkTimes(provider, destinationGeo, walkGarages);
  // ---- every garage, ranked with live state
  const statuses = useMemo(() => entries.map((entry): GarageStatus => {
    const v = entry.facility ? fleet[entry.facility.facility_id] : undefined;
    const c = v?.everLive ? countSpaces(v.safeSpaces, prefs) : null;
    return { entry, trusted: !!v?.trusted, counts: c, openDisabled: demo?.allowOpen === false && (c?.open ?? 0) === 0 && !!entry.facility };
  }), [entries, fleet, prefs, demo?.allowOpen]);
  const ranked = useMemo(() => rankGarages(statuses, { priority: prefs.priority, destinationIsClass, favorites: saved.favorites, routedWalk }), [statuses, prefs.priority, destinationIsClass, saved.favorites, routedWalk]);
  // ---- the garage on screen: what the driver opened, else a pick that holds still until it stops being usable
  const [chosen, setChosen] = useState<string | null>(() => initialView().garage);
  const pick = useRef<{ id: string | null; key: string }>({ id: null, key: '' });
  const pickKey = `${destination}|${prefs.priority}`;
  const pickedNow = ranked.find((r) => r.entry.id === pick.current.id);
  const bestMonitored = ranked.find((r) => r.tier === 0 && r.entry.facility);
  if (!pickedNow || pick.current.key !== pickKey || (pickedNow.tier !== 0 && bestMonitored)) {
    const wanted = scenario?.simulator.facility_id;
    pick.current = { id: bestMonitored?.entry.id ?? entries.find((e) => e.id === wanted)?.id ?? entries.find((e) => e.facility)?.id ?? entries.find((e) => e.candidate)?.id ?? null, key: pickKey };
  }
  const entry = entries.find((e) => e.id === chosen) ?? entries.find((e) => e.id === pick.current.id) ?? null;
  const facilityId = entry?.facility?.facility_id ?? null;
  const live = (facilityId && fleet[facilityId]) || IDLE_VIEW;
  const facility = live.facility ?? entry?.facility ?? null;
  const site = demo?.site && facility && (garageTitle(facility.name) === demo.site.title || facilityList.length === 1) ? demo.site : null;
  const spaces = useMemo(() => readingOrder(live.safeSpaces, facility?.levels), [live.safeSpaces, facility?.levels]);
  const counts = useMemo(() => countSpaces(spaces, prefs), [spaces, prefs]);
  const suggested = useMemo(() => (live.trusted ? suggestSpace(spaces, prefs, facility?.levels) : null), [live.trusted, spaces, prefs, facility?.levels]);
  // Per-space evidence ages: the garage label is as old as its oldest current view.
  const evidence = useMemo(() => summarize(spaces, now, live.clockOffsetMs), [spaces, now, live.clockOffsetMs]);
  // The running detector can't report OPEN (allow_open false): zero open means "can't confirm", not "full".
  const openDisabled = demo?.allowOpen === false && counts.open === 0;

  // ---- Arrival Intelligence (demo schedule + live parking near class)
  const parking: LiveParking | null = useMemo(() => (facility ? { trusted: live.trusted, open: counts.open, forYou: counts.forYou, garage: garageTitle(facility.name), simulated: facility.is_simulated, openDisabled } : null), [facility, live.trusted, counts.open, counts.forYou, openDisabled]);
  const arrival = useArrival(scenario, parking);
  const arrivalDest = arrival.result.movedTo?.buildingShort ?? arrival.result.session.buildingShort;

  useEffect(() => { if (dest === undefined && scenario !== undefined) setDest(scenario ? arrivalDest : null); }, [scenario, dest, arrivalDest]);
  const fromSchedule = destination !== null && destination === arrivalDest && !arrival.result.canceled;
  const leaveBy = fromSchedule && arrival.result.departure.state === 'ok' ? arrival.result.departure.leaveAt : null;

  // ---- navigation state
  const [tab, setTab] = useState<Tab>(() => initialView().tab);
  const [youSection, setYouSection] = useState<'top' | 'alerts'>('top');
  const [mode, setMode] = useState<Mode>(() => initialView().mode);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const cameFromList = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [trip, setTrip] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [modal, setModal] = useState<'about' | 'search' | null>(null);
  const [splash, setSplash] = useState<SplashVariant | null>(initialSplash);
  const [revealed, setRevealed] = useState(splash === null);
  const closeModal = useCallback(() => setModal(null), []);
  const sheetY = useMotionValue(viewport);

  // ---- map, location and the journey
  const mapApi = useRef<MapHandle>(null);
  const [mapLoad, setMapLoad] = useState<MapLoad>('loading');
  // A retry builds a new map, which also starts new tile workers.
  const [mapKey, setMapKey] = useState(0);
  const retryMap = useCallback(() => { setMapLoad('loading'); setMapKey((k) => k + 1); }, []);
  /** Resting height of the Explore sheet, so the map frames what's left above it. */
  const [sheetH, setSheetH] = useState(0);
  const [bearing, setBearing] = useState(0);
  const [following, setFollowing] = useState(true);
  // Guidance camera: the whole remaining route at once, and perspective or flat while following.
  const [overview, setOverview] = useState(false);
  const [pitched, setPitched] = useState(true);
  const [navInsets, setNavInsets] = useState({ top: 0, bottom: 0 });
  const [centerOnFix, setCenterOnFix] = useState(false);
  const [askedLocation, setAskedLocation] = useState(false);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => { const q = matchMedia('(prefers-color-scheme: dark)'); const on = () => setSystemDark(q.matches); q.addEventListener('change', on); return () => q.removeEventListener('change', on); }, []);
  const geo = useGeolocation();
  const j = useJourney(provider, geo.fix);
  const beforeRoute = useRef<Mode>('peek');
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => { const up = () => setOnline(true), down = () => setOnline(false); addEventListener('online', up); addEventListener('offline', down); return () => { removeEventListener('online', up); removeEventListener('offline', down); }; }, []);

  // ---- toasts
  const [toast, setToast] = useState<Toast | null>(null);
  const say = useCallback((text: string, tone: Toast['tone'] = 'warn') => setToast({ id: Date.now(), text, tone }), []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4200); return () => clearTimeout(t); }, [toast]);

  // ---- saved garage alerts: in-app only, when one goes from nothing usable to something usable
  const usable = useRef(new Map<string, number>());
  useEffect(() => {
    for (const r of ranked) {
      if (!r.entry.facility || !r.trusted || !r.counts) continue;
      const before = usable.current.get(r.entry.id);
      const n = r.openDisabled ? 0 : r.counts.forYou;
      usable.current.set(r.entry.id, n);
      if (before === 0 && n > 0 && prefs.favoriteAlerts && saved.favorites.includes(r.entry.id) && r.entry.id !== entry?.id) say(`${r.entry.name} now has ${n} confirmed open.`, 'good');
    }
  }, [ranked, prefs.favoriteAlerts, saved.favorites, entry?.id, say]);
  // ---- safety: a chosen space that stops being offerable is withdrawn, out loud.
  useEffect(() => {
    if (trip || !selected) return;
    const s = spaces.find((x) => x.space_id === selected);
    if (s && offerable(s, prefs) && live.trusted) return;
    setSelected(null);
    say(live.trusted ? `${selected} is no longer confirmed open.` : `Live data paused. ${selected} can't be confirmed right now.`);
    haptic(20);
  }, [spaces, selected, prefs, live.trusted, trip, say]);

  // Preselect the suggested space when the picker opens.
  useEffect(() => { if (mode === 'space' && !selected && suggested) setSelected(suggested.space_id); }, [mode, selected, suggested]);

  // In-app watch for a space to open (not a push notification).
  useEffect(() => {
    if (watching && live.trusted && counts.forYou > 0) { setWatching(false); say(`A space just opened${suggested ? `: ${suggested.space_id}` : ''}.`, 'good'); haptic(12); }
  }, [watching, live.trusted, counts.forYou, suggested, say]);

  // Trip watch: alert when the chosen space stops being confirmed open.
  const tripSpace = trip ? spaces.find((s) => s.space_id === trip) : undefined;
  const watch: TripWatch | null = trip ? tripStatus(tripSpace, live, prefs) : null;
  const lastWatch = useRef<TripWatch | null>(null);
  useEffect(() => {
    // The trip sheet itself turns into the warning (and announces it); the alert adds a buzz where supported.
    if (watch && lastWatch.current === 'ok' && watch !== 'ok' && prefs.spaceAlerts) haptic(30);
    lastWatch.current = watch;
  }, [watch, trip, prefs.spaceAlerts, say]);

  // ---- advice: only while garage details are open, debounced against fast-changing evidence
  const signature = useDebounced(JSON.stringify([facilityId, live.trusted, spaces.map((s) => [s.space_id, s.current_state, s.stale])]), 1200);
  const advice = useAdvice(facilityId, signature, tab === 'explore' && mode === 'garage' && !trip && live.trusted && counts.open > 0);

  // ---- actions
  /** From a list, a garage opens in full; from the map it opens half way, so the map stays in view. */
  const openGarage = useCallback((id: string, to: Mode = 'garage') => {
    cameFromList.current = mode === 'list';
    setChosen(id);
    setSelected(null);
    viewedGarage(id);
    setTab('explore');
    setYouSection('top');
    setMode(to);
  }, [mode, viewedGarage]);
  const closeGarage = useCallback(() => {
    if (cameFromList.current) setMode('list');
    else { setMode('peek'); setChosen(null); }
    cameFromList.current = false;
  }, []);
  const pickDestination = useCallback((d: string) => {
    setDest(d);
    usedDestination(d);
    setChosen(null);
    setTab('explore');
    setYouSection('top');
    setMode('place');
  }, [usedDestination]);
  // Hardware and browser back steps through the app's own views.
  const fromPop = useRef(false);
  const closeJourneyRef = useRef(() => {});
  closeJourneyRef.current = () => { if (j.journey.phase === 'preview') j.close(); };
  const lastPushed = useRef('');
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const v = e.state as { tab: Tab; mode: Mode; chosen: string | null; trip: string | null } | null;
      if (!v?.tab) return;
      fromPop.current = true;
      if (v.mode !== 'route') closeJourneyRef.current();
      setTab(v.tab); setYouSection('top'); setMode(v.mode); setChosen(v.chosen); setTrip(v.trip);
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    const state = { tab, mode, chosen, trip };
    const key = JSON.stringify(state);
    if (key === lastPushed.current) return;
    const first = !lastPushed.current;
    lastPushed.current = key;
    if (fromPop.current) { fromPop.current = false; return; }
    const url = new URL(location.href);
    if (chosen) url.searchParams.set('garage', chosen); else url.searchParams.delete('garage');
    if (first) history.replaceState(state, '', url);
    else history.pushState(state, '', url);
  }, [tab, mode, chosen, trip]);
  const trustedRef = useRef(live.trusted);
  trustedRef.current = live.trusted;
  const go = useCallback(async (spaceId: string) => {
    if (!facilityId) return;
    setChecking(spaceId);
    try {
      const fresh = await fetchSpace(facilityId, spaceId);
      // Recheck against a fresh read and the live connection as it is now, not when Go was pressed.
      if (!trustedRef.current || !offerable(fresh, prefs)) {
        say(`${spaceId} is no longer confirmed open. Choose another space.`);
        setSelected(null);
        setMode('space');
        return;
      }
      setTrip(spaceId);
      setSelected(spaceId);
      haptic(12);
    } catch {
      say(`Couldn't recheck ${spaceId}. Check your connection and try again.`);
    } finally {
      setChecking(null);
    }
  }, [facilityId, prefs, say]);

  // ---- routes
  const destinationTarget = useMemo(() => (destinationGeo ? { lat: destinationGeo.lat, lng: destinationGeo.lng, name: destinationGeo.name, walkTo: (from: { lat: number; lng: number }) => walkEnds(destinationGeo, from) } : null), [destinationGeo]);
  const targetFor = useCallback((e: typeof entry): JourneyTarget => {
    const g = e?.geo;
    return {
      garage: e && g ? { id: e.id, name: g.name, lat: g.lat, lng: g.lng, hasEntrance: g.entrances.length > 0, drive: driveTargets(g), walkFrom: (toward) => walkStarts(g, toward) } : null,
      destination: destinationTarget,
    };
  }, [destinationTarget]);
  const openRoute = useCallback((target: JourneyTarget, travel: 'drive' | 'walk') => {
    if (mode !== 'route') beforeRoute.current = mode;
    if (!geo.fix && geo.status === 'off') geo.request();
    j.open(target, travel);
    setTab('explore');
    setMode('route');
  }, [mode, geo, j]);
  const closeRoute = useCallback(() => { j.close(); setFollowing(true); setMode(beforeRoute.current === 'route' ? 'peek' : beforeRoute.current); mapApi.current?.flat(); }, [j]);
  const routeGarage = ranked.find((r) => r.tier === 0 && r.entry.geo) ?? null;
  // The place sheet's drive time: to the garage it recommends, from here, only while it's open.
  const estimateTo = useMemo(() => {
    const g = routeGarage?.entry.geo;
    return g ? { id: routeGarage.entry.id, ...(driveTargets(g)[0] ?? g) } : null;
  }, [routeGarage?.entry.id, routeGarage?.entry.geo]);
  const estimate = useDriveEstimate(provider, tab === 'explore' && mode === 'place' && destinationGeo ? geo.fix : null, estimateTo);
  const place: PlaceInfo | null = destination ? {
    name: destinationGeo?.name ?? destination, short: destinationGeo?.short ?? destination, address: destinationGeo?.address ?? null,
    known: !!destinationGeo, category: destinationGeo ? 'Campus building' : 'Typed destination', saved: saved.places.includes(destination),
  } : null;
  const sharePlace = useCallback(async () => {
    if (!destination) return;
    const url = new URL('/app/', location.origin);
    url.searchParams.set('dest', destination);
    const title = destinationGeo?.name ?? destination;
    try {
      if (navigator.share) { await navigator.share({ title, text: `${title}, on Meridian`, url: url.href }); return; }
      await navigator.clipboard.writeText(url.href);
      say('Link copied', 'good');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') say("Couldn't share this place from this browser.");
    }
  }, [destination, destinationGeo?.name, say]);
  const onDestinationRoute = destinationTarget
    // Best confirmed garage if there is one; otherwise walk, and the sheet can switch to a drive to the building.
    ? () => openRoute(targetFor(routeGarage?.entry ?? null), routeGarage ? 'drive' : 'walk')
    : null;

  // What's known about the journey's garage, in the app's usual words, with its source named.
  const jGarage = j.journey.phase !== 'idle' ? j.journey.target.garage : null;
  const jRanked = jGarage ? ranked.find((r) => r.entry.id === jGarage.id) : null;
  const parkingLine = jRanked
    ? jRanked.entry.source === 'demo' ? `${jRanked.spaces} spaces in the demo feed, not live`
    : !jRanked.entry.facility || jRanked.entry.source === 'unavailable' ? null
    : !jRanked.trusted || !jRanked.counts ? 'Live data paused'
    : jRanked.openDisabled ? 'Empty spaces can’t be confirmed yet'
    : `${jRanked.counts.open} confirmed open`
    : null;
  const parkingSource = jRanked ? ({ simulated: 'Simulated, not real availability', demo: 'Demo feed', live: 'Live', unavailable: null } as const)[jRanked.entry.source] : null;

  // ---- what the map draws
  const fix = geo.fix;
  const navigating = j.journey.phase === 'navigating';
  const preparedNav = useMemo(() => (j.journey.phase === 'navigating' ? prepare(j.journey.route) : null), [j.journey]);
  const routeLines = useMemo((): RouteLine[] => {
    const s = j.journey;
    if (s.phase === 'preview') {
      const alts = s.routes.map((r, i): RouteLine => ({ id: r.id, coords: r.geometry, role: i === s.selected ? 'selected' : 'alternative' }));
      return [...alts.filter((r) => r.role === 'alternative'), ...alts.filter((r) => r.role === 'selected'), ...(s.walkLeg ? [{ id: 'walk-leg', coords: s.walkLeg.geometry, role: 'walk' as const }] : [])];
    }
    if (s.phase === 'navigating' && preparedNav) {
      const coords = j.nav ? remainingGeometry(preparedNav, j.nav) : s.route.geometry;
      return [{ id: s.route.id, coords, role: s.leg === 'walk' ? 'walk' : 'selected' }, ...(s.walkLeg ? [{ id: 'walk-leg', coords: s.walkLeg.geometry, role: 'walk' as const }] : [])];
    }
    if (s.phase === 'at-garage' && s.walkLeg) return [{ id: 'walk-leg', coords: s.walkLeg.geometry, role: 'walk' }];
    return [];
  }, [j.journey, j.nav, preparedNav]);
  const pinRanked = useMemo(() => ranked.filter((r) => r.entry.geo), [ranked]);
  const ends = j.journey.phase === 'preview' || j.journey.phase === 'navigating' || j.journey.phase === 'at-garage' ? j.journey.ends : null;
  const travel = j.journey.phase === 'preview' ? j.journey.mode : j.journey.phase === 'navigating' ? j.journey.leg : 'drive';
  const pins = useMemo((): MapPin[] => {
    const inJourney = j.journey.phase !== 'idle';
    const list: MapPin[] = [];
    for (const r of pinRanked) {
      if (inJourney && r.entry.id !== jGarage?.id) continue;
      if (inJourney && travel === 'walk' && j.journey.phase !== 'at-garage') continue;
      // On a route, the availability badge sits on the far side of the garage from where the route arrives.
      const side = inJourney ? ends?.driveTo?.side : null;
      const anchor = side === 'west' ? 'left' : side === 'east' ? 'right' : side === 'north' ? 'top' : side === 'south' ? 'bottom' : inJourney ? 'left' : undefined;
      list.push({
        id: inJourney ? `${r.entry.id}:${anchor}` : r.entry.id, at: { lat: r.entry.geo!.lat, lng: r.entry.geo!.lng }, focused: r.entry.id === entry?.id, priority: r.tier < 2, anchor,
        node: <GarageMapPin r={r} flat={inJourney} active={!inJourney && r.entry.id === entry?.id && mode !== 'peek'} onOpen={() => { if (!inJourney) openGarage(r.entry.id, 'half'); }} />,
      });
    }
    if (j.journey.phase === 'preview' && j.manualOrigin) list.push({ id: 'mark-start', at: j.manualOrigin.at, anchor: 'center', priority: true, node: <RouteMark kind="start" label={`Start: ${j.manualOrigin.name}`} /> });
    if (travel === 'drive' && ends?.driveTo && ends.driveTo.kind !== 'garage-centre') list.push({ id: 'mark-entrance', at: ends.driveTo, anchor: 'center', focused: true, node: <RouteMark kind="entrance" label={`${ends.driveTo.side} vehicle entrance`} /> });
    if (ends?.walkFrom && ends.walkFrom.kind === 'door') list.push({ id: 'mark-exit', at: ends.walkFrom, anchor: 'center', priority: true, node: <RouteMark kind="exit" label={`${ends.walkFrom.side} pedestrian door`} /> });
    if (destinationGeo) list.push({ id: 'destination', at: inJourney && ends?.walkTo ? ends.walkTo : destinationGeo, anchor: 'top', node: <DestinationMapPin name={destinationGeo.short} onOpen={inJourney ? undefined : () => { setChosen(null); setTab('explore'); setMode('place'); }} /> });
    return list;
  }, [pinRanked, entry?.id, mode, destinationGeo, j.journey.phase, j.manualOrigin, jGarage?.id, openGarage, ends, travel]);
  const footprints = useMemo(() => {
    const id = j.journey.phase !== 'idle' ? jGarage?.id : mode !== 'peek' ? entry?.id : null;
    const g = id ? entries.find((e) => e.id === id)?.geo : null;
    return g ? [g.footprint] : [];
  }, [j.journey.phase, jGarage?.id, mode, entry?.id, entries]);
  const gate = startGate({ status: geo.status, fix, manualName: j.manualOrigin?.name ?? null, hasRoute: j.journey.phase === 'preview' && j.journey.routes.length > 0, now, isIOS: /iPhone|iPad|iPod/.test(navigator.userAgent) });

  // ---- camera
  const wide = () => matchMedia('(min-width: 1024px)').matches && !document.documentElement.dataset.device;
  // Above the sheet's resting height and below the search bar. A full-height sheet covers the map anyway.
  const sheetBottom = Math.min(sheetH || Math.max(0, viewport - sheetY.get()), Math.round(viewport * 0.62));
  const padding = useCallback(() => (wide() ? { left: 440, top: 40, bottom: 24, right: 60 } : { top: safe.top + 96, bottom: sheetBottom, left: 0, right: 0 }), [safe.top, sheetBottom]);
  const padForSheet = useCallback((animate = false) => { mapApi.current?.setPadding(padding(), animate); }, [padding]);
  const destKey = destinationGeo?.id ?? null;
  const pinKey = pinRanked.filter((r) => r.tier === 0).map((r) => r.entry.id).slice(0, 2).join();
  /** The collapsed view: the destination and the best garages near it. */
  const fitOverview = () => {
    padForSheet();
    const near = pinRanked.filter((r) => r.tier === 0).slice(0, 2).map((r) => r.entry.geo!);
    const points = destinationGeo ? [destinationGeo, ...near] : near.length ? near : campus.garages;
    mapApi.current?.fit(points, { maxZoom: 16 });
  };
  useEffect(() => {
    if (mapLoad !== 'ready' || j.journey.phase !== 'idle' || chosen || !revealed || modeRef.current !== 'peek') return;
    const t = setTimeout(fitOverview, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destKey, pinKey, mapLoad, revealed]);
  // When the sheet comes to rest, the map frames what's left above it: half way up, the garage the sheet is
  // about; back down from there, the overview. Not while a route or navigation owns the camera.
  const restingSheet = tab === 'explore' && (mode === 'peek' || mode === 'half' || mode === 'place') ? `${mode}:${sheetBottom}:${chosen}:${destKey}` : null;
  const lastRest = useRef<Mode | null>(null);
  useEffect(() => {
    if (mapLoad !== 'ready' || restingSheet === null || j.journey.phase !== 'idle') return;
    // The new mode lands a render before the sheet's measured height: act once both have settled.
    const t = setTimeout(() => {
      const was = lastRest.current;
      lastRest.current = mode;
      // A place: the building and the garage Meridian would send you to.
      if (mode === 'place' && destinationGeo) { padForSheet(); mapApi.current?.fit([destinationGeo, ...(routeGarage?.entry.geo ? [routeGarage.entry.geo] : [])], { maxZoom: 16.8 }); return; }
      const g = chosen || mode === 'half' ? entry?.geo : null;
      if (g) mapApi.current?.fly(g, 16.2, padding());
      else if (was === 'half') fitOverview();
      else padForSheet(true);
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restingSheet, mapLoad]);
  useEffect(() => {
    if (j.journey.phase !== 'preview' || !j.journey.routes.length) return;
    const t = setTimeout(() => {
      const s = j.journey;
      if (s.phase !== 'preview') return;
      // No search bar over the map here, so the route can use the space.
      if (wide()) padForSheet(); else mapApi.current?.setPadding({ top: safe.top, bottom: Math.max(0, viewport - sheetY.get()) });
      const g = [...(s.routes[s.selected]?.geometry ?? []), ...(s.walkLeg?.geometry ?? [])];
      mapApi.current?.fit(g.map(([lng, lat]) => ({ lat, lng })), { maxZoom: 17 });
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [j.journey.phase === 'preview' ? j.journey.routes : null, j.journey.phase === 'preview' ? j.journey.selected : null]);
  // Between the banner and the bottom bar, with the position in the lower part of that space so more of
  // the road ahead shows. Closer in as a maneuver comes up; further out at speed.
  const navPadding = useCallback(() => {
    if (wide()) return { left: 440, top: 40, bottom: 40, right: 40 };
    const top = navInsets.top || Math.round(viewport * 0.24), bottom = navInsets.bottom || Math.round(viewport * 0.3);
    const room = Math.max(0, viewport - top - bottom);
    return { top: top + Math.round(room * 0.3), bottom: bottom + 12, left: 0, right: 0 };
  }, [navInsets, viewport]);
  useEffect(() => {
    if (j.journey.phase !== 'navigating' || !fix || !following || overview) return;
    const driving = j.journey.route.profile === 'driving';
    const toTurn = j.nav?.toManeuver ?? Infinity, speed = fix.speed ?? 0;
    const zoom = driving ? (toTurn < 150 ? 17.2 : speed > 18 ? 15.7 : 16.5) : (toTurn < 40 ? 18 : 17.5);
    mapApi.current?.follow(j.nav?.snapped ?? fix, j.nav?.heading ?? null, j.journey.route.profile, { pitched, zoom, padding: navPadding() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [j.nav, following, overview, pitched, navPadding, j.journey.phase]);
  // Overview: what's left of this leg, and the walk after it.
  useEffect(() => {
    if (!overview || j.journey.phase !== 'navigating') return;
    const s = j.journey;
    const rest = preparedNav && j.nav ? remainingGeometry(preparedNav, j.nav) : s.route.geometry;
    const pad = navPadding();
    mapApi.current?.frame([...rest, ...(s.walkLeg?.geometry ?? [])], { top: (navInsets.top || 0) + 24, bottom: pad.bottom + 24, left: 32, right: 48 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview, j.journey.phase === 'navigating' ? j.journey.route : null]);
  useEffect(() => { if (j.journey.phase !== 'navigating') setOverview(false); }, [j.journey.phase]);
  // At the garage: the garage and the walk still to come, above the arrival card.
  useEffect(() => {
    const s = j.journey;
    if (s.phase !== 'at-garage') return;
    const t = setTimeout(() => {
      const pts: [number, number][] = [...(s.walkLeg?.geometry ?? []), ...(s.target.garage ? [[s.target.garage.lng, s.target.garage.lat] as [number, number]] : []), ...(fix ? [[fix.lng, fix.lat] as [number, number]] : [])];
      if (pts.length > 1) mapApi.current?.frame(pts, { top: safe.top + 40, bottom: (navInsets.bottom || Math.round(viewport * 0.5)) + 24, left: 40, right: 40 });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [j.journey.phase, navInsets.bottom]);
  useEffect(() => { if (centerOnFix && fix) { setCenterOnFix(false); mapApi.current?.fly(fix, 16, padding()); } }, [centerOnFix, fix, padding]);
  useEffect(() => { if (j.journey.phase === 'at-garage' || j.journey.phase === 'arrived') { setFollowing(true); mapApi.current?.flat(); } }, [j.journey.phase]);

  const onMapGesture = useCallback(() => setFollowing(false), []);
  const locate = useCallback(() => {
    if (geo.status === 'on' && fix) { mapApi.current?.fly(fix, 16, padding()); return; }
    setCenterOnFix(true);
    setAskedLocation(true);
    geo.request();
  }, [geo, fix, padding]);
  const mapNote = geo.status === 'denied' ? 'Location is off. You can still search and preview routes.' : geo.status === 'insecure' ? 'Location needs HTTPS. Open the https:// address from npm run demo:student -- --lan.' : geo.status === 'unavailable' ? "Your location isn't available right now." : !online ? "You're offline. Parts of the map and routes may be missing." : null;
  // Only once the student has asked for location: a refusal they didn't just cause isn't news.
  const noteVisible = !!mapNote && mode === 'peek' && (askedLocation || !online);
  const endJourney = useCallback(() => { j.close(); setFollowing(true); setMode('peek'); setChosen(null); mapApi.current?.flat(); }, [j]);
  const inNav = j.journey.phase === 'navigating' || j.journey.phase === 'at-garage' || j.journey.phase === 'arrived';
  const showTrip = !!(trip && facility && entry) && mode !== 'route' && !inNav;

  const ctx: ParkingCtx = {
    facilities, facility, live, spaces, counts, prefs, now, destination, evidence, demo, openDisabled,
    entry, ranked, saved, site, destinationIsClass, destinationPlace,
    facilityOrder: facilityList.map((f) => f.facility_id),
    isPick: chosen === null,
    destinationIsDemo: fromSchedule,
    classLine: fromSchedule ? `${arrival.result.session.course} · ${arrival.result.session.startsAt}` : null,
    leaveBy,
  };

  // The tab pill arrives after the sheet has sprung up, never on top of it.
  const [settled, setSettled] = useState(revealed);
  useEffect(() => { if (!revealed) return; const t = setTimeout(() => setSettled(true), 420); return () => clearTimeout(t); }, [revealed]);
  // Explore keeps its tabs while the sheet is collapsed or half way; a full sheet has its own way back.
  const tabsOnExplore = !trip && !inNav && (mode === 'peek' || mode === 'half' || mode === 'place');
  const showTabs = settled && !trip && !inNav && (tab !== 'explore' || tabsOnExplore);
  const tabsH = tabsOnExplore ? TABS_H + safe.bottom : 0;

  return (
    <MotionConfig reducedMotion="user">
      <div ref={frame} className="app" data-testid="driver-app" data-theme={resolveTheme(prefs.mapTheme, systemDark)} data-tab={tab} data-mode={mode} data-live={live.trusted ? 'live' : live.connection}>
        {revealed && <MeridianMap
          key={mapKey} ref={mapApi} theme={resolveTheme(prefs.mapTheme, systemDark)} center={campus.center} zoom={campus.zoom}
          visible={tab === 'explore' || showTrip || inNav}
          dimmed={facility !== null && !live.trusted && live.connection !== 'connecting' && !inNav && j.journey.phase === 'idle'}
          pins={pins} routes={routeLines} footprints={footprints} user={fix} userHeading={j.nav?.heading ?? fix?.heading ?? null}
          onLoad={setMapLoad} onGesture={onMapGesture} onBearing={setBearing}
          onSelectRoute={(id) => { if (j.journey.phase === 'preview') j.select(j.journey.routes.findIndex((r) => r.id === id)); }}
        />}
        {inNav ? (
          <div className="screen nav-screen" data-testid="navigate" data-phase={j.journey.phase}>
            <Navigate
              j={j} fix={fix} geo={geo} now={now} provider={provider} following={following} onRecenter={() => { setOverview(false); setFollowing(true); }}
              overview={overview} onOverview={() => { if (overview) { setOverview(false); setFollowing(true); } else { setOverview(true); setFollowing(false); } }}
              pitched={pitched} onTogglePitch={() => { setPitched((v) => !v); setOverview(false); setFollowing(true); }} onInsets={setNavInsets}
              parkingLine={parkingLine} parkingSource={parkingSource} online={online} onEnd={endJourney} />
          </div>
        ) : (
        <AnimatePresence mode="popLayout" initial={false}>
          {showTrip ? (
            <motion.div key="trip" className="screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.28 }}>
              <Trip
                facility={facility} entry={entry} destination={destination} destinationPlace={destinationPlace} spaceId={trip} live={live} spaces={spaces} prefs={prefs} now={now}
                onEnd={() => { setTrip(null); setSelected(null); setMode('peek'); setChosen(null); }}
                onChooseAnother={() => { setTrip(null); setSelected(null); setMode('space'); }}
                onSwitch={(id) => void go(id)}
                onRoute={() => openRoute(targetFor(entry), 'drive')}
              />
            </motion.div>
          ) : (
            <motion.div key={tab} className="screen" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
              {tab === 'explore' && (
                <Explore
                  ctx={ctx} viewport={viewport} safe={safe} revealed={revealed} mode={mode} setMode={setMode} sheetY={sheetY}
                  selected={selected} setSelected={setSelected} suggested={suggested} advice={advice} checking={checking}
                  watching={watching} onWatch={() => setWatching(true)} onGo={(id) => void go(id)}
                  onSearch={() => setModal('search')} onClearDestination={() => { setDest(null); setChosen(null); }} onOpenGarage={openGarage} onToggleFavorite={toggleFavorite} onDestination={pickDestination} onClearRecents={clearRecents} onCloseGarage={closeGarage} onAbout={() => setModal('about')}
                  onRouteToGarage={() => openRoute(targetFor(entry), 'drive')} onDestinationRoute={onDestinationRoute}
                  routePanel={<RoutePanel j={j} geo={geo} provider={provider} now={now} parkingLine={parkingLine} parkingSource={parkingSource} onClose={closeRoute} />}
                  routeFooter={<RouteStartBar j={j} geo={geo} gate={gate} />}
                  place={place} estimate={estimate} onToggleSavePlace={() => destination && togglePlace(destination)} onSharePlace={() => void sharePlace()}
                  mapLoad={mapLoad} onMapRetry={retryMap} tabsH={tabsH} onSheetHeight={setSheetH} bearing={bearing} geoActive={geo.status === 'on'} locating={geo.status === 'requesting'} onLocate={locate} onNorth={() => mapApi.current?.north()} onPitch={() => mapApi.current?.togglePitch()} mapNote={noteVisible ? mapNote : null}
                  onProfile={() => { setYouSection('top'); setTab('you'); }} onRetry={retryFacilities}
                />
              )}
              {tab === 'plan' && <Plan scenario={scenario} arrival={arrival} parking={parking} onFind={(d) => pickDestination(d)} />}
              {tab === 'you' && <You focusSection={youSection} prefs={prefs} update={updatePrefs} health={health} demoSchedule={!!scenario} saved={saved} entries={entries} onOpenGarage={openGarage} onToggleFavorite={toggleFavorite} onClearRecents={clearRecents} onAbout={() => setModal('about')} onReplayIntro={() => { flags.set('introSeen', false); setSplash('full'); }} />}
            </motion.div>
          )}
        </AnimatePresence>
        )}

        {showTabs && (tab !== 'explore' || mode === 'half' || mode === 'place') && <div className="tabfade" aria-hidden />}
        <AnimatePresence>
          {showTabs && (
            <FloatingTabs
              key="tabs"
              active={modal === 'search' ? 'search' : tab === 'you' && youSection === 'alerts' ? 'alerts' : tab}
              onSelect={(action: FloatingAction) => {
                if (action === 'search') { haptic(8); setModal('search'); return; }
                if (action === 'alerts') { haptic(8); setYouSection('alerts'); setTab('you'); return; }
                if (action !== tab || (tab === 'you' && youSection === 'alerts')) haptic(8);
                setYouSection('top');
                setTab(action);
                if (action === 'explore' && tab === 'explore') { setMode('peek'); setChosen(null); }
              }}
            />
          )}
        </AnimatePresence>

        <AboutData open={modal === 'about'} onClose={closeModal} facility={facility} spaces={spaces} health={health} demo={!!scenario} info={demo ? { ...demo, site } : null} openDisabled={openDisabled} now={now} />
        <SearchSheet open={modal === 'search'} onClose={closeModal} destinations={destinations} ranked={ranked} saved={saved} onPickDestination={pickDestination} onPickGarage={openGarage} />

        <AnimatePresence>
          {toast && (
            <motion.div key={toast.id} className={`toast ${toast.tone}`} role="status" aria-live="assertive" data-testid="toast" initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }} transition={{ type: 'spring', visualDuration: 0.35, bounce: 0.15 }} onClick={() => setToast(null)}>
              {toast.text}
            </motion.div>
          )}
        </AnimatePresence>

        {splash && (
          <Splash
            key={splash}
            variant={splash}
            onReveal={() => setRevealed(true)}
            onDone={() => { flags.set('introSeen'); flags.setSession('splashShown'); setSplash(null); setRevealed(true); }}
          />
        )}
      </div>
    </MotionConfig>
  );
}
