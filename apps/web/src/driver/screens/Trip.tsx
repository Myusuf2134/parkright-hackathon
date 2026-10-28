/**
 * Trip. The route is a demo drawn on the illustration, labelled as such. The real part is the
 * live watch: the chosen space is re-evaluated on every update, and the moment it stops being
 * a confirmed-open space for this driver the sheet says so and offers the next one.
 */
import type { Facility, ParkingSpace } from '@parkright/contracts';
import { AnimatePresence, motion } from 'motion/react';
import type { LiveView } from '../net/live.ts';
import { bayState, describeSpace, offerable, suggestSpace } from '../lib/parking.ts';
import type { Prefs } from '../lib/prefs.ts';
import { spaceLabel } from '../lib/evidence.ts';
import { CampusStreets, GaragePin, GARAGE_PIN, MAP_H, MAP_W, TRIP_ROUTE } from '../ui/CampusMap.tsx';
import { Close, TurnRight } from '../ui/icons.tsx';

export type TripWatch = 'ok' | 'taken' | 'unconfirmed' | 'paused' | 'ineligible';

export function tripStatus(space: ParkingSpace | undefined, live: LiveView, prefs: Prefs): TripWatch {
  if (!live.trusted) return 'paused';
  if (!space) return 'unconfirmed';
  if (offerable(space, prefs)) return 'ok';
  const st = bayState(space);
  return st === 'occupied' ? 'taken' : st === 'uncertain' ? 'unconfirmed' : 'ineligible';
}

const SPRING = { type: 'spring' as const, visualDuration: 0.45, bounce: 0.1 };

export function Trip({ facility, spaceId, live, spaces, prefs, now, onEnd, onChooseAnother, onSwitch }: {
  facility: Facility;
  spaceId: string;
  live: LiveView;
  spaces: ParkingSpace[];
  prefs: Prefs;
  now: number;
  onEnd: () => void;
  onChooseAnother: () => void;
  onSwitch: (spaceId: string) => void;
}) {
  const space = spaces.find((s) => s.space_id === spaceId);
  const status = tripStatus(space, live, prefs);
  const level = facility.levels.find((l) => l.level_id === space?.level_id)?.name ?? 'Level 1';
  const alt = status !== 'ok' && live.trusted ? suggestSpace(spaces.filter((s) => s.space_id !== spaceId), prefs, facility.levels) : null;
  const row = space ? describeSpace(space, spaces) : '';
  // This space's own last observation, not the newest frame from any camera.
  const seen = space ? spaceLabel(space, now, live.clockOffsetMs) : null;

  const warn: Record<Exclude<TripWatch, 'ok'>, { title: string; body: string }> = {
    taken: { title: `${spaceId} was just taken`, body: 'A camera now sees a car there.' },
    unconfirmed: { title: `${spaceId} can't be confirmed`, body: 'The camera view is unclear or too old to trust.' },
    paused: { title: 'Live data paused', body: `${spaceId} can't be confirmed until the connection returns.` },
    ineligible: { title: `${spaceId} isn't available to you`, body: 'Your settings changed for this space type.' },
  };

  return (
    <div className="screen trip" data-testid="trip" data-watch={status}>
      <div className="map trip-map" aria-hidden>
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid slice" className="tilt">
          <CampusStreets depth />
          <path d={TRIP_ROUTE} stroke="#12a15a" strokeOpacity={0.16} strokeWidth={26} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d={TRIP_ROUTE} stroke="#ffffff" strokeWidth={15} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <motion.path d={TRIP_ROUTE} stroke="#12a15a" strokeWidth={9} fill="none" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.15 }} />
          <path d={TRIP_ROUTE} className="route-flow" stroke="#ffffff" strokeOpacity={0.75} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeDasharray="1 16" />
          <GaragePin count={live.trusted ? spaces.filter((s) => bayState(s) === 'open').length : null} active />
          <g transform={`translate(${GARAGE_PIN.x + 44} ${GARAGE_PIN.y - 70})`}>
            <rect x={0} y={0} width={44} height={28} rx={9} fill={status === 'ok' ? '#12a15a' : '#b7791f'} />
            <text x={22} y={19} textAnchor="middle" fontFamily="Geist Mono Variable, monospace" fontSize={13} fontWeight={650} fill="#fff">{spaceId}</text>
          </g>
        </svg>
        <div className="horizon-fog" />
      </div>

      <motion.div className="navcard" initial={{ y: -24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={SPRING}>
        <span className="demo">Demo guidance · not live directions</span>
        <div className="maneuver">
          <span className="turn"><TurnRight width={40} height={40} color="#fff" /></span>
          <div className="mtext">
            <div className="mverb">Turn right</div>
            <div className="mnoun">into {facility.name}</div>
          </div>
        </div>
        <div className="then"><span className="then-k">Then</span>{level} · {row || 'your space'}</div>
      </motion.div>

      <motion.section
        className="tripsheet"
        initial={{ y: 280 }}
        animate={{ y: 0 }}
        transition={SPRING}
        aria-label="Your space"
      >
        <span className="grab" style={{ justifySelf: 'center' }} />
        <div className="row" style={{ alignItems: 'center' }}>
          <motion.span className={`plate${status === 'ok' ? '' : ' warn'}`} layout>{spaceId}</motion.span>
          <div style={{ display: 'grid', gap: 7, flex: 1, minWidth: 0 }} aria-live="assertive">
            <div className="trip-title" data-testid="trip-title">{status === 'ok' ? `${spaceId} is still open` : warn[status].title}</div>
            <div className="prov">
              {status === 'ok' && seen
                ? <span className={seen.tone === 'live' ? 'live' : 'paused'} data-testid="trip-age" data-tone={seen.tone}>{seen.tone === 'live' ? `Live · ${seen.text.toLowerCase()}` : seen.text}</span>
                : <span className="paused">{warn[status === 'ok' ? 'paused' : status].body}</span>}
              {facility.is_simulated && <><span aria-hidden>·</span><span className="simw">Simulated</span></>}
            </div>
          </div>
        </div>
        <AnimatePresence initial={false}>
          {status !== 'ok' && (
            <motion.div className="warnbox" data-testid="trip-warning" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={SPRING}>
              <b>{alt ? `${alt.space_id} is confirmed open` : 'No other space is confirmed open'}</b>
              <span>{alt ? `${describeSpace(alt, spaces)} · not reserved` : 'Keep driving or choose again when one opens.'}</span>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="chips">
          <span className="chip">Not reserved</span>
          <span className="chip">Rechecked live</span>
          <span className="chip amber">Demo guidance</span>
        </div>
        <div className="acts">
          {status === 'ok' ? (
            <button type="button" className="btn press" onClick={onChooseAnother}>Change space</button>
          ) : alt ? (
            <button type="button" className="btn green press" onClick={() => onSwitch(alt.space_id)} data-testid="switch">Switch to {alt.space_id}</button>
          ) : (
            <button type="button" className="btn ink press" onClick={onChooseAnother}>Choose another space</button>
          )}
          <button type="button" className="circ flat lg press" aria-label="End trip" onClick={onEnd}><Close /></button>
        </div>
      </motion.section>
    </div>
  );
}
