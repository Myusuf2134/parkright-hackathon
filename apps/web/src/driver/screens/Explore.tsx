import type { Facility, ParkingSpace } from '@parkright/contracts';
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type MotionValue } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AdviceState, DemoInfo, Load } from '../net/api.ts';
import type { LiveView } from '../net/live.ts';
import { spaceLabel, type Evidence } from '../lib/evidence.ts';
import { siteHeadline } from '../lib/names.ts';
import { bayState, describeSpace, eligibility, layoutPlan, offerable, type Counts } from '../lib/parking.ts';
import type { Prefs } from '../lib/prefs.ts';
import { ago } from '../lib/time.ts';
import type { GarageEntry, Ranked } from '../lib/directory.ts';
import type { Saved } from '../lib/saved.ts';
import { DirectionsBlock, FavoriteButton, GarageList, GarageSource } from './Garages.tsx';
import { DemoMark, ObservationBar, Provenance } from '../ui/bits.tsx';
import { Arrow, Back, Close, Info, Locate, Person, Star } from '../ui/icons.tsx';
import { attributionText } from '../maps/mapStyle.ts';
import type { MapLoad } from '../maps/MeridianMap.tsx';
import { haptic } from '../ui/layout.ts';
import { Sheet, type Detent } from '../ui/Sheet.tsx';

export type Mode = 'peek' | 'list' | 'garage' | 'space' | 'route';

export interface ParkingCtx {
  facilities: Load<Facility[]>;
  facility: Facility | null;
  live: LiveView;
  spaces: ParkingSpace[];
  counts: Counts;
  prefs: Prefs;
  now: number;
  destination: string | null;
  destinationIsDemo: boolean;
  classLine: string | null;
  /** Recommended departure from Plan (demo estimate), shown beside the class line. */
  leaveBy: string | null;
  /** Age of the evidence on screen, per space (lib/evidence.ts). */
  evidence: Evidence;
  /** Demo status: site description and the detector's allow_open. null outside demo mode. */
  demo: DemoInfo | null | undefined;
  /** The detector can't report OPEN and nothing is open: show "can't confirm empty spaces", never "full". */
  openDisabled: boolean;
  /** The garage on screen; its facility is null for a demo-feed garage, which has no spaces. */
  entry: GarageEntry | null;
  ranked: Ranked[];
  saved: Saved;
  /** The site description, only when it describes this garage. */
  site: { title: string; tag: string; disclaimer: string } | null;
  destinationIsClass: boolean;
  destinationPlace: string | null;
  /** Monitored garage ids in the server's order; gives map pins fixed positions. */
  facilityOrder: string[];
  /** Whether the garage on screen is the app's pick rather than one the driver opened. */
  isPick: boolean;
}

const order = (ctx: ParkingCtx, r: Ranked) => ctx.ranked.length && r.entry.facility ? ctx.facilityOrder.indexOf(r.entry.id) : 1000 + r.entry.name.charCodeAt(0);
const facilityHasSpaces = (ctx: ParkingCtx) => !!ctx.facility && ctx.entry?.source !== 'unavailable' && ctx.entry?.source !== 'demo';

export function Explore(props: {
  ctx: ParkingCtx;
  viewport: number;
  safe: { top: number; bottom: number };
  revealed: boolean;
  mode: Mode;
  setMode: (m: Mode) => void;
  sheetY: MotionValue<number>;
  selected: string | null;
  setSelected: (id: string | null) => void;
  suggested: ParkingSpace | null;
  advice: AdviceState;
  checking: string | null;
  watching: boolean;
  onWatch: () => void;
  onGo: (spaceId: string) => void;
  onSearch: () => void;
  onClearDestination: () => void;
  onAbout: () => void;
  onProfile: () => void;
  onRetry: () => void;
  onOpenGarage: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onDestination: (d: string) => void;
  onClearRecents: () => void;
  onCloseGarage: () => void;
  /** Route to the garage on screen, then on foot to the destination. */
  onRouteToGarage: () => void;
  /** Routes for the destination on its own (best garage if driving). */
  onDestinationRoute: (() => void) | null;
  routePanel: ReactNode;
  routeFooter: ReactNode;
  mapLoad: MapLoad;
  bearing: number;
  geoActive: boolean;
  locating: boolean;
  onLocate: () => void;
  onNorth: () => void;
  onPitch: () => void;
  mapNote: string | null;
}) {
  const { ctx, viewport, safe, revealed, mode, setMode, sheetY } = props;
  const { live } = ctx;
  const [routeDetent, setRouteDetent] = useState<'route' | 'route-full'>('route');
  useEffect(() => { if (mode !== 'route') setRouteDetent('route'); }, [mode]);
  const [peekH, setPeekH] = useState(286);
  const full = viewport - safe.top - 10;
  const peek = { id: 'peek', height: Math.min(full, peekH + 21 + 84 + safe.bottom) };
  const tall = Math.min(full, Math.round(viewport * 0.74));
  const detents: Detent[] = mode === 'route' ? [{ id: 'route', height: Math.min(full, Math.round(viewport * 0.52)) }, { id: 'route-full', height: full }]
    : mode === 'list' || (mode === 'peek' && ctx.entry?.source !== 'simulated' && ctx.entry?.source !== 'live')
    ? [peek, { id: 'list', height: full }]
    : mode === 'garage' && !facilityHasSpaces(ctx) ? [peek, { id: 'garage', height: tall }]
    : [peek, { id: 'garage', height: tall }, { id: 'space', height: full }];

  // Controls ride above the sheet and fade once it covers most of the map.
  const ctlBottom = useTransform(sheetY, (v) => viewport - v + 14);
  const ctlOpacity = useTransform(sheetY, (v) => (viewport - v > viewport * 0.72 ? 0 : 1));

  return (
    <div className="screen map-screen" data-testid="explore">
      <motion.div className="top" animate={{ opacity: mode === 'peek' ? 1 : 0, y: mode === 'peek' ? 0 : -12 }} transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }} style={{ pointerEvents: mode === 'peek' ? 'auto' : 'none' }} aria-hidden={mode !== 'peek'}>
        <div className="toprow">
        <div className="search" data-testid="search">
            <button type="button" className="main" onClick={props.onSearch} aria-label={ctx.destination ? `Destination: ${ctx.destination}. Change` : 'Search for a destination'}>
              <span className="sq" />
              <span className="t">
                {ctx.destination ? <b>{ctx.destination}</b> : <b className="ph" data-testid="where-to">Where to?</b>}
                {ctx.destination && ctx.classLine && <small>{ctx.leaveBy ? `${ctx.classLine.split(' · ')[0]} · Leave ${ctx.leaveBy}` : ctx.classLine}{ctx.destinationIsDemo && <> · <DemoMark /></>}</small>}
                {!ctx.destination && <small>Parking near where you're going</small>}
              </span>
            </button>
            {props.onDestinationRoute && <button type="button" className="circ ink press" aria-label={`Routes to ${ctx.destination}`} onClick={props.onDestinationRoute} data-testid="destination-route"><Arrow /></button>}
            {ctx.destination && <button type="button" className="circ flat press" aria-label="Clear destination" onClick={props.onClearDestination}><Close /></button>}
        </div>
        <button type="button" className="circ avatar press" aria-label="You and settings" onClick={props.onProfile}><Person /></button>
        </div>
        {(live.connection === 'reconnecting' || live.silent) && (
          <div className="banner" role="status" data-testid="reconnecting">{live.silent ? 'No recent update' : 'Reconnecting'} · nothing shown as available</div>
        )}
      </motion.div>

      <motion.div className="mapctls" style={{ bottom: ctlBottom, opacity: ctlOpacity }}>
        {props.bearing !== 0 && <button type="button" className="circ press" aria-label="Reset map to north" onClick={props.onNorth} data-testid="map-north"><svg viewBox="0 0 24 24" width={22} height={22} aria-hidden style={{ rotate: `${-props.bearing}deg` }}><path d="M12 3l4 9h-8z" fill="#d63a3a" /><path d="M12 21l-4-9h8z" fill="#9aa0a6" /></svg></button>}
        <button type="button" className="circ press mapctl-3d" aria-label="Tilt map" onClick={props.onPitch} data-testid="map-pitch">3D</button>
        <button type="button" className={`circ press${props.geoActive ? ' located' : ''}`} aria-label={props.geoActive ? 'Center on my location' : 'Show my location'} onClick={props.onLocate} data-testid="locate" disabled={props.locating}><Locate /></button>
      </motion.div>
      <motion.div className="mapattr" style={{ bottom: ctlBottom, opacity: ctlOpacity }} data-testid="map-attribution">{attributionText}</motion.div>
      {props.mapLoad === 'failed' && <div className="mapfail" role="status" data-testid="map-failed"><b>The map couldn't load.</b><span>Search, garages and directions still work.</span></div>}
      {mode !== 'route' && props.mapNote && <div className="banner mapnote" role="status" data-testid="map-note">{props.mapNote}</div>}

      <Sheet
        y={sheetY}
        viewport={viewport}
        detents={detents}
        active={mode === 'route' ? routeDetent : mode}
        hidden={!revealed}
        onChange={(id) => { if (mode === 'route') setRouteDetent(id as 'route' | 'route-full'); else setMode(id as Mode); }}
        scroll={mode !== 'peek'}
        label={mode === 'peek' ? 'Best parking' : mode === 'list' ? 'All garages' : mode === 'garage' ? 'Garage details' : mode === 'route' ? 'Routes' : 'Choose a space'}
      >
        {mode === 'peek' && <PeekPanel {...props} onMeasure={setPeekH} />}
        {mode === 'list' && (
          <GarageList
            ranked={ctx.ranked} saved={ctx.saved} loading={ctx.facilities.state === 'loading'} failed={ctx.facilities.state === 'error'}
            destination={ctx.destination} destinationIsClass={ctx.destinationIsClass}
            onOpen={props.onOpenGarage} onToggle={props.onToggleFavorite} onRetry={props.onRetry} onClose={() => setMode('peek')}
            onDestination={props.onDestination} onClearRecents={props.onClearRecents}
          />
        )}
        {mode === 'garage' && <GaragePanel {...props} />}
        {mode === 'space' && <SpacePanel {...props} />}
        {mode === 'route' && props.routePanel}
      </Sheet>
      {mode === 'route' && props.routeFooter}
    </div>
  );
}

// ---------------------------------------------------------------- peek

function PeekPanel(p: Parameters<typeof Explore>[0] & { onMeasure: (h: number) => void }) {
  const { ctx, setMode } = p;
  const { live, counts, facility, spaces } = ctx;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => p.onMeasure(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [p.onMeasure]);

  const recommendable = ctx.ranked.find((r) => r.entry.id === ctx.entry?.id)?.tier === 0;
  const eyebrow = !ctx.isPick ? 'Selected garage' : !ctx.destination || !recommendable ? 'Monitored garage' : ctx.destinationIsClass ? `Best parking near ${ctx.destination}` : `Parking for ${ctx.destination}`;
  const name = facility ? siteHeadline(ctx.site?.title, facility.name, facility.is_simulated).title : '';
  const openEnabled = ctx.demo?.allowOpen !== false;
  const forYouLine = counts.forYou === counts.open ? undefined : `${counts.forYou} usable by you`;
  let body;
  if (ctx.entry?.source === 'demo') {
    const c = ctx.entry.candidate!;
    body = (
      <>
        <div className="big" data-testid="demo-peek"><span className="num zero">{c.demo_available_spaces}</span><span className="lbl"><b>spaces in the demo feed</b><span className="fac">{ctx.entry.name}</span></span></div>
        <div className="prov"><span className="dm">Example data · not live</span><span aria-hidden>·</span><span>No space map</span></div>
        <div className="acts"><button type="button" className="btn ink press" onClick={() => setMode('garage')} data-testid="view-garage">View garage</button></div>
      </>
    );
  } else if (ctx.entry?.source === 'unavailable') {
    body = (
      <>
        <div className="big" data-testid="unavailable-peek"><span className="num off">—</span><span className="lbl"><b>Availability not available</b><span>{ctx.entry.name}</span></span></div>
        <div className="prov"><span>No validated occupancy for this garage yet</span></div>
        <div className="acts"><button type="button" className="btn press" onClick={() => setMode('garage')} data-testid="view-garage">View garage</button></div>
      </>
    );
  } else if (ctx.facilities.state === 'error' && !facility) {
    body = (
      <>
        <div className="big"><span className="num off">—</span><span className="lbl"><b>Can't reach Meridian</b><span>No spaces are shown as available.</span></span></div>
        <div className="acts"><button type="button" className="btn ink press" onClick={p.onRetry}>Try again</button></div>
      </>
    );
  } else if (!facility || (live.connection === 'connecting' && !live.everLive)) {
    body = (
      <>
        <div className="skel" style={{ height: 64, width: '62%' }} aria-hidden />
        <ObservationBar counts={counts} openEnabled={openEnabled} legend={false} note={false} />
        <div className="prov" role="status">Waiting for the first live snapshot…</div>
        <div className="acts"><button type="button" className="btn" disabled>View spaces</button><button type="button" className="circ lg" disabled aria-label="Go"><Arrow /></button></div>
      </>
    );
  } else if (!live.trusted) {
    body = (
      <>
        <div className="big"><span className="num off" data-testid="open-count">—</span><span className="lbl"><b>Live data paused</b><span>{name}</span></span></div>
        <ObservationBar counts={counts} openEnabled={openEnabled} note={false} />
        <Provenance live={live} evidence={ctx.evidence} simulated={facility.is_simulated} />
        <div className="acts"><button type="button" className="btn press" onClick={() => setMode('garage')}>View garage</button><button type="button" className="circ lg" disabled aria-label="Go (unavailable)"><Arrow /></button></div>
      </>
    );
  } else if (ctx.openDisabled && ctx.evidence.fresh === 0) {
    // Occupied-only detection with no current view at all: say the views are old, not "0 occupied".
    body = (
      <>
        <div className="big" data-testid="stale-state"><span className="num off">—</span><span className="lbl"><b>No recent camera view</b><span>Spaces can’t be confirmed until the cameras report again</span></span></div>
        <ObservationBar counts={counts} openEnabled={openEnabled} note={false} />
        <Provenance live={live} evidence={ctx.evidence} simulated={facility.is_simulated} />
        <div className="acts"><button type="button" className="btn press" onClick={() => setMode('garage')}>View garage</button></div>
      </>
    );
  } else if (ctx.openDisabled) {
    // Occupied-only detection: what the cameras can say, and plainly what they can't yet.
    body = (
      <>
        <div className="big" data-testid="open-disabled">
          <span className="num zero" data-testid="occupied-count">{counts.occupied}</span>
          <span className="lbl"><b>{counts.occupied === 1 ? 'space seen occupied' : 'spaces seen occupied'}</b><span>Empty spaces can’t be confirmed yet</span></span>
        </div>
        <ObservationBar counts={counts} openEnabled={false} />
        <Provenance live={live} evidence={ctx.evidence} simulated={facility.is_simulated} />
        <div className="acts"><button type="button" className="btn ink press" onClick={() => setMode('garage')} data-testid="view-garage">View garage</button></div>
      </>
    );
  } else if (counts.forYou === 0) {
    body = (
      <>
        <div className="big"><span className="num zero" data-testid="open-count">{counts.open}</span><span className="lbl"><b>{counts.open === 0 ? 'spaces confirmed open' : 'open spaces you can use: 0'}</b><span>{counts.uncertain ? `${counts.uncertain} can't be confirmed right now` : `of ${counts.total} · ${name}`}</span></span></div>
        <ObservationBar counts={counts} openEnabled={openEnabled} />
        <Provenance live={live} evidence={ctx.evidence} simulated={facility.is_simulated} />
        <div className="acts">
          <button type="button" className="btn ink press" onClick={p.onWatch} disabled={p.watching} data-testid="watch">{p.watching ? 'Watching while the app is open…' : 'Tell me when one opens'}</button>
        </div>
      </>
    );
  } else {
    const s = p.suggested;
    body = (
      <>
        <div className="big">
          <Count value={counts.open} />
          <span className="lbl"><b>{counts.open === 1 ? 'space confirmed open' : 'spaces confirmed open'}</b><span className="fac">{name}</span></span>
        </div>
        <ObservationBar counts={counts} openEnabled={openEnabled} />
        <Provenance live={live} evidence={ctx.evidence} simulated={facility.is_simulated} extra={forYouLine} />
        <div className="acts">
          <button type="button" className="btn press" onClick={() => setMode('garage')} data-testid="view-spaces">View spaces</button>
          <button type="button" className="circ ink lg press" aria-label={s ? `Go to space ${s.space_id}` : 'Go'} disabled={!s || p.checking !== null} onClick={() => s && p.onGo(s.space_id)} data-testid="go">
            <Arrow />
          </button>
        </div>
      </>
    );
  }
  return (
    <div ref={ref} className="panel" style={{ paddingBottom: 4 }}>
      <div className="row peek-head">
        <div className="ey">{eyebrow}</div>
        {ctx.ranked.length > 1 && <button type="button" className="alllink press" onClick={() => setMode('list')} data-testid="all-garages">All {ctx.ranked.length}</button>}
      </div>
      {body}
      <SavedStrip {...p} />
    </div>
  );
}

/** Saved garages one tap away. */
function SavedStrip(p: Parameters<typeof Explore>[0]) {
  const { ctx } = p;
  const favs = ctx.saved.favorites.map((id) => ctx.ranked.find((r) => r.entry.id === id)).filter((r): r is Ranked => !!r && r.entry.id !== ctx.entry?.id);
  if (!favs.length) return null;
  return (
    <div className="sstrip" data-testid="saved-strip">
      {favs.map((r) => <button key={r.entry.id} type="button" className="rchip press" onClick={() => p.onOpenGarage(r.entry.id)} data-testid="saved-chip"><Star width={13} height={13} fill="currentColor" />{r.entry.name}</button>)}
    </div>
  );
}

// ---------------------------------------------------------------- garage

/** Header shared by every garage: name, favorite, about, close, and what kind of data this is. */
function GarageHead({ p, eyebrow, title }: { p: Parameters<typeof Explore>[0]; eyebrow: string; title: string }) {
  const { ctx } = p;
  const e = ctx.entry!;
  return (
    <>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
          <div className="ey">{eyebrow}</div>
          <h2 className={`title${title.length > 22 ? ' long' : ''}`} data-testid="garage-title">{title}</h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <FavoriteButton id={e.id} name={e.name} on={ctx.saved.favorites.includes(e.id)} onToggle={p.onToggleFavorite} />
          <button type="button" className="circ flat press" aria-label="About this data" onClick={p.onAbout}><Info /></button>
          <button type="button" className="circ flat press" aria-label="Close garage details" onClick={p.onCloseGarage}><Close /></button>
        </div>
      </div>
      <div className="locline" data-testid="location">
        <GarageSource source={e.source} />
        <span data-testid="loc-text">{e.geo ? [e.standsInFor ? `Simulated stand-in for ${e.geo.name}` : null, e.geo.address, e.geo.capacity ? `${e.geo.capacity} spaces` : null].filter(Boolean).join(' · ') || 'Location from OpenStreetMap' : e.facility?.address ?? (e.standsInFor ? `Simulated stand-in for ${e.standsInFor}` : e.source === 'demo' ? 'Named in the demo fixture' : 'No real location')}</span>
      </div>
    </>
  );
}

const walkLine = (ctx: ParkingCtx) => {
  const r = ctx.ranked.find((x) => x.entry.id === ctx.entry?.id);
  const walk = r?.walkMinutes ?? null;
  if (!ctx.destination) return null;
  return walk !== null ? `${walk} min walk to ${ctx.destination}${r?.walkSource === 'routed' ? '' : ' · demo estimate'}` : `Walking time to ${ctx.destination} isn't available`;
};

function DemoGaragePanel(p: Parameters<typeof Explore>[0]) {
  const { ctx } = p;
  const c = ctx.entry!.candidate!;
  const walk = walkLine(ctx);
  return (
    <div className="panel" style={{ gap: 18, paddingBottom: p.safe.bottom + 24 }} data-testid="garage-panel">
      <GarageHead p={p} eyebrow={`Capacity ${c.total_spaces} · demo fixture`} title={ctx.entry!.name} />
      <div className="stats" data-testid="garage-stats" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="stat"><b data-testid="demo-count">{c.demo_available_spaces}</b><span>In the demo feed</span></div>
        <div className="stat"><b>{c.total_spaces}</b><span>Capacity (demo)</span></div>
      </div>
      <div className="card occ-only" data-testid="no-space-map">
        <span className="ey">Example data</span>
        <b>This garage has no cameras connected, so there's no space map and no live count.</b>
        <span>The number above is a fixed example. It never changes and isn't current information.</span>
      </div>
      {walk && <p className="body" style={{ fontSize: 14 }} data-testid="walk-line">{walk}</p>}
      <DirectionsBlock entry={ctx.entry!} destination={ctx.destination} destinationPlace={ctx.destinationPlace} app={ctx.prefs.mapsApp} onRoute={p.onRouteToGarage} />
    </div>
  );
}

function UnavailablePanel(p: Parameters<typeof Explore>[0]) {
  const { ctx } = p;
  return (
    <div className="panel" style={{ gap: 18, paddingBottom: p.safe.bottom + 24 }} data-testid="garage-panel">
      <GarageHead p={p} eyebrow="Availability not available" title={ctx.entry!.name} />
      <div className="card occ-only" data-testid="unavailable-card">
        <span className="ey">Not validated</span>
        <b>Meridian can't report availability for this garage yet.</b>
        <span>{ctx.entry!.facility ? "Its occupancy hasn't been calibrated and validated, so no space is shown as open." : "Meridian has no cameras here, so it knows where this garage is but not how full it is."}</span>
      </div>
      <DirectionsBlock entry={ctx.entry!} destination={ctx.destination} destinationPlace={ctx.destinationPlace} app={ctx.prefs.mapsApp} onRoute={p.onRouteToGarage} />
    </div>
  );
}

function GaragePanel(p: Parameters<typeof Explore>[0]) {
  const { ctx, setMode } = p;
  const { live, counts, facility, spaces } = ctx;
  if (ctx.entry?.source === 'demo') return <DemoGaragePanel {...p} />;
  if (ctx.entry?.source === 'unavailable') return <UnavailablePanel {...p} />;
  if (!facility) return <div className="panel"><div className="skel" style={{ height: 200 }} /></div>;
  const level = facility.levels.length === 1 ? facility.levels[0].name : `${facility.levels.length} levels`;
  const camera = facility.cameras.length === 1 ? facility.cameras[0].camera_id : `${facility.cameras.length} cameras`;
  // The site's own title leads; the size is secondary metadata above it ("Simulated garage" sits below).
  const head = siteHeadline(ctx.site?.title, facility.name, facility.is_simulated);
  const walk = walkLine(ctx);
  return (
    <div className="panel" style={{ gap: 18, paddingBottom: p.safe.bottom + 24 }} data-testid="garage-panel">
      <GarageHead p={p} eyebrow={`${level} · ${counts.total} spaces`} title={head.title} />
      {ctx.site && (
        <p className="site-note" data-testid="site-disclaimer"><b>{ctx.site.tag}</b> {ctx.site.disclaimer}</p>
      )}
      <div className="stats" data-testid="garage-stats">
        <div className={`stat open${ctx.openDisabled ? ' off' : ''}`}><b>{live.trusted && !ctx.openDisabled ? counts.open : '—'}</b><span>Open</span></div>
        <div className="stat occ"><b>{live.trusted ? counts.occupied : '—'}</b><span>Occupied</span></div>
        <div className="stat unc"><b>{counts.uncertain}</b><span>Can't confirm</span></div>
      </div>
      <ObservationBar counts={counts} openEnabled={ctx.demo?.allowOpen !== false} title legend={false} note={false} />
      <Provenance live={live} evidence={ctx.evidence} simulated={facility.is_simulated} extra={camera} />
      <p className="updated" data-testid="last-updated">{live.lastMessageAt ? (live.trusted ? `Last update ${ago(ctx.now - live.lastMessageAt)} ago` : `Last update ${ago(ctx.now - live.lastMessageAt)} ago · no longer current`) : 'No update received yet'}</p>
      {walk && <p className="body" style={{ fontSize: 14, marginTop: -8 }} data-testid="walk-line">{walk}</p>}
      {ctx.openDisabled && live.trusted && (
        <div className="card occ-only" data-testid="open-disabled-card">
          <span className="ey">Occupied-only detection</span>
          <b>We can detect occupied spaces, but can’t yet confirm empty ones.</b>
          <span>Open-space confirmation isn’t enabled in this demo yet, so no space is offered and there’s no parking advice.</span>
        </div>
      )}
      <SpaceTypes spaces={spaces} prefs={ctx.prefs} />
      {!(ctx.openDisabled && live.trusted) && <AdviceCard advice={p.advice} trusted={live.trusted} open={counts.open} />}
      <div className="acts">
        <button type="button" className="btn ink press" onClick={() => setMode('space')} data-testid="choose-space">Choose a space</button>
        <button type="button" className="circ green lg press" aria-label={p.suggested ? `Go to space ${p.suggested.space_id}` : 'Go'} disabled={!p.suggested || !live.trusted || p.checking !== null} onClick={() => p.suggested && p.onGo(p.suggested.space_id)}><Arrow /></button>
      </div>
      <DirectionsBlock entry={ctx.entry!} destination={ctx.destination} destinationPlace={ctx.destinationPlace} app={ctx.prefs.mapsApp} onRoute={p.onRouteToGarage} />
      <p className="notice-line">Meridian shows what its cameras see. Spaces aren't reserved or held for you.</p>
    </div>
  );
}

function AdviceCard({ advice, trusted, open }: { advice: AdviceState; trusted: boolean; open: number }) {
  let text, foot;
  if (!trusted) { text = 'Advice pauses while live data is unavailable.'; foot = null; }
  else if (open === 0) { text = 'No space is confirmed open, so there\'s nothing to recommend yet.'; foot = null; }
  else if (advice.state === 'loading' || advice.state === 'idle') { text = null; foot = null; }
  else if (advice.state === 'unavailable') { text = advice.reason; foot = null; }
  else {
    text = advice.advice.text;
    foot = advice.advice.source === 'nemotron'
      ? 'Advice only, not a reservation · grounded in the live counts above'
      : `Local fallback, not Nemotron${advice.advice.fallbackReason ? ` · ${advice.advice.fallbackReason}` : ''}`;
  }
  const src = advice.state === 'ok' ? (advice.advice.source === 'nemotron' ? 'NVIDIA Nemotron' : 'Local fallback') : 'Nemotron';
  return (
    <div className="card advice" aria-live="polite" data-testid="advice">
      <div className="row"><span className="ey">Parking advice</span><span style={{ font: '600 11.5px/1 var(--mono)', color: 'var(--ink-2)' }}>{src}</span></div>
      {text ? <div style={{ font: '600 17px/1.35 var(--ui)', letterSpacing: '-.01em' }}>{text}</div> : (
        <div style={{ display: 'grid', gap: 8 }} aria-label="Loading advice"><div className="skel" style={{ height: 16, borderRadius: 8 }} /><div className="skel" style={{ height: 16, width: '70%', borderRadius: 8 }} /></div>
      )}
      {foot && <div style={{ font: '500 12.5px/1.3 var(--ui)', color: 'var(--ink-2)' }}>{foot}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- choose a space

function SpacePanel(p: Parameters<typeof Explore>[0]) {
  const { ctx, setMode, selected, setSelected } = p;
  const { facility, live, prefs } = ctx;
  const levels = facility?.levels ?? [];
  const [levelId, setLevelId] = useState<string | null>(null);
  const chosen = ctx.spaces.find((s) => s.space_id === selected) ?? null;
  const activeLevel = levelId ?? chosen?.level_id ?? p.suggested?.level_id ?? levels[0]?.level_id ?? null;
  const levelSpaces = useMemo(() => ctx.spaces.filter((s) => s.level_id === activeLevel), [ctx.spaces, activeLevel]);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(346);
  const [note, setNote] = useState<string | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - 44));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const plan = useMemo(() => layoutPlan(levelSpaces, width), [levelSpaces, width]);
  const changed = useChangedBays(ctx.spaces);
  const small = plan.bays.length > 0 && Math.min(...plan.bays.map((b) => b.w)) < 50;

  // Keep the chosen bay in view on big garages.
  useEffect(() => {
    const b = plan.bays.find((x) => x.space.space_id === selected);
    if (b && wrap.current) wrap.current.scrollTo({ left: Math.max(0, b.x - width / 2), behavior: 'smooth' });
  }, [selected, plan, width]);

  if (!facility) return <div className="panel"><div className="skel" style={{ height: 300 }} /></div>;

  const press = (s: ParkingSpace) => {
    if (offerable(s, prefs) && live.trusted) { setSelected(s.space_id); setNote(null); haptic(); return; }
    const st = bayState(s);
    const elig = eligibility(s.designation, prefs);
    const age = spaceLabel(s, ctx.now, live.clockOffsetMs).text.toLowerCase();
    setNote(
      !live.trusted ? `${s.space_id}: live data is paused, so nothing can be chosen.`
        : st === 'occupied' ? `${s.space_id} is occupied · ${age}.`
        : st === 'uncertain' ? (s.stale || !s.last_observed_at ? `${s.space_id} can't be confirmed right now · ${age}.`
          : ctx.openDisabled ? `${s.space_id} isn't seen occupied, but empty spaces can't be confirmed in this demo yet · ${age}.`
          : `${s.space_id} can't be confirmed right now · ${age}.`)
        : `${s.space_id} is open, but: ${elig.reason}`,
    );
  };

  const levelName = levels.find((l) => l.level_id === activeLevel)?.name ?? '';
  return (
    <div className="panel" style={{ gap: 20, paddingBottom: p.safe.bottom + 24 }} data-testid="space-panel">
      <div className="row">
        <button type="button" className="circ flat press" aria-label="Back to garage details" onClick={() => setMode('garage')}><Back /></button>
        <Provenance live={live} evidence={ctx.evidence} simulated={false} />
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <div className="ey">{ctx.entry?.name ?? facility.name} · {levelName}</div>
        <h2 className="hl" style={{ fontSize: 36 }}>Choose a space</h2>
      </div>
      {levels.length > 1 && (
        <div className="seg" role="group" aria-label="Level">
          {[...levels].sort((a, b) => a.ordinal - b.ordinal).map((l) => (
            <button key={l.level_id} type="button" aria-pressed={l.level_id === activeLevel} onClick={() => setLevelId(l.level_id)} data-testid={`level-${l.level_id}`}>{l.name}<small>{live.trusted && !ctx.openDisabled ? `${ctx.spaces.filter((s) => s.level_id === l.level_id && offerable(s, prefs)).length} open` : '—'}</small></button>
          ))}
        </div>
      )}
      <div className={`planwrap${plan.width <= width + 1 ? ' fits' : ''}`} ref={wrap}>
        <div className="plan" style={{ width: plan.width, height: plan.height }} data-testid="plan">
          {plan.aisles.map((a, i) => <div key={i} className="aisle" style={{ top: a.y, height: a.h, width: plan.width }}><span>DRIVE AISLE</span></div>)}
          {plan.bays.map(({ space: s, x, y, w, h }) => {
            const st = bayState(s);
            const can = offerable(s, prefs) && live.trusted;
            const isSel = s.space_id === selected && can;
            const cls = isSel ? 'se' : st === 'open' ? (can ? 'op' : 'op inel') : st === 'occupied' ? 'oc' : 'un';
            const desig = s.designation !== 'standard' ? s.designation : null;
            const isSuggested = s.space_id === p.suggested?.space_id && can;
            return (
              <button
                key={s.space_id}
                type="button"
                className={`bay ${cls}${small ? ' sm' : ''}${changed.has(s.space_id) ? ' chg' : ''}`}
                style={{ left: x + 3, top: y, width: w - 6, height: h }}
                data-bay={s.space_id}
                data-state={st}
                aria-pressed={isSel}
                aria-disabled={!can}
                aria-label={`${s.space_id}, ${st === 'open' ? (can ? 'open' : 'open but not for you') : st === 'occupied' ? 'occupied' : "can't be confirmed"}${desig ? `, ${desig} space` : ''}`}
                onClick={() => press(s)}
              >
                {isSel && <motion.span layoutId="sel-ring" className="sel-ring" transition={{ type: 'spring', visualDuration: 0.34, bounce: 0.18 }} aria-hidden />}
                <span className="bay-id">{s.space_id}</span>
                {isSuggested && !isSel && <span className="sugg" aria-hidden />}
                {desig && <span className={`des ${desig === 'accessible' ? 'acc' : desig === 'ev' ? 'ev' : 'res'}`} aria-hidden />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="legend" aria-hidden>
        <span><i style={{ background: 'var(--mint)', boxShadow: 'inset 0 0 0 2px var(--green)' }} />Open</span>
        <span><i style={{ background: 'var(--occ)' }} />Occupied</span>
        <span><i style={{ background: 'repeating-linear-gradient(135deg,#f2f2ef 0 3px,#dfe1e3 3px 6px)', boxShadow: 'inset 0 0 0 1.5px var(--unc)' }} />Can't confirm</span>
      </div>
      <p className="body" aria-live="polite" style={{ fontSize: 14, minHeight: note ? undefined : 0 }} data-testid="bay-note">{note}</p>
      <div style={{ height: 1, background: 'var(--line)' }} />
      {chosen && offerable(chosen, prefs) && live.trusted ? (
        <>
          <motion.div className="choice-sum" layout>
            <span data-testid="chosen" style={{ display: 'contents' }}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={chosen.space_id} className="plate" initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.85, opacity: 0 }} transition={{ type: 'spring', visualDuration: 0.3, bounce: 0.2 }}>{chosen.space_id}</motion.span>
            </AnimatePresence>
            </span>
            <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
              <b className="strong" style={{ fontSize: 18 }}>{chosen.space_id === p.suggested?.space_id ? 'Suggested space' : 'Your space'}</b>
              <span className="body" style={{ fontSize: 14.5 }}>{describeSpace(chosen, ctx.spaces)}</span>
              <span className="mini-tags"><ChosenAge space={chosen} now={ctx.now} offsetMs={live.clockOffsetMs} /><span>Not reserved</span><span>Rechecked when you go</span></span>
            </div>
          </motion.div>
          <QuickSwitch spaces={ctx.spaces} prefs={prefs} chosen={chosen.space_id} onPick={(id) => { setSelected(id); setNote(null); haptic(); }} />
          <div className="acts">
            <button type="button" className="btn green press" onClick={() => p.onGo(chosen.space_id)} disabled={p.checking !== null} data-testid="go-space">
              {p.checking ? `Checking ${p.checking}…` : `Go to ${chosen.space_id}`}
            </button>
          </div>
        </>
      ) : (
        <p className="body" data-testid="no-choice">{live.trusted ? (ctx.openDisabled ? 'Open-space confirmation isn’t enabled in this demo yet, so no space can be chosen.' : ctx.counts.forYou ? 'Tap a green space to choose it.' : 'No space you can use is confirmed open right now.') : 'Live data is paused. Spaces can be chosen again when it returns.'}</p>
      )}
    </div>
  );
}

/** Bays whose state just changed, so a live update is visible where it happened. */
function useChangedBays(spaces: ParkingSpace[]): Set<string> {
  const prev = useRef<Map<string, string> | null>(null);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  useEffect(() => {
    const next = new Map(spaces.map((s) => [s.space_id, bayState(s)]));
    const diff = prev.current ? [...next].filter(([id, st]) => prev.current!.has(id) && prev.current!.get(id) !== st).map(([id]) => id) : [];
    prev.current = next;
    if (!diff.length) return;
    setChanged(new Set(diff));
    const t = setTimeout(() => setChanged(new Set()), 1400);
    return () => clearTimeout(t);
  }, [spaces]);
  return changed;
}

/** "Open · seen 3 s ago" for the chosen space: its own evidence, amber once it's past 12 s. */
function ChosenAge({ space, now, offsetMs }: { space: ParkingSpace; now: number; offsetMs: number }) {
  const l = spaceLabel(space, now, offsetMs);
  return <span className={l.tone === 'live' ? 'live' : 'paused'} data-testid="chosen-age" data-tone={l.tone}>Open · {l.text.toLowerCase()}</span>;
}

/** The big number, rolling when the live count changes. */
function Count({ value }: { value: number }) {
  return (
    <span className="num rolling" data-testid="open-count" aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={value} initial={{ y: '45%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '-45%', opacity: 0 }} transition={{ type: 'spring', visualDuration: 0.38, bounce: 0.1 }}>{value}</motion.span>
      </AnimatePresence>
    </span>
  );
}

const TYPE_LABEL: Record<string, string> = { standard: 'Standard', accessible: 'Accessible', ev: 'EV charging', reserved: 'Reserved' };

/** Which kinds of spaces this garage has and whether this driver may use them. */
function SpaceTypes({ spaces, prefs }: { spaces: ParkingSpace[]; prefs: Prefs }) {
  const byType = new Map<string, number>();
  for (const s of spaces) byType.set(s.designation, (byType.get(s.designation) ?? 0) + 1);
  return (
    <div className="types" data-testid="space-types">
      <div className="ey">Space types</div>
      {[...byType].map(([t, n]) => {
        const e = eligibility(t as ParkingSpace['designation'], prefs);
        return (
          <div key={t} className="type-row">
            <span className={`tdot t-${t}`} />
            <b>{TYPE_LABEL[t] ?? t}</b>
            <span className="n">{n}</span>
            <span className={`elig${e.ok ? ' ok' : ''}`}>{e.ok ? 'For you' : t === 'reserved' ? 'Never offered' : t === 'accessible' ? 'Needs placard' : t === 'ev' ? 'EV only' : 'Not for you'}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Other confirmed-open spaces, one tap away. */
function QuickSwitch({ spaces, prefs, chosen, onPick }: { spaces: ParkingSpace[]; prefs: Prefs; chosen: string; onPick: (id: string) => void }) {
  const others = spaces.filter((s) => s.space_id !== chosen && offerable(s, prefs)).slice(0, 6);
  if (!others.length) return null;
  return (
    <div className="qswitch" role="group" aria-label="Other open spaces">
      <span className="ey">Also open</span>
      <div className="qchips">
        {others.map((s) => <button key={s.space_id} type="button" className="qchip press" onClick={() => onPick(s.space_id)}>{s.space_id}</button>)}
      </div>
    </div>
  );
}
