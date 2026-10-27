/**
 * Trip. The route is a demo drawn on the illustration, labelled as such. The real part is the
 * live watch: the chosen space is re-evaluated on every update, and the moment it stops being
 * a confirmed-open space for this driver the sheet says so and offers the next one.
 */
import type { Facility, ParkingSpace } from '@parkright/contracts';
import { motion } from 'motion/react';
import type { LiveView } from '../net/live.ts';
import { bayState, describeSpace, offerable, suggestSpace } from '../lib/parking.ts';
import type { Prefs } from '../lib/prefs.ts';
import { ago } from '../lib/time.ts';
import { CampusStreets, GaragePin, GARAGE_PIN, MAP_H, MAP_W } from '../ui/CampusMap.tsx';
import { Close, TurnRight } from '../ui/icons.tsx';

export type TripWatch = 'ok' | 'taken' | 'unconfirmed' | 'paused' | 'ineligible';

export function tripStatus(space: ParkingSpace | undefined, live: LiveView, prefs: Prefs): TripWatch {
  if (!live.trusted) return 'paused';
  if (!space) return 'unconfirmed';
  if (offerable(space, prefs)) return 'ok';
  const st = bayState(space);
  return st === 'occupied' ? 'taken' : st === 'uncertain' ? 'unconfirmed' : 'ineligible';
}

const ROUTE = `M150 980 C 150 820, 140 690, 150 590 S 196 470, ${GARAGE_PIN.x - 30} ${GARAGE_PIN.y + 6} L ${GARAGE_PIN.x} ${GARAGE_PIN.y}`;

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
  const level = facility.levels.find((l) => l.level_id === space?.level_id)?.name ?? 'the level';
  const alt = status !== 'ok' && live.trusted ? suggestSpace(spaces.filter((s) => s.space_id !== spaceId), prefs, facility.levels) : null;
  const row = space ? describeSpace(space, spaces) : '';

  const warn: Record<Exclude<TripWatch, 'ok'>, { title: string; body: string }> = {
    taken: { title: `${spaceId} was just taken`, body: 'A camera now sees a car there.' },
    unconfirmed: { title: `${spaceId} can't be confirmed`, body: 'The camera view is unclear or too old to trust.' },
    paused: { title: 'Live data paused', body: `${spaceId} can't be confirmed until the connection returns.` },
    ineligible: { title: `${spaceId} isn't available to you`, body: 'Your settings changed for this space type.' },
  };

  return (
    <div className="screen" data-testid="trip" data-watch={status}>
      <div className="map" style={{ perspective: 700 }} aria-hidden>
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid slice" style={{ transform: 'rotateX(30deg) scale(1.35)', transformOrigin: '50% 74%', overflow: 'visible' }}>
          <CampusStreets />
          <path d={ROUTE} stroke="#12a15a" strokeWidth={16} strokeOpacity={0.18} fill="none" strokeLinecap="round" />
          <motion.path d={ROUTE} stroke="#12a15a" strokeWidth={7} fill="none" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.15 }} />
          <GaragePin count={live.trusted ? spaces.filter((s) => bayState(s) === 'open').length : null} />
        </svg>
      </div>
      <div style={{ position: 'absolute', inset: '0 0 auto', height: 300, background: 'linear-gradient(#0d0f12 0%, rgba(13,15,18,0) 100%)', zIndex: 3 }} />

      <motion.div className="navcard" initial={{ y: -24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', visualDuration: 0.45, bounce: 0.1 }}>
        <span className="demo">Demo route · not live directions</span>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span className="turn" aria-hidden><TurnRight width={28} height={28} color="#fff" /></span>
          <h1 style={{ font: '800 26px/1.04 var(--ui)', letterSpacing: '-.035em' }}>Turn right into {facility.name}</h1>
        </div>
        <p style={{ font: '500 15px/1.35 var(--ui)', color: '#b9bec4' }}>Then {level}. {spaceId}: {row || 'marked on the plan'}.</p>
      </motion.div>

      <motion.section
        className="sheet"
        style={{ top: 'auto', bottom: 0, padding: `10px 22px calc(var(--safe-bottom) + 18px)`, gap: 14, display: 'grid' }}
        initial={{ y: 260 }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', visualDuration: 0.45, bounce: 0.1 }}
        aria-label="Your space"
      >
        <span className="grab" style={{ justifySelf: 'center' }} />
        <div className="row">
          <div style={{ display: 'grid', gap: 7 }} aria-live="assertive">
            <div style={{ font: '750 21px/1.1 var(--ui)', letterSpacing: '-.02em' }} data-testid="trip-title">
              {status === 'ok' ? `${spaceId} is still open` : warn[status].title}
            </div>
            <div className="prov">
              {status === 'ok' && live.lastFrameAt
                ? <span className="live">Live · seen {ago(now - live.lastFrameAt)} ago</span>
                : <span className="paused">{warn[status === 'ok' ? 'paused' : status].body}</span>}
            </div>
          </div>
          <span className="plate sm" style={status === 'ok' ? undefined : { background: 'var(--amber)' }}>{spaceId}</span>
        </div>
        {status !== 'ok' && (
          <motion.div className="warnbox" data-testid="trip-warning" initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', visualDuration: 0.35, bounce: 0.25 }}>
            <b>{alt ? `${alt.space_id} is confirmed open` : 'No other space is confirmed open'}</b>
            <span>{alt ? describeSpace(alt, spaces) + ' · not reserved' : 'You can keep driving or pick again when one opens.'}</span>
          </motion.div>
        )}
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
        <p className="body" style={{ fontSize: 12.5 }}>Not a reservation. ParkRight keeps checking {spaceId} until you end the trip.</p>
      </motion.section>
    </div>
  );
}
