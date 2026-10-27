/**
 * Plan — "Your day, parked." Home of Arrival Intelligence: when to leave, what changed, where to park.
 * The schedule and disruptions are typed demo scenarios (labelled); parking near class is live.
 */
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import type { ArrivalResult } from '../arrival/engine.ts';
import type { LiveParking } from '../arrival/useArrival.ts';
import type { Judged, ScenarioDef, Signal } from '../arrival/types.ts';
import type { Scenario } from '../net/api.ts';
import { SourceTag } from '../ui/SourceTag.tsx';
import { AlertIcon, Arrow, Check, Chevron, Close, School } from '../ui/icons.tsx';
import { Modal } from './Modals.tsx';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Plan({ scenario, arrival, parking, onFind }: {
  scenario: Scenario | null | undefined;
  arrival: { id: string; defs: ScenarioDef[]; setId: (id: string) => void; result: ArrivalResult };
  parking: LiveParking | null;
  onFind: (destination: string) => void;
}) {
  const [preview, setPreview] = useState(false);
  const [dismissed, setDismissed] = useState<Record<string, true>>({});
  const [tripRemoved, setTripRemoved] = useState(false);
  const [picker, setPicker] = useState(false);
  const [showFiltered, setShowFiltered] = useState(false);
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const r = arrival.result;
  const demoOn = !!scenario || preview;
  const visibleAlerts = r.shown.filter((j) => !dismissed[j.signal.id]).slice(0, 2);
  const destShort = r.movedTo?.buildingShort ?? r.session.buildingShort;

  const changeScenario = (id: string) => { arrival.setId(id); setDismissed({}); setTripRemoved(false); setShowFiltered(false); setPicker(false); };

  return (
    <div className="screen" data-testid="plan" data-arrival={arrival.id} style={{ overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div className="wash tall" />
      <div className="plan-col">
        <div className="row">
          <span className="greet">{today}</span>
          {demoOn && <button type="button" className="scen-pill press" onClick={() => setPicker(true)} data-testid="scenario-pill"><span className="dm">Demo</span>{arrival.defs.find((d) => d.id === arrival.id)?.label}<Chevron width={14} height={14} /></button>}
        </div>
        <h1 className="hl xl">Your day,<br />parked.</h1>

        {scenario === undefined && !preview ? (
          <div className="skel" style={{ height: 380, borderRadius: 34 }} />
        ) : !demoOn ? (
          <div className="ahero calm" data-testid="plan-empty">
            <span className="ic lg"><School /></span>
            <div className="h2">Class schedules aren't connected yet</div>
            <p className="body">With university sign-in, ParkRight will plan around your classes: when to leave, what changed, where to park. Nothing is connected today.</p>
            <button type="button" className="btn ink press" onClick={() => setPreview(true)} data-testid="preview-demo">Preview with a demo schedule</button>
          </div>
        ) : tripRemoved ? (
          <motion.div className="ahero calm" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} data-testid="trip-removed">
            <span className="ic lg ok"><Check /></span>
            <div className="h2">Trip removed for today</div>
            <p className="body">{r.session.course} won't meet, so there's nothing to plan. Enjoy the time back.</p>
            <button type="button" className="btn press" onClick={() => setTripRemoved(false)}>Undo</button>
          </motion.div>
        ) : (
          <ArrivalHero r={r} parking={parking} destShort={destShort} onFind={onFind} onRemove={() => setTripRemoved(true)} />
        )}

        {demoOn && !tripRemoved && (
          <>
            <AnimatePresence initial={false}>
              {visibleAlerts.length > 0 && (
                <motion.div key="sec" className="sec" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>Affects this trip</motion.div>
              )}
              {visibleAlerts.map((j, i) => (
                <AlertCard key={j.signal.id} j={j} index={i} destShort={destShort} onFind={onFind} onDismiss={() => setDismissed((d) => ({ ...d, [j.signal.id]: true }))} />
              ))}
            </AnimatePresence>
            {r.filtered.length > 0 && (
              <div className="filtered" data-testid="filtered">
                <button type="button" className="filtered-row press" onClick={() => setShowFiltered((v) => !v)} aria-expanded={showFiltered}>
                  <span className="ic sm ok"><Check /></span>
                  <span className="t"><b>{r.filtered.length} other {r.filtered.length === 1 ? 'update' : 'updates'} checked</b><small>Not relevant to this trip</small></span>
                  <Chevron width={16} height={16} style={{ transform: showFiltered ? 'rotate(90deg)' : 'none', transition: 'transform 240ms' }} />
                </button>
                <AnimatePresence initial={false}>
                  {showFiltered && (
                    <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}>
                      {r.filtered.map((j) => <li key={j.signal.id}><b>{j.signal.title}</b><span>{j.reason}</span></li>)}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>
            )}
            {r.shown.length === 0 && r.filtered.length === 0 && r.departure.state === 'ok' && (
              <p className="calm-line" data-testid="calm"><span className="ic sm ok"><Check /></span>Nothing affects this trip right now.</p>
            )}
            <p className="fine">Schedule, travel times and disruptions on this screen are demo examples, not current information. Parking near class is {parking?.simulated ? 'live from a simulated garage' : 'live'}. ParkRight can't guarantee arrival times.</p>
          </>
        )}
      </div>

      <Modal open={picker} onClose={() => setPicker(false)} label="Demo scenarios">
        <div style={{ display: 'grid', gap: 14 }} data-testid="scenario-sheet">
          <h2 className="h2">Preview a demo scenario</h2>
          <p className="body" style={{ fontSize: 14 }}>Examples of what Arrival Intelligence would surface. None of it is current information.</p>
          <div className="list">
            {arrival.defs.map((d) => (
              <button key={d.id} type="button" className="li press" onClick={() => changeScenario(d.id)} aria-pressed={d.id === arrival.id} data-testid={`scenario-${d.id}`}>
                <span className="t"><b>{d.label}</b><small>{d.blurb}</small></span>
                {d.id === arrival.id && <span className="ic sm ok"><Check /></span>}
              </button>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ArrivalHero({ r, parking, destShort, onFind, onRemove }: { r: ArrivalResult; parking: LiveParking | null; destShort: string; onFind: (d: string) => void; onRemove: () => void }) {
  const d = r.departure;
  return (
    <motion.section className={`ahero${r.canceled ? ' canceled' : ''}`} layout transition={{ type: 'spring', visualDuration: 0.45, bounce: 0.08 }} data-testid="arrival-hero" aria-label="Next class and departure">
      <div className="row"><span className="ey">Next class</span><SourceTag source={r.session.source} /></div>
      <div className="class-row">
        <div className="course" data-testid="course">{r.session.course}</div>
        <div className="time">{r.session.startsAt}</div>
      </div>
      <div className="building">
        {r.movedTo ? (
          <><b data-testid="building">{r.movedTo.building}</b><s>{r.session.building}</s></>
        ) : <span data-testid="building">{r.session.building}</span>}
        {r.canceled && <span className="pill-warn">Canceled</span>}
      </div>
      <div className="divider" />

      {d.state === 'ok' && (
        <>
          <div className="row"><span className="ey">Recommended departure</span><SourceTag source={d.source}>{d.source === 'demo' ? 'Demo estimate' : 'Estimated'}</SourceTag></div>
          <div className="depart" aria-live="polite">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={d.leaveAt} className="dtime" data-testid="leave-at" initial={{ y: 22, opacity: 0, filter: 'blur(4px)' }} animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }} exit={{ y: -22, opacity: 0, filter: 'blur(4px)' }} transition={{ type: 'spring', visualDuration: 0.4, bounce: 0.12 }}>
                {d.leaveAt.replace(/ (AM|PM)$/, '')}<small>{d.leaveAt.slice(-2)}</small>
              </motion.span>
            </AnimatePresence>
          </div>
          <div className="outlook">Arrive by {d.arriveBy} · {d.spareMinutes} min to spare<span className="outlook-tot"> · {d.totalMinutes} min door to door</span></div>
          <Breakdown parts={d.parts} />
          {d.incomplete.includes('parking') && <p className="body warnline">Parking time not included: no space you can use is confirmed open.</p>}
        </>
      )}
      {d.state === 'unavailable' && (
        <div className="depart-na" data-testid="departure-unavailable">
          <div className="row"><span className="ey">Recommended departure</span><SourceTag source="unavailable" /></div>
          <div className="dtime off small">Not available</div>
          <p className="body">No {d.missing.join(' or ')} estimate, so ParkRight won't guess a time.</p>
        </div>
      )}
      {d.state === 'not-needed' && (
        <div className="depart-na" data-testid="departure-not-needed">
          <div className="dtime off small">No need to leave</div>
          <p className="body">This parking trip may no longer be needed.</p>
        </div>
      )}

      {!r.canceled && parking && (
        <div className="parkline" data-testid="parkline">
          <span className={`pdot${parking.trusted && parking.forYou > 0 ? ' on' : ''}`} />
          <span className="t">
            <b>{parking.trusted ? `${parking.open} confirmed open` : 'Live parking paused'}</b>
            <small>{parking.garage}</small>
          </span>
          <SourceTag source={parking.trusted ? (parking.simulated ? 'simulated' : 'live') : 'unavailable'}>{parking.trusted ? (parking.simulated ? 'Live · simulated' : 'Live') : 'Paused'}</SourceTag>
        </div>
      )}

      {r.note && <p className={`note ${r.note.tone}`} data-testid="arrival-note">{r.note.text}</p>}

      {r.canceled ? (
        <div className="acts">
          <button type="button" className="btn ink press" onClick={onRemove} data-testid="remove-trip">Remove this trip</button>
        </div>
      ) : (
        <div className="acts">
          <button type="button" className="btn ink press" onClick={() => onFind(destShort)} data-testid="find-near">Find parking near class</button>
          <button type="button" className="circ green lg press" aria-label={`Find parking near ${destShort}`} onClick={() => onFind(destShort)}><Arrow /></button>
        </div>
      )}
    </motion.section>
  );
}

function Breakdown({ parts }: { parts: { label: string; minutes: number }[] }) {
  const total = parts.reduce((n, p) => n + p.minutes, 0);
  return (
    <div className="breakdown" role="img" aria-label={parts.map((p) => `${p.label} ${p.minutes} minutes`).join(', ')} data-testid="breakdown">
      <div className="bar">
        {parts.map((p) => <motion.i key={p.label} className={`seg-${p.label.toLowerCase()}`} layout initial={false} animate={{ flexGrow: p.minutes }} transition={{ type: 'spring', visualDuration: 0.45, bounce: 0 }} />)}
      </div>
      <div className="legend-row">
        {parts.map((p) => <span key={p.label}><i className={`seg-${p.label.toLowerCase()}`} />{p.label} {p.minutes}</span>)}
      </div>
    </div>
  );
}

const ACTION_LABEL: Record<NonNullable<Signal['action']>, string> = {
  'find-parking': 'See parking', 'review-parking': 'Review parking', 'review-route': 'Review route', 'dismiss-trip': 'Remove trip', 'allow-time': 'Time added',
};

function AlertCard({ j, index, destShort, onFind, onDismiss }: { j: Judged; index: number; destShort: string; onFind: (d: string) => void; onDismiss: () => void }) {
  const s = j.signal;
  const tone = s.effect ? 'important' : s.severity === 'major' ? 'important' : 'notice';
  const [routeOpen, setRouteOpen] = useState(false);
  return (
    <motion.article
      className={`alert ${tone} k-${s.kind}`}
      layout
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.22 } }}
      transition={{ type: 'spring', visualDuration: 0.42, bounce: 0.1, delay: index * 0.06 }}
      data-testid={`alert-${s.id}`}
    >
      <span className="aicon"><AlertIcon kind={s.kind} /></span>
      <div className="abody">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <b>{s.title}</b>
          <button type="button" className="adismiss" aria-label={`Dismiss: ${s.title}`} onClick={onDismiss}><Close width={14} height={14} /></button>
        </div>
        <p>{s.detail}</p>
        <div className="ameta">
          <SourceTag source={s.source} />
          <span>{j.reason}{s.driveDelayMin ? ` · +${s.driveDelayMin + (s.walkDelayMin ?? 0)} min` : ''}</span>
        </div>
        {s.action === 'review-route' && (
          <>
            <button type="button" className="alink" onClick={() => setRouteOpen((v) => !v)} aria-expanded={routeOpen}>{routeOpen ? 'Hide' : 'Review route'}</button>
            {routeOpen && <p className="body" style={{ fontSize: 13.5 }}>Live routing isn't connected, so ParkRight can't suggest a specific detour yet. Allow the extra time shown, or use another campus entrance you know.</p>}
          </>
        )}
        {(s.action === 'review-parking' || s.action === 'find-parking') && (
          <button type="button" className="alink" onClick={() => onFind(destShort)}>{ACTION_LABEL[s.action]} near {destShort}</button>
        )}
      </div>
    </motion.article>
  );
}
