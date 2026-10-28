import type { Facility, ParkingSpace } from '@parkright/contracts';
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type MotionValue } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AdviceState, DemoInfo, Load } from '../net/api.ts';
import type { LiveView } from '../net/live.ts';
import { spaceLabel, type Evidence } from '../lib/evidence.ts';
import { bayState, describeSpace, eligibility, layoutPlan, offerable, type Counts } from '../lib/parking.ts';
import type { Prefs } from '../lib/prefs.ts';
import { greeting } from '../lib/time.ts';
import { CampusStreets, DestinationPin, GaragePin, MAP_H, MAP_W, WalkLink } from '../ui/CampusMap.tsx';
import { DemoMark, Provenance, TickStrip } from '../ui/bits.tsx';
import { Arrow, Back, Close, Info, Locate, Person } from '../ui/icons.tsx';
import { haptic } from '../ui/layout.ts';
import { Sheet, type Detent } from '../ui/Sheet.tsx';

export type Mode = 'peek' | 'garage' | 'space';

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
}

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
}) {
  const { ctx, viewport, safe, revealed, mode, setMode, sheetY } = props;
  const { live, counts, facility } = ctx;
  const [peekH, setPeekH] = useState(286);
  const full = viewport - safe.top - 10;
  const detents: Detent[] = [
    { id: 'peek', height: Math.min(full, peekH + 21 + 84 + safe.bottom) },
    { id: 'garage', height: Math.min(full, Math.round(viewport * 0.74)) },
    { id: 'space', height: full },
  ];

  // Map: slight pan, a reveal settle, and controls that ride above the sheet.
  const mapX = useMotionValue(0), mapY = useMotionValue(0), mapScale = useMotionValue(1.06);
  useEffect(() => { if (revealed) animate(mapScale, 1, { duration: 0.6, ease: [0.22, 1, 0.36, 1] }); }, [revealed, mapScale]);
  const ctlBottom = useTransform(sheetY, (v) => viewport - v + 14);
  const lblBottom = useTransform(sheetY, (v) => viewport - v + 26);
  const ctlOpacity = useTransform(sheetY, (v) => (viewport - v > viewport * 0.6 ? 0 : 1));
  const recenter = () => { animate(mapX, 0, { type: 'spring', bounce: 0.1 }); animate(mapY, 0, { type: 'spring', bounce: 0.1 }); };

  const pinCount = live.trusted && !ctx.openDisabled ? counts.open : null;
  const off = facility !== null && !live.trusted && live.connection !== 'connecting';

  return (
    <div className="screen" data-testid="explore">
      <div className={`map${off ? ' off' : ''}`} role="group" aria-label="Illustrated campus map">
        <motion.svg
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          preserveAspectRatio="xMidYMid slice"
          style={{ x: mapX, y: mapY, scale: mapScale, overflow: 'visible' }}
          drag
          dragConstraints={{ left: -70, right: 70, top: -90, bottom: 90 }}
          dragElastic={0.2}
          dragMomentum={false}
        >
          <CampusStreets />
          {ctx.destination && <WalkLink />}
          {facility && (
            <g
              className="pinbtn"
              role="button"
              tabIndex={0}
              aria-label={`${facility.name}: ${pinCount === null ? (ctx.openDisabled && live.trusted ? 'open spaces can’t be confirmed yet' : 'availability unknown') : `${pinCount} confirmed open`}. Show garage details`}
              onClick={() => setMode('garage')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMode('garage'); } }}
            >
              <GaragePin count={pinCount} active={mode !== 'peek'} />
            </g>
          )}
          {ctx.destination && <DestinationPin name={ctx.destination} />}
        </motion.svg>
      </div>
      <motion.div className="wash" animate={{ opacity: mode === 'peek' ? 1 : 0.5 }} transition={{ duration: 0.3 }} />

      <motion.div className="top" animate={{ opacity: mode === 'peek' ? 1 : 0, y: mode === 'peek' ? 0 : -12 }} transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }} style={{ pointerEvents: mode === 'peek' ? 'auto' : 'none' }} aria-hidden={mode !== 'peek'}>
        <div className="row">
          <span className="greet">{greeting()}</span>
          <button type="button" className="circ avatar press" aria-label="You and settings" onClick={props.onProfile}><Person /></button>
        </div>
        <h1 className="hl" style={{ marginTop: -14 }}>Where to?</h1>
        {live.connection === 'reconnecting' || live.silent ? (
          <div className="banner" role="status" data-testid="reconnecting">{live.silent ? 'No recent update' : 'Reconnecting'} · nothing shown as available</div>
        ) : (
          <div className="search" data-testid="search">
            <button type="button" className="main" onClick={props.onSearch} aria-label={ctx.destination ? `Destination: ${ctx.destination}. Change` : 'Search for a destination'}>
              <span className="sq" />
              <span className="t">
                {ctx.destination ? <b>{ctx.destination}</b> : <b className="ph">Search a campus building</b>}
                {ctx.destination && ctx.classLine && <small>{ctx.leaveBy ? `${ctx.classLine.split(' · ')[0]} · Leave ${ctx.leaveBy}` : ctx.classLine}{ctx.destinationIsDemo && <> · <DemoMark /></>}</small>}
                {!ctx.destination && <small>Parking near where you're going</small>}
              </span>
            </button>
            {ctx.destination && <button type="button" className="circ flat press" aria-label="Clear destination" onClick={props.onClearDestination}><Close /></button>}
          </div>
        )}
      </motion.div>

      <motion.span className="maplbl" style={{ bottom: lblBottom, opacity: ctlOpacity }} aria-hidden>Illustrated map</motion.span>
      <motion.button type="button" className="circ mapctl press" style={{ bottom: ctlBottom, opacity: ctlOpacity }} aria-label="Recenter map" onClick={recenter}><Locate /></motion.button>

      <Sheet
        y={sheetY}
        viewport={viewport}
        detents={detents}
        active={mode}
        hidden={!revealed}
        onChange={(id) => setMode(id as Mode)}
        scroll={mode !== 'peek'}
        label={mode === 'peek' ? 'Best parking' : mode === 'garage' ? 'Garage details' : 'Choose a space'}
      >
        {mode === 'peek' && <PeekPanel {...props} onMeasure={setPeekH} />}
        {mode === 'garage' && <GaragePanel {...props} />}
        {mode === 'space' && <SpacePanel {...props} />}
      </Sheet>
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

  const eyebrow = ctx.destination ? `Best parking near ${ctx.destination}` : 'Monitored garage';
  const forYouLine = counts.forYou === counts.open ? undefined : `${counts.forYou} usable by you`;
  let body;
  if (ctx.facilities.state === 'error' && !facility) {
    body = (
      <>
        <div className="big"><span className="num off">—</span><span className="lbl"><b>Can't reach ParkRight</b><span>No spaces are shown as available.</span></span></div>
        <div className="acts"><button type="button" className="btn ink press" onClick={p.onRetry}>Try again</button></div>
      </>
    );
  } else if (!facility || (live.connection === 'connecting' && !live.everLive)) {
    body = (
      <>
        <div className="skel" style={{ height: 64, width: '62%' }} aria-hidden />
        <TickStrip spaces={spaces} label="Waiting for live data" />
        <div className="prov" role="status">Waiting for the first live snapshot…</div>
        <div className="acts"><button type="button" className="btn" disabled>View spaces</button><button type="button" className="circ lg" disabled aria-label="Go"><Arrow /></button></div>
      </>
    );
  } else if (!live.trusted) {
    body = (
      <>
        <div className="big"><span className="num off" data-testid="open-count">—</span><span className="lbl"><b>Live data paused</b><span>{facility.name}</span></span></div>
        <TickStrip spaces={spaces} label="Availability unknown while reconnecting" />
        <Provenance live={live} evidence={ctx.evidence} simulated={facility.is_simulated} />
        <div className="acts"><button type="button" className="btn press" onClick={() => setMode('garage')}>View garage</button><button type="button" className="circ lg" disabled aria-label="Go (unavailable)"><Arrow /></button></div>
      </>
    );
  } else if (ctx.openDisabled && ctx.evidence.fresh === 0) {
    // Occupied-only detection with no current view at all: say the views are old, not "0 occupied".
    body = (
      <>
        <div className="big" data-testid="stale-state"><span className="num off">—</span><span className="lbl"><b>No recent camera view</b><span>Spaces can’t be confirmed until the cameras report again</span></span></div>
        <TickStrip spaces={spaces} label="No space can be confirmed: no recent camera view" />
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
        <TickStrip spaces={spaces} label={`${counts.occupied} of ${counts.total} spaces seen occupied; open spaces can't be confirmed yet`} />
        <Provenance live={live} evidence={ctx.evidence} simulated={facility.is_simulated} />
        <p className="notice-line" data-testid="open-disabled-line">Open-space confirmation isn’t enabled in this demo yet.</p>
        <div className="acts"><button type="button" className="btn ink press" onClick={() => setMode('garage')} data-testid="view-garage">View garage</button></div>
      </>
    );
  } else if (counts.forYou === 0) {
    body = (
      <>
        <div className="big"><span className="num zero" data-testid="open-count">{counts.open}</span><span className="lbl"><b>{counts.open === 0 ? 'spaces confirmed open' : 'open spaces you can use: 0'}</b><span>{counts.uncertain ? `${counts.uncertain} can't be confirmed right now` : `of ${counts.total} · ${facility.name}`}</span></span></div>
        <TickStrip spaces={spaces} label={`${counts.open} of ${counts.total} spaces confirmed open`} />
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
          <span className="lbl"><b>{counts.open === 1 ? 'space confirmed open' : 'spaces confirmed open'}</b><span className="fac">{facility.name}</span></span>
        </div>
        <TickStrip spaces={spaces} label={`${counts.open} of ${counts.total} spaces confirmed open`} />
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
      <div className="ey">{eyebrow}</div>
      {body}
    </div>
  );
}

// ---------------------------------------------------------------- garage

function GaragePanel(p: Parameters<typeof Explore>[0]) {
  const { ctx, setMode } = p;
  const { live, counts, facility, spaces } = ctx;
  if (!facility) return <div className="panel"><div className="skel" style={{ height: 200 }} /></div>;
  const level = facility.levels.length === 1 ? facility.levels[0].name : `${facility.levels.length} levels`;
  const camera = facility.cameras.length === 1 ? facility.cameras[0].camera_id : `${facility.cameras.length} cameras`;
  return (
    <div className="panel" style={{ gap: 18, paddingBottom: p.safe.bottom + 24 }} data-testid="garage-panel">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
          <div className="ey">{level} · {counts.total} spaces</div>
          <h2 className={`title${facility.name.length > 26 ? ' long' : ''}`}>{facility.name}</h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="circ flat press" aria-label="About this data" onClick={p.onAbout}><Info /></button>
          <button type="button" className="circ flat press" aria-label="Close garage details" onClick={() => setMode('peek')}><Close /></button>
        </div>
      </div>
      {ctx.demo?.site && (
        <div className="site-note" data-testid="site-disclaimer">
          <b>{ctx.demo.site.tag}</b>
          <span>{ctx.demo.site.disclaimer}</span>
        </div>
      )}
      <div className="stats" data-testid="garage-stats">
        <div className={`stat open${ctx.openDisabled ? ' off' : ''}`}><b>{live.trusted && !ctx.openDisabled ? counts.open : '—'}</b><span>Open</span></div>
        <div className="stat occ"><b>{live.trusted ? counts.occupied : '—'}</b><span>Occupied</span></div>
        <div className="stat unc"><b>{counts.uncertain}</b><span>Can't confirm</span></div>
      </div>
      <TickStrip spaces={spaces} label={`${counts.open} open, ${counts.occupied} occupied, ${counts.uncertain} can't confirm`} />
      <Provenance live={live} evidence={ctx.evidence} simulated={facility.is_simulated} extra={camera} />
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
      <p className="notice-line">ParkRight shows what its cameras see. Spaces aren't reserved or held for you.</p>
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
        <div className="ey">{facility.name} · {levelName}</div>
        <h2 className="hl" style={{ fontSize: 36 }}>Choose a space</h2>
      </div>
      {levels.length > 1 && (
        <div className="seg" role="group" aria-label="Level">
          {[...levels].sort((a, b) => a.ordinal - b.ordinal).map((l) => (
            <button key={l.level_id} type="button" aria-pressed={l.level_id === activeLevel} onClick={() => setLevelId(l.level_id)}>{l.name}</button>
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
                className={`bay ${cls}${small ? ' sm' : ''}`}
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
